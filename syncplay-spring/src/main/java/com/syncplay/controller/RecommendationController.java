package com.syncplay.controller;

import com.syncplay.security.AuthHelper;
import com.syncplay.service.RecommendationService;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/recommendations")
public class RecommendationController {
    private final RecommendationService service;
    public RecommendationController(RecommendationService s) { this.service = s; }

    @GetMapping
    public List<Map<String, Object>> recommend(@RequestParam(defaultValue = "20") int limit) {
        UUID userId = AuthHelper.currentUserId();
        return service.recommend(userId, limit).stream().map(t -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", t.getId().toString()); m.put("title", t.getTitle());
            m.put("artist", t.getArtist()); m.put("album", t.getAlbum()); m.put("genre", t.getGenre());
            m.put("durationMs", t.getDurationMs()); m.put("coverKey", t.getCoverKey());
            return m;
        }).toList();
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return service.getStats(AuthHelper.currentUserId());
    }
}
