package com.syncplay.model;

import jakarta.persistence.Embeddable;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.util.UUID;

@Embeddable
@Getter
@Setter
@NoArgsConstructor
@EqualsAndHashCode
public class RoomQueueVoteId implements Serializable {
    private UUID queueId;
    private UUID userId;

    public RoomQueueVoteId(UUID queueId, UUID userId) {
        this.queueId = queueId;
        this.userId = userId;
    }
}
