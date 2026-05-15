package com.syncplay.controller;

import com.syncplay.repo.RoomQueueRepo;
import com.syncplay.repo.RoomRepo;
import com.syncplay.repo.TrackRepo;
import com.syncplay.repo.UserRepo;
import com.syncplay.service.WsTokenStore;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Internal endpoints called by syncplay-sync service.
 * Protected by X-Internal-Secret header instead of Spring Security session auth.
 */
@RestController
@RequestMapping("/internal")
public class InternalRoomController {

    @Value("${internal.secret:syncplay-internal-secret}")
    private String internalSecret;

    private final RoomRepo roomRepo;
    private final RoomQueueRepo queueRepo;
    private final TrackRepo trackRepo;
    private final UserRepo userRepo;
    private final WsTokenStore wsTokenStore;

    public InternalRoomController(RoomRepo r, RoomQueueRepo q, TrackRepo t, UserRepo u, WsTokenStore w) {
        this.roomRepo = r;
        this.queueRepo = q;
        this.trackRepo = t;
        this.userRepo = u;
        this.wsTokenStore = w;
    }

    private boolean authorized(HttpServletRequest req) {
        return internalSecret.equals(req.getHeader("X-Internal-Secret"));
    }

    /** Consume a one-time WS token. Returns user info or 404 if invalid/expired. */
    @GetMapping("/ws-token/{token}")
    public ResponseEntity<Map<String, Object>> validateWsToken(@PathVariable String token, HttpServletRequest req) {
        if (!authorized(req)) return ResponseEntity.status(403).build();
        UUID uid = wsTokenStore.consume(token);
        if (uid == null) return ResponseEntity.notFound().build();
        return userRepo.findById(uid).map(u -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", u.getId().toString());
            m.put("username", u.getUsername());
            return ResponseEntity.ok(m);
        }).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/rooms/{id}/detail")
    public ResponseEntity<Map<String, Object>> detail(@PathVariable UUID id, HttpServletRequest req) {
        if (!authorized(req)) return ResponseEntity.status(403).build();
        return roomRepo.findById(id).map(r -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", r.getId().toString());
            m.put("hostId", r.getHostId().toString());
            m.put("name", r.getName());
            return ResponseEntity.ok(m);
        }).orElse(ResponseEntity.notFound().build());
    }

    // Atomically pops the next track from the queue and returns its metadata.
    // Returns 204 when queue is empty.
    @PostMapping("/rooms/{id}/queue/pop")
    public ResponseEntity<?> queuePop(@PathVariable UUID id, HttpServletRequest req) {
        if (!authorized(req)) return ResponseEntity.status(403).build();
        var next = queueRepo.findFirstByRoomIdOrderByPosition(id);
        if (next.isEmpty()) return ResponseEntity.noContent().build();
        queueRepo.deleteById(next.get().getId());
        return trackRepo.findById(next.get().getTrackId()).map(t -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", t.getId().toString());
            m.put("title", t.getTitle());
            m.put("artist", t.getArtist());
            m.put("durationMs", t.getDurationMs());
            m.put("coverKey", t.getCoverKey());
            return ResponseEntity.ok(m);
        }).orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }
}
