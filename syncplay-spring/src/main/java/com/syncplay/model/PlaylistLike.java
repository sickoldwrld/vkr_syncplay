package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "playlist_likes")
@IdClass(PlaylistLikeId.class)
@Getter @Setter
public class PlaylistLike {
    @Id @Column(name = "user_id") private UUID userId;
    @Id @Column(name = "playlist_id") private UUID playlistId;
    @Column(name = "liked_at", insertable = false, updatable = false)
    private LocalDateTime likedAt;
}
