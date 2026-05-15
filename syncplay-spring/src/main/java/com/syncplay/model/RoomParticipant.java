package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "room_participants")
@IdClass(RoomParticipantId.class)
@Getter @Setter
public class RoomParticipant {
    @Id @Column(name = "room_id") private UUID roomId;
    @Id @Column(name = "user_id") private UUID userId;
    @Column(length = 20) @Enumerated(EnumType.STRING)
    private ParticipantRole role = ParticipantRole.LISTENER;
    @Column(name = "joined_at", insertable = false, updatable = false)
    private LocalDateTime joinedAt;
}
