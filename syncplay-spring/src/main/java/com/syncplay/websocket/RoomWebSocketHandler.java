package com.syncplay.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncplay.security.CustomUserDetails;
import com.syncplay.service.FriendService;
import com.syncplay.service.RoomService;
import com.syncplay.service.SessionManager;
import com.syncplay.service.WsTokenStore;
import com.syncplay.repo.UserRepo;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
public class RoomWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper mapper;
    private final SessionManager sessions;
    private final RoomService roomService;
    private final FriendService friendService;
    private final WsTokenStore wsTokenStore;
    private final UserRepo userRepo;

    public RoomWebSocketHandler(ObjectMapper m, SessionManager s, RoomService r, FriendService f,
                                WsTokenStore w, UserRepo u) {
        this.mapper = m; this.sessions = s; this.roomService = r; this.friendService = f;
        this.wsTokenStore = w; this.userRepo = u;
    }

    /** Extract `token` query parameter from WS URL, if any. */
    private static String extractToken(URI uri) {
        if (uri == null || uri.getQuery() == null) return null;
        for (String pair : uri.getQuery().split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && "token".equals(pair.substring(0, eq))) {
                return pair.substring(eq + 1);
            }
        }
        return null;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        var headers = session.getHandshakeHeaders();
        var cookieHeader = headers.getFirst("cookie");
        var origin = headers.getFirst("origin");
        var remote = session.getRemoteAddress();
        System.out.println("[ws] upgrade from=" + remote + " origin=" + origin
            + " cookieLen=" + (cookieHeader == null ? 0 : cookieHeader.length())
            + " hasJSESSIONID=" + (cookieHeader != null && cookieHeader.contains("JSESSIONID")));

        UUID userId;

        // 1. Try token from URL query first — works for iOS Safari which strips cookies
        //    on cross-port WS. Frontend gets the token via REST (where cookies work)
        //    and embeds it in the WS URL.
        String token = extractToken(session.getUri());
        if (token != null) {
            UUID uid = wsTokenStore.consume(token);
            if (uid == null) {
                System.out.println("[ws] close: invalid/expired token");
                session.close(CloseStatus.NOT_ACCEPTABLE.withReason("Invalid token"));
                return;
            }
            userId = uid;
            System.out.println("[ws] auth via token, user=" + userId);
        } else {
            // 2. Fallback: session cookie (works on desktop browsers same-origin)
            var httpSession = session.getAttributes();
            SecurityContext ctx = (SecurityContext) httpSession.get(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
            if (ctx == null || ctx.getAuthentication() == null
                || !(ctx.getAuthentication().getPrincipal() instanceof CustomUserDetails u)) {
                System.out.println("[ws] close: No auth (no token, no session ctx)");
                session.close(CloseStatus.NOT_ACCEPTABLE.withReason("No auth"));
                return;
            }
            userId = u.getUserId();
            System.out.println("[ws] auth via cookie, user=" + userId);
        }

        // roomId из URL: /ws/room/{roomId}
        String path = session.getUri() != null ? session.getUri().getPath() : "";
        String roomIdStr = path.substring(path.lastIndexOf('/') + 1);
        UUID roomId;
        try { roomId = UUID.fromString(roomIdStr); }
        catch (Exception e) { session.close(CloseStatus.BAD_DATA); return; }

        session.getAttributes().put("userId", userId);
        session.getAttributes().put("roomId", roomId);
        sessions.register(roomId, userId, session);
        roomService.updatePresenceOnConnect(roomId, userId);

        // Сразу отдать snapshot — чтобы новый клиент подхватил уже играющую песню
        try {
            Map<String, Object> snap = roomService.getSnapshot(roomId);
            String json = mapper.writeValueAsString(snap);
            synchronized (session) {
                if (session.isOpen()) session.sendMessage(new TextMessage(json));
            }
        } catch (Exception ignore) {}
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage tm) throws Exception {
        UUID userId = (UUID) session.getAttributes().get("userId");
        UUID roomId = (UUID) session.getAttributes().get("roomId");
        if (userId == null || roomId == null) return;

        @SuppressWarnings("unchecked")
        Map<String, Object> msg = mapper.readValue(tm.getPayload(), Map.class);
        String type = (String) msg.get("type");

        try {
            switch (type) {
                // Legacy nested format: { type: PLAYBACK_COMMAND, payload: { command, positionMs } }
                case "PLAYBACK_COMMAND" -> {
                    @SuppressWarnings("unchecked")
                    var p = (Map<String, Object>) msg.get("payload");
                    String cmd = (String) p.get("command");
                    Long seekMs = p.containsKey("positionMs") ? ((Number) p.get("positionMs")).longValue() : null;
                    roomService.handleCommand(roomId, userId, cmd, seekMs);
                }
                // New flat format: { type: PLAY_COMMAND } / { type: SEEK_COMMAND, positionMs }
                case "PLAY_COMMAND"  -> roomService.handleCommand(roomId, userId, "PLAY", null);
                case "PAUSE_COMMAND" -> roomService.handleCommand(roomId, userId, "PAUSE", null);
                case "SKIP_COMMAND"  -> roomService.handleCommand(roomId, userId, "SKIP", null);
                case "SEEK_COMMAND" -> {
                    Long seekMs = msg.containsKey("positionMs") ? ((Number) msg.get("positionMs")).longValue() : null;
                    roomService.handleCommand(roomId, userId, "SEEK", seekMs);
                }
                case "HOST_POSITION" -> {
                    // Only the actual host may send HOST_POSITION
                    var roomOpt = roomService.getRoomById(roomId);
                    if (roomOpt.isEmpty() || !userId.equals(roomOpt.get().getHostId())) break;
                    @SuppressWarnings("unchecked")
                    var p = (Map<String, Object>) msg.get("payload");
                    long pos = ((Number) p.get("positionMs")).longValue();
                    long ts = System.currentTimeMillis();
                    long serverPos = roomService.getExpectedPositionMs(roomId);
                    Map<String, Object> bc = new HashMap<>();
                    bc.put("type", "HOST_TICK");
                    bc.put("positionMs", pos);
                    bc.put("timestamp", ts);
                    if (serverPos >= 0) bc.put("serverPositionMs", serverPos);
                    sessions.broadcastToRoom(roomId, bc);
                }
                case "CHAT_MESSAGE" -> {
                    // Accept both: { payload: { content } } and flat { content }
                    String content;
                    if (msg.get("payload") instanceof Map<?, ?> p) {
                        content = (String) p.get("content");
                    } else {
                        content = (String) msg.get("content");
                    }
                    if (content == null || content.isBlank()) break;
                    Map<String, Object> chat = new HashMap<>();
                    chat.put("type", "CHAT");
                    chat.put("userId", userId.toString());
                    chat.put("content", content.trim());
                    chat.put("ts", System.currentTimeMillis());
                    sessions.broadcastToRoom(roomId, chat);
                }
                case "PING" -> {
                    long serverTs = System.currentTimeMillis();
                    // Accept both: { payload: { clientTimestamp } } and flat { clientTimestamp }
                    Object clientTs;
                    if (msg.get("payload") instanceof Map<?, ?> p) {
                        clientTs = p.get("clientTimestamp");
                    } else {
                        clientTs = msg.get("clientTimestamp");
                    }
                    String pong = "{\"type\":\"PONG\",\"serverTimestamp\":" + serverTs
                        + (clientTs != null ? ",\"clientTimestamp\":" + clientTs : "") + "}";
                    synchronized (session) {
                        if (session.isOpen()) session.sendMessage(new TextMessage(pong));
                    }
                    try { friendService.touchPresence(userId); } catch (Exception ignore) {}
                }
            }
        } catch (RuntimeException e) {
            try {
                String err = mapper.writeValueAsString(Map.of("type","ERROR","message", e.getMessage()));
                synchronized (session) {
                    if (session.isOpen()) session.sendMessage(new TextMessage(err));
                }
            } catch (Exception ignore) {}
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        UUID userId = (UUID) session.getAttributes().get("userId");
        UUID roomId = (UUID) session.getAttributes().get("roomId");
        if (userId != null && roomId != null) {
            sessions.remove(roomId, userId);
            try { roomService.leaveRoom(roomId, userId); } catch (Exception ignore) {}
        }
    }
}
