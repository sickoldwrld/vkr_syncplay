package com.syncplay.controller;

import com.syncplay.repo.PlaylistTrackRepo;
import com.syncplay.security.AuthHelper;
import com.syncplay.service.RoomService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomService service;
    private final PlaylistTrackRepo ptRepo;

    public RoomController(RoomService s, PlaylistTrackRepo p) {
        this.service = s; this.ptRepo = p;
    }

    @GetMapping
    public List<Map<String, Object>> list() { return service.getActiveRooms(); }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        UUID uid = AuthHelper.currentUserId();
        var r = service.createRoom(uid, (String) body.get("name"));
        // Если указан плейлист — preload первых 6 треков
        Object pl = body.get("playlistId");
        if (pl instanceof String pls && !pls.isBlank()) {
            try { service.preloadFromPlaylist(r.getId(), UUID.fromString(pls), uid, 6, ptRepo); }
            catch (Exception ignore) {}
        }
        return Map.of("id", r.getId().toString(), "name", r.getName());
    }

    @PostMapping("/{id}/join")
    public ResponseEntity<Void> join(@PathVariable UUID id) {
        service.joinRoom(id, AuthHelper.currentUserId());
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{id}/leave")
    public ResponseEntity<Void> leave(@PathVariable UUID id) {
        service.leaveRoom(id, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/queue")
    public List<Map<String, Object>> queue(@PathVariable UUID id) {
        return service.getQueueEnriched(id);
    }

    @PostMapping("/{id}/queue/{trackId}")
    public ResponseEntity<Void> addToQueue(@PathVariable UUID id, @PathVariable UUID trackId) {
        service.addToQueue(id, trackId, AuthHelper.currentUserId());
        return ResponseEntity.status(201).build();
    }
}
