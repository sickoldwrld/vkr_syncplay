package com.syncplay.service;

import com.syncplay.model.*;
import com.syncplay.repo.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class RoomService {
    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    private final RoomRepo roomRepo;
    private final RoomParticipantRepo participantRepo;
    private final RoomQueueRepo queueRepo;
    private final TrackRepo trackRepo;
    private final UserRepo userRepo;
    private final SessionManager sessions;
    private final PlaybackScheduler scheduler;
    private final FriendService friendService;

    private static final long MIN_SCHEDULE_MS = 5000;

    public RoomService(RoomRepo r, RoomParticipantRepo p, RoomQueueRepo q, TrackRepo t,
                       UserRepo u, SessionManager s, PlaybackScheduler sc, FriendService f) {
        this.roomRepo = r; this.participantRepo = p; this.queueRepo = q;
        this.trackRepo = t; this.userRepo = u; this.sessions = s; this.scheduler = sc;
        this.friendService = f;
    }

    @Transactional
    public ListeningRoom createRoom(UUID userId, String name) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("Name required");
        ListeningRoom r = new ListeningRoom();
        r.setName(name.trim()); r.setHostId(userId); r.setMaxListeners(50);
        r = roomRepo.save(r);

        var p = new RoomParticipant();
        p.setRoomId(r.getId()); p.setUserId(userId); p.setRole(ParticipantRole.HOST);
        participantRepo.save(p);
        return r;
    }

    @Transactional
    public ListeningRoom joinRoom(UUID roomId, UUID userId) {
        ListeningRoom r = roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Room not found"));
        if (!participantRepo.existsByRoomIdAndUserId(roomId, userId)) {
            if (participantRepo.countByRoomId(roomId) >= r.getMaxListeners())
                throw new RuntimeException("Room full");
            var p = new RoomParticipant();
            p.setRoomId(roomId); p.setUserId(userId); p.setRole(ParticipantRole.LISTENER);
            participantRepo.save(p);
            broadcast(roomId, Map.of("type","PARTICIPANT_UPDATE","action","JOINED",
                "count", participantRepo.countByRoomId(roomId)));
        }
        return r;
    }

    @Transactional
    public void leaveRoom(UUID roomId, UUID userId) {
        try { friendService.clearNowPlaying(userId); } catch (Exception ignore) {}
        participantRepo.deleteByRoomIdAndUserId(roomId, userId);
        if (participantRepo.countByRoomId(roomId) == 0) {
            roomRepo.findById(roomId).ifPresent(r -> { r.setActive(false); roomRepo.save(r); });
            scheduler.cancel(roomId);
            queueRepo.deleteByRoomId(roomId);
        } else {
            broadcast(roomId, Map.of("type","PARTICIPANT_UPDATE","action","LEFT",
                "count", participantRepo.countByRoomId(roomId)));
        }
    }

    @Transactional
    public void addToQueue(UUID roomId, UUID trackId, UUID userId) {
        roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Room not found"));
        trackRepo.findById(trackId).orElseThrow(() -> new RuntimeException("Track not found"));
        int max = queueRepo.maxPosition(roomId);
        var q = new RoomQueue();
        q.setRoomId(roomId); q.setTrackId(trackId); q.setAddedBy(userId); q.setPosition(max + 1);
        queueRepo.save(q);
        broadcast(roomId, Map.of("type","QUEUE_UPDATE"));
    }

    @Transactional
    public void preloadFromPlaylist(UUID roomId, UUID playlistId, UUID userId, int limit, PlaylistTrackRepo ptRepo) {
        var pts = ptRepo.findByPlaylistIdOrderByPosition(playlistId);
        int count = 0;
        for (var pt : pts) {
            if (count >= limit) break;
            try { addToQueue(roomId, pt.getTrackId(), userId); count++; } catch (Exception ignore) {}
        }
    }

    @Transactional
    public void handleCommand(UUID roomId, UUID userId, String command, Long seekMs) {
        ListeningRoom room = roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Not found"));
        if (!room.getHostId().equals(userId)) throw new RuntimeException("Only host");
        switch (command) {
            case "PLAY"  -> doPlay(room);
            case "PAUSE" -> doPause(room);
            case "SKIP"  -> skipToNext(roomId);
            case "SEEK"  -> doSeek(room, seekMs != null ? seekMs : 0);
        }
    }

    private void doPlay(ListeningRoom room) {
        if (room.getPlaybackState() == PlaybackState.PLAYING) return;
        UUID roomId = room.getId();
        long now = System.currentTimeMillis();
        if (room.getCurrentTrackId() == null) {
            var next = queueRepo.findFirstByRoomIdOrderByPosition(roomId);
            if (next.isEmpty()) throw new RuntimeException("Queue empty");
            room.setCurrentTrackId(next.get().getTrackId());
            room.setPositionMs(0);
            queueRepo.deleteById(next.get().getId());
        }
        room.setPlaybackState(PlaybackState.PLAYING);
        room.setLastSyncTimestamp(now);
        roomRepo.save(room);

        Track t = trackRepo.findById(room.getCurrentTrackId()).orElseThrow();
        long remaining = t.getDurationMs() - room.getPositionMs();
        log.info("doPlay room={} track={} title={} durationMs={} positionMs={} remaining={}",
            roomId, t.getId(), t.getTitle(), t.getDurationMs(), room.getPositionMs(), remaining);
        // Защита: не планируем skip если duration не определён (== 0) — клиент сам пришлёт SKIP по audio.onended
        if (remaining > MIN_SCHEDULE_MS) {
            scheduler.schedule(roomId, remaining);
            log.info("  → scheduled skip in {}ms", remaining);
        } else {
            log.info("  → skip NOT scheduled (remaining {} <= MIN_SCHEDULE_MS {})", remaining, MIN_SCHEDULE_MS);
        }
        broadcastPlayback(roomId, room.getPlaybackState(), room.getPositionMs(), now, t, room.getHostId());
        updatePresenceForRoom(roomId, room.getCurrentTrackId());
    }

    private void doPause(ListeningRoom room) {
        UUID roomId = room.getId();
        long now = System.currentTimeMillis();
        long pos = room.getPositionMs() + (now - room.getLastSyncTimestamp());
        room.setPositionMs(pos);
        room.setPlaybackState(PlaybackState.PAUSED);
        room.setLastSyncTimestamp(now);
        roomRepo.save(room);
        scheduler.cancel(roomId);
        Track t = room.getCurrentTrackId() != null ? trackRepo.findById(room.getCurrentTrackId()).orElse(null) : null;
        broadcastPlayback(roomId, PlaybackState.PAUSED, pos, now, t, room.getHostId());
    }

    private void doSeek(ListeningRoom room, long posMs) {
        UUID roomId = room.getId();
        long now = System.currentTimeMillis();
        room.setPositionMs(posMs);
        room.setLastSyncTimestamp(now);
        roomRepo.save(room);
        if (room.getPlaybackState() == PlaybackState.PLAYING && room.getCurrentTrackId() != null) {
            Track t = trackRepo.findById(room.getCurrentTrackId()).orElseThrow();
            long remaining = t.getDurationMs() - posMs;
            if (remaining > MIN_SCHEDULE_MS) {
                scheduler.schedule(roomId, remaining);
            }
        }
        Track t = room.getCurrentTrackId() != null ? trackRepo.findById(room.getCurrentTrackId()).orElse(null) : null;
        broadcastPlayback(roomId, room.getPlaybackState(), posMs, now, t, room.getHostId());
    }

    @Transactional
    public void skipToNext(UUID roomId) {
        log.info("skipToNext room={} (called from scheduler or SKIP cmd)", roomId);
        scheduler.cancel(roomId);
        ListeningRoom room = roomRepo.findById(roomId).orElse(null);
        if (room == null) return;
        var next = queueRepo.findFirstByRoomIdOrderByPosition(roomId);
        long now = System.currentTimeMillis();
        if (next.isPresent()) {
            UUID tid = next.get().getTrackId();
            queueRepo.deleteById(next.get().getId());
            room.setCurrentTrackId(tid); room.setPositionMs(0);
            room.setPlaybackState(PlaybackState.PLAYING); room.setLastSyncTimestamp(now);
            roomRepo.save(room);
            Track t = trackRepo.findById(tid).orElseThrow();
            log.info("  → next track={} title={} durationMs={}", tid, t.getTitle(), t.getDurationMs());
            // Защита от duration=0
            if (t.getDurationMs() > MIN_SCHEDULE_MS) {
                scheduler.schedule(roomId, t.getDurationMs());
                log.info("  → scheduled next skip in {}ms", t.getDurationMs());
            } else {
                log.info("  → skip NOT scheduled (durationMs {} <= MIN_SCHEDULE_MS {})", t.getDurationMs(), MIN_SCHEDULE_MS);
            }
            broadcastPlayback(roomId, PlaybackState.PLAYING, 0, now, t, room.getHostId());
            updatePresenceForRoom(roomId, tid);
        } else {
            room.setCurrentTrackId(null); room.setPositionMs(0);
            room.setPlaybackState(PlaybackState.STOPPED); room.setLastSyncTimestamp(now);
            roomRepo.save(room);
            broadcastPlayback(roomId, PlaybackState.STOPPED, 0, now, null, room.getHostId());
            clearPresenceForRoom(roomId);
        }
    }

    public List<Map<String, Object>> getActiveRooms() {
        return roomRepo.findByIsActiveTrueOrderByCreatedAtDesc().stream().map(r -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", r.getId().toString()); m.put("name", r.getName());
            m.put("state", r.getPlaybackState().name());
            m.put("count", participantRepo.countByRoomId(r.getId()));
            userRepo.findById(r.getHostId()).ifPresent(h -> m.put("hostName", h.getUsername()));
            if (r.getCurrentTrackId() != null) trackRepo.findById(r.getCurrentTrackId())
                .ifPresent(t -> m.put("track", t.getTitle() + " — " + t.getArtist()));
            return m;
        }).toList();
    }

    public List<Map<String, Object>> getQueueEnriched(UUID roomId) {
        return queueRepo.findByRoomIdOrderByPosition(roomId).stream().map(q -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", q.getId().toString()); m.put("trackId", q.getTrackId().toString());
            m.put("position", q.getPosition());
            trackRepo.findById(q.getTrackId()).ifPresent(t -> {
                m.put("title", t.getTitle()); m.put("artist", t.getArtist()); m.put("durationMs", t.getDurationMs());
                m.put("coverKey", t.getCoverKey());
            });
            return m;
        }).toList();
    }

    /** Вызывается из WS-хендлера при подключении пользователя к комнате.
     *  Если комната уже играет — сразу помечаем пользователя как live. */
    public void updatePresenceOnConnect(UUID roomId, UUID userId) {
        roomRepo.findById(roomId).ifPresent(room -> {
            if (room.getPlaybackState() == PlaybackState.PLAYING && room.getCurrentTrackId() != null) {
                try { friendService.updateNowPlaying(userId, room.getCurrentTrackId(), roomId); } catch (Exception ignore) {}
            } else {
                try { friendService.touchPresence(userId); } catch (Exception ignore) {}
            }
        });
    }

    private void updatePresenceForRoom(UUID roomId, UUID trackId) {
        for (UUID uid : sessions.getActiveUserIds(roomId)) {
            try { friendService.updateNowPlaying(uid, trackId, roomId); } catch (Exception ignore) {}
        }
    }

    private void clearPresenceForRoom(UUID roomId) {
        for (UUID uid : sessions.getActiveUserIds(roomId)) {
            try { friendService.clearNowPlaying(uid); } catch (Exception ignore) {}
        }
    }

    private void broadcastPlayback(UUID roomId, PlaybackState state, long pos, long ts, Track t, UUID hostId) {
        Map<String, Object> m = new HashMap<>();
        m.put("type", "PLAYBACK_UPDATE"); m.put("state", state.name());
        m.put("positionMs", pos); m.put("timestamp", ts);
        if (hostId != null) m.put("hostId", hostId.toString());
        if (t != null) {
            m.put("trackId", t.getId().toString()); m.put("title", t.getTitle());
            m.put("artist", t.getArtist()); m.put("durationMs", t.getDurationMs());
            m.put("coverKey", t.getCoverKey());
        }
        sessions.broadcastToRoom(roomId, m);
    }

    public java.util.Optional<com.syncplay.model.ListeningRoom> getRoomById(UUID roomId) {
        return roomRepo.findById(roomId);
    }

    public long getExpectedPositionMs(UUID roomId) {
        ListeningRoom room = roomRepo.findById(roomId).orElse(null);
        if (room == null || room.getPlaybackState() != PlaybackState.PLAYING) return -1L;
        long now = System.currentTimeMillis();
        return room.getPositionMs() + (now - room.getLastSyncTimestamp());
    }

    public void broadcast(UUID roomId, Object msg) { sessions.broadcastToRoom(roomId, msg); }

    /** Снимок состояния комнаты для нового подключившегося клиента.
     *  Возвращает type="PLAYBACK_UPDATE" с актуальной позицией (с учётом lastSyncTimestamp). */
    public Map<String, Object> getSnapshot(UUID roomId) {
        Map<String, Object> m = new HashMap<>();
        m.put("type", "PLAYBACK_UPDATE");
        ListeningRoom room = roomRepo.findById(roomId).orElse(null);
        if (room == null) { m.put("state", "STOPPED"); return m; }
        long now = System.currentTimeMillis();
        long pos = room.getPositionMs();
        // Если играет — компенсируем время с момента lastSync
        if (room.getPlaybackState() == PlaybackState.PLAYING && room.getLastSyncTimestamp() > 0) {
            pos = pos + (now - room.getLastSyncTimestamp());
        }
        m.put("state", room.getPlaybackState().name());
        m.put("positionMs", pos);
        m.put("timestamp", now);
        m.put("hostId", room.getHostId() != null ? room.getHostId().toString() : null);
        if (room.getCurrentTrackId() != null) {
            trackRepo.findById(room.getCurrentTrackId()).ifPresent(t -> {
                m.put("trackId", t.getId().toString());
                m.put("title", t.getTitle());
                m.put("artist", t.getArtist());
                m.put("durationMs", t.getDurationMs());
                m.put("coverKey", t.getCoverKey());
            });
        }
        return m;
    }
}
