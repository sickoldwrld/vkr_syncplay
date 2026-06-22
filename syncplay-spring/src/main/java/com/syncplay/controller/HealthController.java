package com.syncplay.controller;

import com.syncplay.repo.TrackRepo;
import com.syncplay.repo.UserRepo;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Простой health endpoint для UI-индикатора (без auth).
 * Показывает что Spring жив И что БД доступна.
 * Используется фронтом для отладки «приложение не отвечает».
 */
@RestController
@RequestMapping("/api/health")
public class HealthController {
    private final UserRepo userRepo;
    private final TrackRepo trackRepo;

    public HealthController(UserRepo userRepo, TrackRepo trackRepo) {
        this.userRepo = userRepo;
        this.trackRepo = trackRepo;
    }

    @GetMapping
    public ResponseEntity<?> health() {
        long users, tracks;
        try {
            users = userRepo.count();
            tracks = trackRepo.count();
        } catch (Exception e) {
            return ResponseEntity.status(503).body(Map.of(
                "status", "DOWN",
                "db", "ERROR",
                "error", e.getMessage()
            ));
        }
        return ResponseEntity.ok(Map.of(
            "status", "UP",
            "db", "UP",
            "users", users,
            "tracks", tracks
        ));
    }
}
