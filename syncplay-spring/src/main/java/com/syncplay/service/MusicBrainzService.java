package com.syncplay.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncplay.model.Track;
import com.syncplay.repo.TrackRepo;
import com.syncplay.storage.MinioStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * MusicBrainz-обогащение метаданных трека.
 *
 * Сценарий: пользователь жмёт «Уточнить теги» в TrackContextMenu, фронт делает
 * POST /api/tracks/{id}/refine-metadata. Сервис ищет recording по
 * (artist + title) на MusicBrainz, выбирает лучший по score, тянет cover-art
 * из CoverArtArchive по release-MBID и сохраняет обновления в БД + MinIO.
 *
 * Внешние сервисы:
 *   - https://musicbrainz.org/ws/2/recording?query=...&fmt=json — поиск
 *   - https://coverartarchive.org/release/{mbid}/front-500 — обложка
 *
 * MusicBrainz требует User-Agent (см. https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
 * Кастомный UA задаётся через musicbrainz.user-agent.
 */
@Service
public class MusicBrainzService {

    private static final Logger log = LoggerFactory.getLogger(MusicBrainzService.class);
    private static final int MIN_ACCEPT_SCORE = 80; // MusicBrainz score 0..100
    private static final int MAX_CANDIDATES = 5;
    private static final int COVER_MAX_BYTES = 2_000_000;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final TrackRepo trackRepo;
    private final MinioStorage minio;

    @Value("${musicbrainz.url:https://musicbrainz.org/ws/2}")
    private String mbUrl;

    @Value("${musicbrainz.cover-art-url:https://coverartarchive.org}")
    private String coverArtUrl;

    @Value("${musicbrainz.user-agent:SyncPlay/1.0 (contact@syncplay.local)}")
    private String userAgent;

    public MusicBrainzService(TrackRepo trackRepo, MinioStorage minio) {
        this.trackRepo = trackRepo;
        this.minio = minio;
    }

    @Transactional
    public Map<String, Object> refineTrack(UUID trackId) {
        Track t = trackRepo.findById(trackId)
                .orElseThrow(() -> new RuntimeException("Track not found"));

        String query = buildQuery(t.getTitle(), t.getArtist());
        JsonNode mbResponse;
        try {
            mbResponse = fetchRecordings(query);
        } catch (Exception e) {
            log.warn("MusicBrainz query failed for track {}: {}", trackId, e.getMessage());
            return Map.of("matched", false, "changed", List.of(), "candidates", List.of(),
                    "error", "MusicBrainz unreachable");
        }

        JsonNode recordings = mbResponse.path("recordings");
        if (!recordings.isArray() || recordings.isEmpty()) {
            return Map.of("matched", false, "changed", List.of(), "candidates", List.of());
        }

        List<Map<String, Object>> candidates = new ArrayList<>();
        JsonNode best = null;
        int bestScore = -1;
        for (JsonNode r : recordings) {
            int score = r.path("score").asInt(0);
            if (candidates.size() < MAX_CANDIDATES) {
                candidates.add(summariseCandidate(r));
            }
            if (score > bestScore) { bestScore = score; best = r; }
        }

        if (best == null || bestScore < MIN_ACCEPT_SCORE) {
            return Map.of("matched", false, "changed", List.of(), "candidates", candidates,
                    "bestScore", bestScore);
        }

        String mbArtist = firstArtistName(best);
        JsonNode releaseNode = bestRelease(best);
        String mbAlbum = releaseNode != null ? releaseNode.path("title").asText(null) : null;
        Integer mbYear = parseYear(releaseNode != null ? releaseNode.path("date").asText(null) : null);
        String releaseMbid = releaseNode != null ? releaseNode.path("id").asText(null) : null;

        List<String> changed = new ArrayList<>();
        if (mbArtist != null && !mbArtist.equals(t.getArtist())) {
            t.setArtist(mbArtist); changed.add("artist");
        }
        if (mbAlbum != null && !mbAlbum.equals(t.getAlbum())) {
            t.setAlbum(mbAlbum); changed.add("album");
        }
        if (mbYear != null && !mbYear.equals(t.getReleaseYear())) {
            t.setReleaseYear(mbYear); changed.add("year");
        }

        String coverKey = t.getCoverKey();
        if (releaseMbid != null && (coverKey == null || coverKey.isBlank())) {
            String newKey = tryFetchCover(releaseMbid);
            if (newKey != null) { t.setCoverKey(newKey); coverKey = newKey; changed.add("coverArt"); }
        }

        trackRepo.save(t);

        Map<String, Object> out = new HashMap<>();
        out.put("matched", true);
        out.put("changed", changed);
        out.put("artist", t.getArtist());
        out.put("album", t.getAlbum());
        out.put("year", t.getReleaseYear());
        out.put("coverKey", coverKey);
        out.put("score", bestScore);
        out.put("candidates", candidates);
        return out;
    }

    private String buildQuery(String title, String artist) {
        StringBuilder sb = new StringBuilder();
        if (title != null && !title.isBlank()) {
            sb.append("recording:\"").append(escape(title)).append("\"");
        }
        if (artist != null && !artist.isBlank()) {
            if (sb.length() > 0) sb.append(" AND ");
            sb.append("artist:\"").append(escape(artist)).append("\"");
        }
        return sb.toString();
    }

    private static String escape(String s) { return s.replace("\"", "\\\""); }

    private JsonNode fetchRecordings(String query) throws Exception {
        String url = mbUrl + "/recording?query=" + URLEncoder.encode(query, StandardCharsets.UTF_8)
                + "&fmt=json&limit=" + MAX_CANDIDATES;
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .header("Accept", "application/json")
                .header("User-Agent", userAgent)
                .GET()
                .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            throw new RuntimeException("MusicBrainz status " + resp.statusCode());
        }
        return mapper.readTree(resp.body());
    }

    private static Map<String, Object> summariseCandidate(JsonNode r) {
        Map<String, Object> m = new HashMap<>();
        m.put("title", r.path("title").asText(""));
        m.put("artist", firstArtistName(r));
        JsonNode rel = bestRelease(r);
        if (rel != null) {
            m.put("album", rel.path("title").asText(null));
            Integer y = parseYear(rel.path("date").asText(null));
            if (y != null) m.put("year", y);
        }
        m.put("score", r.path("score").asInt(0));
        return m;
    }

    private static String firstArtistName(JsonNode recording) {
        JsonNode credit = recording.path("artist-credit");
        if (credit.isArray() && !credit.isEmpty()) {
            JsonNode artist = credit.get(0).path("artist");
            String name = artist.path("name").asText(null);
            if (name != null) return name;
            return credit.get(0).path("name").asText(null);
        }
        return null;
    }

    /** Выбирает первый release с непустым date. Это эвристика для самого старого/официального. */
    private static JsonNode bestRelease(JsonNode recording) {
        JsonNode releases = recording.path("releases");
        if (!releases.isArray() || releases.isEmpty()) return null;
        JsonNode fallback = releases.get(0);
        for (JsonNode r : releases) {
            String date = r.path("date").asText(null);
            if (date != null && !date.isBlank()) return r;
        }
        return fallback;
    }

    private static Integer parseYear(String date) {
        if (date == null || date.length() < 4) return null;
        try {
            int y = Integer.parseInt(date.substring(0, 4));
            if (y < 1900 || y > 2100) return null;
            return y;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Тянет front-500 cover из Cover Art Archive и заливает в MinIO. */
    private String tryFetchCover(String releaseMbid) {
        try {
            String url = coverArtUrl + "/release/" + releaseMbid + "/front-500";
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .header("User-Agent", userAgent)
                    .GET()
                    .build();
            HttpResponse<byte[]> resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() >= 400) return null;
            byte[] body = resp.body();
            if (body == null || body.length == 0 || body.length > COVER_MAX_BYTES) return null;
            String ct = resp.headers().firstValue("Content-Type").orElse("image/jpeg");
            String ext = ct.contains("png") ? "png" : "jpg";
            return minio.upload(new ByteArrayInputStream(body), body.length, ct, "covers", ext);
        } catch (Exception e) {
            log.warn("Cover art fetch failed for release {}: {}", releaseMbid, e.getMessage());
            return null;
        }
    }
}
