package com.syncplay.repo;

import com.syncplay.model.ListeningRoom;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RoomRepo extends JpaRepository<ListeningRoom, UUID> {
    List<ListeningRoom> findByIsActiveTrueOrderByCreatedAtDesc();
}
