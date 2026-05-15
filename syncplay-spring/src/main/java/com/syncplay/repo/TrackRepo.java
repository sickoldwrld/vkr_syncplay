package com.syncplay.repo;

import com.syncplay.model.Track;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.UUID;

public interface TrackRepo extends JpaRepository<Track, UUID> {
    List<Track> findAllByOrderByCreatedAtDesc();
    List<Track> findByUploadedBy(UUID uploadedBy);

    @Query("SELECT t FROM Track t WHERE LOWER(t.title) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(t.artist) LIKE LOWER(CONCAT('%', :q, '%')) " +
           "OR LOWER(t.album) LIKE LOWER(CONCAT('%', :q, '%'))")
    List<Track> search(String q);
}
