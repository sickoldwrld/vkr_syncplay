package com.syncplay.repo;

import com.syncplay.model.Friendship;
import com.syncplay.model.FriendshipId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.UUID;

public interface FriendshipRepo extends JpaRepository<Friendship, FriendshipId> {
    @Query("SELECT f.friendId FROM Friendship f WHERE f.userId = :uid")
    List<UUID> findFriendIds(@Param("uid") UUID userId);

    boolean existsByUserIdAndFriendId(UUID userId, UUID friendId);
    void deleteByUserIdAndFriendId(UUID userId, UUID friendId);
}
