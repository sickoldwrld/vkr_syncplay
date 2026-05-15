package com.syncplay.repo;

import com.syncplay.model.UserNowPlaying;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface UserNowPlayingRepo extends JpaRepository<UserNowPlaying, UUID> {
    List<UserNowPlaying> findByUserIdIn(List<UUID> userIds);
}
