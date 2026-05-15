package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "listening_rooms")
@Getter @Setter
public class ListeningRoom {
    @Id @GeneratedValue
    private UUID id;
    @Column(nullable = false, length = 100)
    private String name;
    @Column(name = "host_id", nullable = false)
    private UUID hostId;
    @Column(name = "current_track_id")
    private UUID currentTrackId;
    @Column(name = "is_active")
    private boolean isActive = true;
    @Column(name = "max_listeners")
    private int maxListeners = 50;
    @Column(name = "playback_state", length = 20)
    @Enumerated(EnumType.STRING)
    private PlaybackState playbackState = PlaybackState.STOPPED;
    @Column(name = "position_ms")
    private long positionMs;
    @Column(name = "last_sync_timestamp")
    private long lastSyncTimestamp;
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
