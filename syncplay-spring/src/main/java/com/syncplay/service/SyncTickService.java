package com.syncplay.service;

import com.syncplay.model.PlaybackState;
import com.syncplay.repo.RoomRepo;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Broadcasts SERVER_TICK to all playing rooms every 1.5s.
 * Acts as a reliable position fallback independent of the host browser.
 * Listeners use this to stay in sync even if host's HOST_POSITION fails.
 */
@Component
public class SyncTickService {
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sync-tick");
        t.setDaemon(true);
        return t;
    });
    private final SessionManager sessions;
    private final RoomRepo roomRepo;

    public SyncTickService(SessionManager sessions, RoomRepo roomRepo) {
        this.sessions = sessions;
        this.roomRepo = roomRepo;
        executor.scheduleAtFixedRate(this::broadcast, 3000, 1500, TimeUnit.MILLISECONDS);
    }

    private void broadcast() {
        try {
            var activeRoomIds = sessions.getActiveRoomIds();
            if (activeRoomIds.isEmpty()) return;
            long now = System.currentTimeMillis();
            for (UUID roomId : activeRoomIds) {
                roomRepo.findById(roomId).ifPresent(room -> {
                    if (room.getPlaybackState() != PlaybackState.PLAYING) return;
                    if (room.getLastSyncTimestamp() <= 0) return;
                    long pos = room.getPositionMs() + (now - room.getLastSyncTimestamp());
                    if (pos < 0) return;
                    Map<String, Object> msg = new HashMap<>();
                    msg.put("type", "SERVER_TICK");
                    msg.put("positionMs", pos);
                    msg.put("timestamp", now);
                    sessions.broadcastToRoom(roomId, msg);
                });
            }
        } catch (Exception e) {
            // Never let a tick failure propagate
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdown();
        try { if (!executor.awaitTermination(2, TimeUnit.SECONDS)) executor.shutdownNow(); }
        catch (InterruptedException e) { executor.shutdownNow(); }
    }
}
