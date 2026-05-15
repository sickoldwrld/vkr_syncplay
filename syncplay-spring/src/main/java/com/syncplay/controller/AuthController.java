package com.syncplay.controller;

import com.syncplay.security.AuthHelper;
import com.syncplay.service.AuthService;
import com.syncplay.service.FriendService;
import com.syncplay.service.WsTokenStore;
import com.syncplay.repo.UserRepo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;
    private final UserRepo userRepo;
    private final FriendService friendService;
    private final WsTokenStore wsTokenStore;

    public AuthController(AuthService a, UserRepo u, FriendService f, WsTokenStore w) {
        this.authService = a; this.userRepo = u; this.friendService = f; this.wsTokenStore = w;
    }

    @PostMapping("/register")
    public Map<String, Object> register(@RequestBody Map<String, String> body,
                                         HttpServletRequest req, HttpServletResponse resp) {
        var u = authService.register(body.get("username"), body.get("email"), body.get("password"));
        // Сразу логиним после регистрации
        authService.login(body.get("username"), body.get("password"), req, resp);
        return Map.of("id", u.getId().toString(), "username", u.getUsername());
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, String> body,
                                      HttpServletRequest req, HttpServletResponse resp) {
        authService.login(body.get("username"), body.get("password"), req, resp);
        var u = userRepo.findByUsername(body.get("username")).orElseThrow();
        return Map.of("id", u.getId().toString(), "username", u.getUsername());
    }

    /** Heartbeat: клиент дёргает раз в 20с пока вкладка активна.
     *  Обновляет updatedAt в UserNowPlaying чтобы друзья видели «онлайн». */
    @PostMapping("/ping")
    public ResponseEntity<Void> ping() {
        UUID uid = AuthHelper.currentUserId();
        if (uid != null) friendService.touchPresence(uid);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public ResponseEntity<?> me() {
        var uid = AuthHelper.currentUserId();
        if (uid == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(Map.of("error", "Not authenticated"));
        var u = userRepo.findById(uid).orElseThrow();
        return ResponseEntity.ok(Map.of(
            "id", u.getId().toString(),
            "username", u.getUsername(),
            "email", u.getEmail()
        ));
    }

    /** Short-lived one-time token for WebSocket auth (avoids cross-port cookie issues). */
    @GetMapping("/ws-token")
    public ResponseEntity<?> wsToken() {
        UUID uid = AuthHelper.currentUserId();
        if (uid == null) {
            System.out.println("[ws-token] requested but no user in SecurityContext → 401");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        }
        String token = wsTokenStore.issue(uid);
        System.out.println("[ws-token] issued for user=" + uid + " token=" + token.substring(0, 8) + "…");
        return ResponseEntity.ok(Map.of("token", token));
    }
}
