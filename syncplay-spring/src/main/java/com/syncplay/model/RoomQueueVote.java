package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Один голос пользователя за один трек в очереди. (queue_id, user_id) — PK,
 * так что больше одного раза проголосовать нельзя — повторный POST = remove
 * (toggle handled at service level).
 */
@Entity
@Table(name = "room_queue_votes")
@Getter @Setter
@IdClass(RoomQueueVoteId.class)
public class RoomQueueVote {
    @Id
    @Column(name = "queue_id", nullable = false)
    private UUID queueId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "voted_at", insertable = false, updatable = false)
    private LocalDateTime votedAt;
}
