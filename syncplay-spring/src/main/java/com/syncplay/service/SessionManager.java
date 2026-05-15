package com.syncplay.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SessionManager {
    private final ConcurrentHashMap<UUID, ConcurrentHashMap<UUID, WebSocketSession>> rooms = new ConcurrentHashMap<>();
    private final ObjectMapper mapper;

    public SessionManager(ObjectMapper mapper) { this.mapper = mapper; }

    public void register(UUID roomId, UUID userId, WebSocketSession s) {
        rooms.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>()).put(userId, s);
    }

    public void remove(UUID roomId, UUID userId) {
        var room = rooms.get(roomId);
        if (room != null) {
            room.remove(userId);
            if (room.isEmpty()) rooms.remove(roomId);
        }
    }

    public void broadcastToRoom(UUID roomId, Object message) {
        var room = rooms.get(roomId);
        if (room == null || room.isEmpty()) return;
        try {
            String json = mapper.writeValueAsString(message);
            TextMessage tm = new TextMessage(json);
            for (var s : room.values()) {
                if (s.isOpen()) {
                    synchronized (s) {
                        try { s.sendMessage(tm); } catch (IOException ignore) {}
                    }
                }
            }
        } catch (Exception ignore) {}
    }

    public int countSessions(UUID roomId) {
        var room = rooms.get(roomId);
        return room == null ? 0 : room.size();
    }

    public java.util.Set<UUID> getActiveUserIds(UUID roomId) {
        var room = rooms.get(roomId);
        return room == null ? java.util.Set.of() : java.util.Set.copyOf(room.keySet());
    }

    public java.util.Set<UUID> getActiveRoomIds() {
        return java.util.Set.copyOf(rooms.keySet());
    }
}
