package com.syncplay.repo;

import com.syncplay.model.Playlist;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface PlaylistRepo extends JpaRepository<Playlist, UUID> {
    List<Playlist> findByOwnerIdOrderByCreatedAtDesc(UUID ownerId);
    List<Playlist> findByIsPublicTrueOrderByCreatedAtDesc();
}
