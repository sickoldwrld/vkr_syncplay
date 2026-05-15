package com.syncplay.repo;

import com.syncplay.model.RoomQueue;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RoomQueueRepo extends JpaRepository<RoomQueue, UUID> {
    List<RoomQueue> findByRoomIdOrderByPosition(UUID roomId);
    Optional<RoomQueue> findFirstByRoomIdOrderByPosition(UUID roomId);
    void deleteByRoomId(UUID roomId);

    @Query("SELECT COALESCE(MAX(q.position), 0) FROM RoomQueue q WHERE q.roomId = :rid")
    int maxPosition(@Param("rid") UUID roomId);
}
