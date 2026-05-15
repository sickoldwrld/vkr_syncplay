package com.syncplay.controller;

import com.syncplay.repo.TrackRepo;
import com.syncplay.storage.MinioStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/stream")
public class StreamController {
    private final TrackRepo trackRepo;
    private final MinioStorage minio;

    @Value("${minio.public-endpoint:}")
    private String minioPublicEndpoint;

    public StreamController(TrackRepo r, MinioStorage m) { this.trackRepo = r; this.minio = m; }

    @GetMapping("/{id}")
    public ResponseEntity<?> stream(@PathVariable UUID id,
                                    @RequestHeader(value = "Range", required = false) String range) {
        var t = trackRepo.findById(id).orElse(null);
        if (t == null) return ResponseEntity.notFound().build();

        long total = t.getFileSize() > 0 ? t.getFileSize() : minio.size(t.getMinioKey());
        MediaType mt = MediaType.parseMediaType(t.getContentType());

        if (range == null || !range.startsWith("bytes=")) {
            InputStream in = minio.download(t.getMinioKey());
            return ResponseEntity.ok()
                .contentType(mt).contentLength(total)
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=31536000, immutable")
                .body(new InputStreamResource(in));
        }

        String[] parts = range.substring(6).split("-");
        long start = Long.parseLong(parts[0]);
        long end = parts.length > 1 && !parts[1].isEmpty() ? Long.parseLong(parts[1]) : total - 1;
        long len = end - start + 1;

        InputStream in = minio.downloadRange(t.getMinioKey(), start, len);
        return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT)
            .contentType(mt).contentLength(len)
            .header(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + total)
            .header(HttpHeaders.ACCEPT_RANGES, "bytes")
            .header(HttpHeaders.CACHE_CONTROL, "public, max-age=31536000, immutable")
            .body(new InputStreamResource(in));
    }

    /** Обложка трека из MinIO (если была извлечена через Tika). */
    @GetMapping("/{id}/cover")
    public ResponseEntity<InputStreamResource> cover(@PathVariable UUID id) {
        var t = trackRepo.findById(id).orElse(null);
        if (t == null || t.getCoverKey() == null) return ResponseEntity.notFound().build();
        InputStream in = minio.download(t.getCoverKey());
        String ct = t.getCoverKey().endsWith(".png") ? "image/png" : "image/jpeg";
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(ct))
            .header(HttpHeaders.CACHE_CONTROL, "public, max-age=3600")
            .body(new InputStreamResource(in));
    }

    @GetMapping("/{id}/presigned")
    public Map<String, Object> presigned(@PathVariable UUID id) {
        var t = trackRepo.findById(id).orElseThrow();
        return Map.of("url", minio.presignedGet(t.getMinioKey(), 1800),
            "contentType", t.getContentType(), "size", t.getFileSize());
    }
}
