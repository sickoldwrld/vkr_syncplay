package com.syncplay.repo;

import com.syncplay.model.FriendRequest;
import com.syncplay.model.FriendRequestStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FriendRequestRepo extends JpaRepository<FriendRequest, UUID> {
    List<FriendRequest> findByToUserIdAndStatus(UUID toUserId, FriendRequestStatus status);
    List<FriendRequest> findByFromUserIdAndStatus(UUID fromUserId, FriendRequestStatus status);
    Optional<FriendRequest> findByFromUserIdAndToUserId(UUID fromUserId, UUID toUserId);
}
