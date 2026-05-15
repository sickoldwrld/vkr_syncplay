package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "playlists")
@Getter @Setter
public class Playlist {
    @Id @GeneratedValue
    private UUID id;
    @Column(nullable = false, length = 100)
    private String name;
    @Column(name = "owner_id", nullable = false)
    private UUID ownerId;
    @Column(name = "is_public")
    private boolean isPublic;
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
