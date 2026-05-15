package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter; import lombok.Setter;
import java.time.LocalDateTime; import java.util.UUID;

@Entity
@Table(name = "friendships")
@IdClass(FriendshipId.class)
@Getter @Setter
public class Friendship {
    @Id @Column(name = "user_id") private UUID userId;
    @Id @Column(name = "friend_id") private UUID friendId;
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
