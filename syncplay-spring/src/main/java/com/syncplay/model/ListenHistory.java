package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "listen_history")
@Getter @Setter
public class ListenHistory {
    @Id @GeneratedValue
    private UUID id;
    @Column(name = "user_id", nullable = false) private UUID userId;
    @Column(name = "track_id", nullable = false) private UUID trackId;
    @Column(name = "room_id") private UUID roomId;
    @Column(name = "played_at", insertable = false, updatable = false)
    private LocalDateTime playedAt;
    @Column(name = "duration_ms")
    private long durationMs;
}
