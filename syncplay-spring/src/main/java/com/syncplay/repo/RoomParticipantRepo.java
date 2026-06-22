package com.syncplay.repo;

import com.syncplay.model.ParticipantRole;
import com.syncplay.model.RoomParticipant;
import com.syncplay.model.RoomParticipantId;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RoomParticipantRepo extends JpaRepository<RoomParticipant, RoomParticipantId> {
    long countByRoomId(UUID roomId);
    boolean existsByRoomIdAndUserId(UUID roomId, UUID userId);
    void deleteByRoomIdAndUserId(UUID roomId, UUID userId);
    List<RoomParticipant> findByRoomId(UUID roomId);
    List<RoomParticipant> findByRoomIdAndRole(UUID roomId, ParticipantRole role);
}
