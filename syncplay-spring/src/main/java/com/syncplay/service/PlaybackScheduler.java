package com.syncplay.service;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.concurrent.*;

@Component
public class PlaybackScheduler {
    private final ScheduledExecutorService executor = Executors.newScheduledThreadPool(4);
    private final ConcurrentHashMap<UUID, ScheduledFuture<?>> tasks = new ConcurrentHashMap<>();
    private final ObjectProvider<RoomService> roomServiceProvider;

    public PlaybackScheduler(ObjectProvider<RoomService> roomServiceProvider) {
        this.roomServiceProvider = roomServiceProvider;
    }

    public void schedule(UUID roomId, long delayMs) {
        cancel(roomId);
        var f = executor.schedule(() -> {
            try { roomServiceProvider.getObject().skipToNext(roomId); }
            catch (Exception e) { e.printStackTrace(); }
        }, delayMs, TimeUnit.MILLISECONDS);
        tasks.put(roomId, f);
    }

    public void cancel(UUID roomId) {
        var f = tasks.remove(roomId);
        if (f != null) f.cancel(false);
    }

    @PreDestroy
    void shutdown() {
        executor.shutdown();
        try { if (!executor.awaitTermination(5, TimeUnit.SECONDS)) executor.shutdownNow(); }
        catch (InterruptedException e) { executor.shutdownNow(); }
    }
}
