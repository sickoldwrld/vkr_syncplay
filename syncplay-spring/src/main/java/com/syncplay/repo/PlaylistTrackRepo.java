package com.syncplay.repo;

import com.syncplay.model.PlaylistTrack;
import com.syncplay.model.PlaylistTrackId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.UUID;

public interface PlaylistTrackRepo extends JpaRepository<PlaylistTrack, PlaylistTrackId> {
    List<PlaylistTrack> findByPlaylistIdOrderByPosition(UUID playlistId);

    @Query("SELECT COALESCE(MAX(pt.position), 0) FROM PlaylistTrack pt WHERE pt.playlistId = :pid")
    int maxPosition(@Param("pid") UUID playlistId);

    void deleteByPlaylistId(UUID playlistId);
    void deleteByPlaylistIdAndTrackId(UUID playlistId, UUID trackId);
    long countByPlaylistId(UUID playlistId);
    boolean existsByPlaylistIdAndTrackId(UUID playlistId, UUID trackId);
}
