package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "tracks")
@Getter @Setter
public class Track {
    @Id @GeneratedValue
    private UUID id;
    @Column(nullable = false, length = 200)
    private String title;
    @Column(length = 200)
    private String artist;
    @Column(length = 200)
    private String album;
    @Column(length = 50)
    private String genre;
    @Column(name = "duration_ms", nullable = false)
    private long durationMs;
    @Column(name = "minio_key", nullable = false)
    private String minioKey;
    @Column(name = "cover_key")
    private String coverKey;
    @Column(name = "file_size", nullable = false)
    private long fileSize;
    @Column(name = "content_type", nullable = false, length = 50)
    private String contentType;
    @Column(name = "uploaded_by", nullable = false)
    private UUID uploadedBy;
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
