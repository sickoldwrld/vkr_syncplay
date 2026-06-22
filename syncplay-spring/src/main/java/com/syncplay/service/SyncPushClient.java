package com.syncplay.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Spring → syncplay-sync internal HTTP bridge. The sync server keeps an in-memory
 * Room.hostIds set that must be invalidated when Spring promotes/demotes a co-host;
 * a one-shot POST is the simplest way to push that update without introducing a
 * pub/sub bus. Failures are logged and swallowed — the next reconnect will pull
 * the current host list via /internal/rooms/{id}/detail.
 */
@Component
public class SyncPushClient {

    private static final Logger log = LoggerFactory.getLogger(SyncPushClient.class);

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${internal.sync-url:http://sync:3002}")
    private String syncUrl;

    @Value("${internal.secret:syncplay-internal-secret}")
    private String internalSecret;

    public void pushHosts(UUID roomId, UUID primaryHostId, List<UUID> hostIds) {
        try {
            String body = mapper.writeValueAsString(Map.of(
                    "primaryHostId", primaryHostId.toString(),
                    "hostIds", hostIds.stream().map(UUID::toString).toList()
            ));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(syncUrl + "/internal/rooms/" + roomId + "/hosts"))
                    .timeout(Duration.ofSeconds(2))
                    .header("Content-Type", "application/json")
                    .header("X-Internal-Secret", internalSecret)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 400) {
                log.warn("sync hosts push failed: status={} body={}", resp.statusCode(), resp.body());
            }
        } catch (Exception e) {
            log.warn("sync hosts push exception: {}", e.getMessage());
        }
    }

    /** Force-close every WS connection of {@code userId} in {@code roomId}. */
    public void pushKick(UUID roomId, UUID userId) {
        try {
            String body = mapper.writeValueAsString(Map.of("userId", userId.toString()));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(syncUrl + "/internal/rooms/" + roomId + "/kick"))
                    .timeout(Duration.ofSeconds(2))
                    .header("Content-Type", "application/json")
                    .header("X-Internal-Secret", internalSecret)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 400) {
                log.warn("sync kick push failed: status={} body={}", resp.statusCode(), resp.body());
            }
        } catch (Exception e) {
            log.warn("sync kick push exception: {}", e.getMessage());
        }
    }
}
