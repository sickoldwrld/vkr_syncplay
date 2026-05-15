package com.syncplay.controller;

import com.syncplay.model.Track;
import com.syncplay.security.AuthHelper;
import com.syncplay.service.TrackService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.*;

@RestController
@RequestMapping("/api/tracks")
public class TrackController {
    private final TrackService service;
    public TrackController(TrackService s) { this.service = s; }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String q) {
        UUID userId = AuthHelper.currentUserId();
        Set<UUID> liked = userId != null ? service.likedTrackIds(userId) : Set.of();
        return service.search(q).stream().map(t -> toDto(t, liked)).toList();
    }

    @GetMapping("/liked")
    public List<Map<String, Object>> liked() {
        UUID userId = AuthHelper.currentUserId();
        Set<UUID> ids = service.likedTrackIds(userId);
        return service.liked(userId).stream().map(t -> toDto(t, ids)).toList();
    }

    @PostMapping
    public Map<String, Object> upload(@RequestParam("file") MultipartFile file) {
        UUID uid = AuthHelper.currentUserId();
        Track t = service.upload(file, uid);
        return toDto(t, Set.of());
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

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        service.delete(id, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    private Map<String, Object> toDto(Track t, Set<UUID> likedIds) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", t.getId().toString());
        m.put("title", t.getTitle());
        m.put("artist", t.getArtist());
        m.put("album", t.getAlbum());
        m.put("genre", t.getGenre());
        m.put("durationMs", t.getDurationMs());
        m.put("contentType", t.getContentType());
        m.put("liked", likedIds.contains(t.getId()));
        m.put("coverKey", t.getCoverKey());
        return m;
    }
}
