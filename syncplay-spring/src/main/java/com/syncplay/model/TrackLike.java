package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "track_likes")
@IdClass(TrackLikeId.class)
@Getter @Setter
public class TrackLike {
    @Id @Column(name = "user_id") private UUID userId;
    @Id @Column(name = "track_id") private UUID trackId;
    @Column(name = "liked_at", insertable = false, updatable = false)
    private LocalDateTime likedAt;
}
