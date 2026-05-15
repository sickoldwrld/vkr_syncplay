package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "friend_requests")
@Getter @Setter
public class FriendRequest {
    @Id @GeneratedValue private UUID id;
    @Column(name = "from_user_id", nullable = false) private UUID fromUserId;
    @Column(name = "to_user_id", nullable = false) private UUID toUserId;
    @Column(length = 20) @Enumerated(EnumType.STRING)
    private FriendRequestStatus status = FriendRequestStatus.PENDING;
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
