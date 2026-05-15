package com.syncplay.repo;

import com.syncplay.model.ListenHistory;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.UUID;

public interface ListenHistoryRepo extends JpaRepository<ListenHistory, UUID> {
    List<ListenHistory> findByUserIdOrderByPlayedAtDesc(UUID userId, Pageable pageable);

    /** Топ жанров пользователя по прослушиваниям. */
    @Query(value = """
        SELECT t.genre, COUNT(*) AS cnt
        FROM listen_history h JOIN tracks t ON t.id = h.track_id
        WHERE h.user_id = :uid AND t.genre IS NOT NULL
        GROUP BY t.genre
        ORDER BY cnt DESC
        LIMIT :lim
        """, nativeQuery = true)
    List<Object[]> topGenres(@Param("uid") UUID userId, @Param("lim") int limit);

    /** Топ артистов пользователя. */
    @Query(value = """
        SELECT t.artist, COUNT(*) AS cnt
        FROM listen_history h JOIN tracks t ON t.id = h.track_id
        WHERE h.user_id = :uid AND t.artist IS NOT NULL
        GROUP BY t.artist
        ORDER BY cnt DESC
        LIMIT :lim
        """, nativeQuery = true)
    List<Object[]> topArtists(@Param("uid") UUID userId, @Param("lim") int limit);

    /** ID треков, прослушанных недавно — исключаем из рекомендаций. */
    @Query(value = """
        SELECT DISTINCT h.track_id
        FROM listen_history h
        WHERE h.user_id = :uid
        ORDER BY h.track_id
        OFFSET 0
        """, nativeQuery = true)
    List<UUID> recentTrackIds(@Param("uid") UUID userId);
}
