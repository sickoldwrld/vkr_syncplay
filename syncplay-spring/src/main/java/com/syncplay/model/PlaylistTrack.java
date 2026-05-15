package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "playlist_tracks")
@IdClass(PlaylistTrackId.class)
@Getter @Setter
public class PlaylistTrack {
    @Id @Column(name = "playlist_id")
    private UUID playlistId;
    @Id @Column(name = "track_id")
    private UUID trackId;
    @Column(nullable = false)
    private int position;
    @Column(name = "added_at", insertable = false, updatable = false)
    private LocalDateTime addedAt;
}
