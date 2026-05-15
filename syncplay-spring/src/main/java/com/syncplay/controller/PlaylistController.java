package com.syncplay.controller;

import com.syncplay.security.AuthHelper;
import com.syncplay.service.PlaylistService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/playlists")
public class PlaylistController {
    private final PlaylistService service;
    public PlaylistController(PlaylistService s) { this.service = s; }

    @GetMapping
    public List<Map<String, Object>> myPlaylists() {
        UUID uid = AuthHelper.currentUserId();
        Set<UUID> liked = service.likedPlaylistIds(uid);
        return service.getByOwner(uid).stream().map(p -> Map.<String, Object>of(
            "id", p.getId().toString(),
            "name", p.getName(),
            "isPublic", p.isPublic(),
            "liked", liked.contains(p.getId())
        )).toList();
    }

    @GetMapping("/public")
    public List<Map<String, Object>> publicPlaylists() {
        return service.getPublicEnriched();
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        var p = service.create(AuthHelper.currentUserId(),
            (String) body.get("name"), Boolean.TRUE.equals(body.get("isPublic")));
        return Map.of("id", p.getId().toString(), "name", p.getName(), "isPublic", p.isPublic());
    }

    /** Редактирование плейлиста: имя, публичность. */
    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
        var p = service.update(id, AuthHelper.currentUserId(),
            (String) body.get("name"),
            body.get("isPublic") != null ? (Boolean) body.get("isPublic") : null);
        // Map.of не разрешает null — собираем вручную для устойчивости.
        Map<String, Object> m = new HashMap<>();
        m.put("id", p.getId().toString());
        m.put("name", p.getName() != null ? p.getName() : "");
        m.put("isPublic", p.isPublic());
        return m;
    }

    @GetMapping("/{id}/tracks")
    public List<Map<String, Object>> tracks(@PathVariable UUID id) {
        return service.getTracksEnriched(id);
    }

    @PostMapping("/{id}/tracks")
    public ResponseEntity<Void> addTrack(@PathVariable UUID id, @RequestBody Map<String, String> body) {
        service.addTrack(id, UUID.fromString(body.get("trackId")), AuthHelper.currentUserId());
        return ResponseEntity.status(201).build();
    }

    @DeleteMapping("/{id}/tracks/{trackId}")
    public ResponseEntity<Void> removeTrack(@PathVariable UUID id, @PathVariable UUID trackId) {
        service.removeTrack(id, trackId, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{id}/tracks/order")
    public ResponseEntity<Void> reorderTracks(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> rawIds = (List<String>) body.get("trackIds");
        List<UUID> order = rawIds.stream().map(UUID::fromString).toList();
        service.reorderTracks(id, AuthHelper.currentUserId(), order);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        service.delete(id, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/like")
    public ResponseEntity<Void> like(@PathVariable UUID id) {
        service.like(AuthHelper.currentUserId(), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}/like")
    public ResponseEntity<Void> unlike(@PathVariable UUID id) {
        service.unlike(AuthHelper.currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}
