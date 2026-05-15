package com.syncplay.repo;

import com.syncplay.model.TrackLike;
import com.syncplay.model.TrackLikeId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public interface TrackLikeRepo extends JpaRepository<TrackLike, TrackLikeId> {
    boolean existsByUserIdAndTrackId(UUID userId, UUID trackId);
    void deleteByUserIdAndTrackId(UUID userId, UUID trackId);

    @Query("SELECT l.trackId FROM TrackLike l WHERE l.userId = :uid")
    Set<UUID> findLikedTrackIds(@Param("uid") UUID userId);

    @Query("SELECT l.trackId FROM TrackLike l WHERE l.userId = :uid ORDER BY l.likedAt DESC")
    List<UUID> findLikedTrackIdsOrdered(@Param("uid") UUID userId);
}
