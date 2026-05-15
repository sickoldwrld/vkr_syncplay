package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "user_now_playing")
@Getter @Setter
public class UserNowPlaying {
    @Id @Column(name = "user_id") private UUID userId;
    @Column(name = "track_id") private UUID trackId;
    @Column(name = "room_id") private UUID roomId;
    @Column(name = "updated_at") private LocalDateTime updatedAt;
}
