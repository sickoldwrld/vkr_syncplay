package com.syncplay.service;

import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory one-time-use tokens for WebSocket auth.
 * Issued from /api/auth/ws-token (requires session cookie),
 * consumed by sync-server via /internal/ws-token/{token}.
 *
 * Why: WS may run on a different port than the HTTP session origin
 * (sync-server is on :3002 while Spring is on :8080). Browsers handle
 * cross-port cookies on WebSocket upgrades inconsistently — especially
 * iOS Safari and Chrome incognito. Tokens move auth into the URL so the
 * mechanism is browser-agnostic.
 */
@Component
public class WsTokenStore {
    private static final long TTL_MS = 60_000; // 60s
    private final ConcurrentHashMap<String, Entry> map = new ConcurrentHashMap<>();

    private record Entry(UUID userId, long expiresAt) {}

    public String issue(UUID userId) {
        purgeExpired();
        String token = UUID.randomUUID().toString().replace("-", "");
        map.put(token, new Entry(userId, System.currentTimeMillis() + TTL_MS));
        return token;
    }

    /** Consume the token (one-time-use). Returns userId or null if invalid/expired. */
    public UUID consume(String token) {
        if (token == null) return null;
        Entry e = map.remove(token);
        if (e == null) return null;
        if (System.currentTimeMillis() > e.expiresAt) return null;
        return e.userId;
    }

    private void purgeExpired() {
        long now = System.currentTimeMillis();
        map.values().removeIf(e -> now > e.expiresAt);
    }
}
