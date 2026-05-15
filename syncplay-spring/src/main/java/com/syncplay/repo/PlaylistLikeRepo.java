package com.syncplay.repo;

import com.syncplay.model.PlaylistLike;
import com.syncplay.model.PlaylistLikeId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Set;
import java.util.UUID;

public interface PlaylistLikeRepo extends JpaRepository<PlaylistLike, PlaylistLikeId> {
    boolean existsByUserIdAndPlaylistId(UUID userId, UUID playlistId);
    void deleteByUserIdAndPlaylistId(UUID userId, UUID playlistId);

    @Query("SELECT l.playlistId FROM PlaylistLike l WHERE l.userId = :uid")
    Set<UUID> findLikedPlaylistIds(@Param("uid") UUID userId);
}
