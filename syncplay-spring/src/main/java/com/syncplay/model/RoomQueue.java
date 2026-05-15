package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "room_queue")
@Getter @Setter
public class RoomQueue {
    @Id @GeneratedValue private UUID id;
    @Column(name = "room_id", nullable = false) private UUID roomId;
    @Column(name = "track_id", nullable = false) private UUID trackId;
    @Column(name = "added_by", nullable = false) private UUID addedBy;
    @Column(nullable = false) private int position;
    @Column(name = "added_at", insertable = false, updatable = false)
    private LocalDateTime addedAt;
}
