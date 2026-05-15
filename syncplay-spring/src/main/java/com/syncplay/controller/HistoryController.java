package com.syncplay.controller;

import com.syncplay.security.AuthHelper;
import com.syncplay.service.HistoryService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/history")
public class HistoryController {
    private final HistoryService service;
    public HistoryController(HistoryService s) { this.service = s; }

    @GetMapping
    public List<Map<String, Object>> recent(@RequestParam(defaultValue = "30") int limit) {
        return service.getRecentHistory(AuthHelper.currentUserId(), limit);
    }

    @PostMapping
    public ResponseEntity<Void> record(@RequestBody Map<String, Object> body) {
        UUID userId = AuthHelper.currentUserId();
        UUID trackId = UUID.fromString((String) body.get("trackId"));
        UUID roomId = body.get("roomId") != null ? UUID.fromString((String) body.get("roomId")) : null;
        long durationMs = body.get("durationMs") != null ? ((Number) body.get("durationMs")).longValue() : 0;
        service.record(userId, trackId, roomId, durationMs);
        return ResponseEntity.noContent().build();
    }
}
