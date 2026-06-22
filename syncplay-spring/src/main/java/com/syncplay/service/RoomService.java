package com.syncplay.service;

import com.syncplay.model.*;
import com.syncplay.repo.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.NoSuchElementException;

@Service
public class RoomService {
    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    private final RoomRepo roomRepo;
    private final RoomParticipantRepo participantRepo;
    private final RoomQueueRepo queueRepo;
    private final RoomQueueVoteRepo voteRepo;
    private final TrackRepo trackRepo;
    private final UserRepo userRepo;
    private final SessionManager sessions;
    private final PlaybackScheduler scheduler;
    private final FriendService friendService;
    private final SyncPushClient syncPush;

    private static final long MIN_SCHEDULE_MS = 5000;

    public RoomService(RoomRepo r, RoomParticipantRepo p, RoomQueueRepo q, RoomQueueVoteRepo v,
                       TrackRepo t, UserRepo u, SessionManager s, PlaybackScheduler sc, FriendService f,
                       SyncPushClient sp) {
        this.roomRepo = r; this.participantRepo = p; this.queueRepo = q; this.voteRepo = v;
        this.trackRepo = t; this.userRepo = u; this.sessions = s; this.scheduler = sc;
        this.friendService = f; this.syncPush = sp;
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
        if (!isHost(roomId, userId, room)) throw new RuntimeException("Only host");
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
            var next = pickNextFromQueue(roomId);
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
        var next = pickNextFromQueue(roomId);
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

    /**
     * Очередь с голосами. Сортировка: сначала по числу голосов DESC, потом
     * по position ASC (FIFO как tiebreak). Если viewerUserId != null —
     * для каждого элемента возвращается hasMyVote.
     */
    public List<Map<String, Object>> getQueueEnriched(UUID roomId, UUID viewerUserId) {
        // votes counts (queueId → count)
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : voteRepo.countVotesByRoom(roomId)) {
            counts.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        Set<UUID> myVoted = viewerUserId != null
            ? new HashSet<>(voteRepo.myVotedQueueIds(roomId, viewerUserId))
            : Set.of();

        return queueRepo.findByRoomIdOrderByPosition(roomId).stream()
            .map(q -> {
                Map<String, Object> m = new HashMap<>();
                long votes = counts.getOrDefault(q.getId(), 0L);
                m.put("id", q.getId().toString());
                m.put("trackId", q.getTrackId().toString());
                m.put("position", q.getPosition());
                m.put("votes", votes);
                m.put("hasMyVote", myVoted.contains(q.getId()));
                trackRepo.findById(q.getTrackId()).ifPresent(t -> {
                    m.put("title", t.getTitle());
                    m.put("artist", t.getArtist());
                    m.put("durationMs", t.getDurationMs());
                    m.put("coverKey", t.getCoverKey());
                });
                return m;
            })
            // votes DESC, position ASC
            .sorted((a, b) -> {
                long va = (long) a.get("votes"), vb = (long) b.get("votes");
                if (va != vb) return Long.compare(vb, va);
                return Integer.compare((int) a.get("position"), (int) b.get("position"));
            })
            .toList();
    }

    /** Выбрать следующий элемент очереди — по тем же правилам что getQueueEnriched. */
    private Optional<RoomQueue> pickNextFromQueue(UUID roomId) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : voteRepo.countVotesByRoom(roomId)) {
            counts.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        return queueRepo.findByRoomIdOrderByPosition(roomId).stream()
            .max((a, b) -> {
                long va = counts.getOrDefault(a.getId(), 0L);
                long vb = counts.getOrDefault(b.getId(), 0L);
                if (va != vb) return Long.compare(va, vb);
                // более ранний position должен выиграть → у "older" position МЕНЬШЕ
                return Integer.compare(b.getPosition(), a.getPosition());
            });
    }

    /** Toggle голоса: вернёт true если голос добавлен, false если снят. */
    @Transactional
    public boolean toggleVote(UUID roomId, UUID queueId, UUID userId) {
        // Проверим что это item из нашей комнаты (защита от инжекта чужих queueId)
        var q = queueRepo.findById(queueId).orElseThrow(() -> new NoSuchElementException("Queue item not found"));
        if (!q.getRoomId().equals(roomId)) throw new NoSuchElementException("Queue item not in room");

        int deleted = voteRepo.deleteByQueueAndUser(queueId, userId);
        boolean added;
        if (deleted > 0) {
            added = false;
        } else {
            RoomQueueVote v = new RoomQueueVote();
            v.setQueueId(queueId);
            v.setUserId(userId);
            voteRepo.save(v);
            added = true;
        }
        // Сразу разошлём всем — фронт перезапросит очередь и пересортируется
        broadcast(roomId, Map.of("type", "QUEUE_UPDATE"));
        return added;
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

    /* ─── Co-host management ──────────────────────────────────────────────
     * Multiple users may share host privileges in a room. The room creator
     * (ListeningRoom.hostId) is the "primary host" and cannot be demoted; they
     * may promote any participant to HOST or revoke that role.
     */

    /** Список идентификаторов всех хостов комнаты: первичный + участники с role=HOST. */
    public List<UUID> getHostIds(UUID roomId) {
        ListeningRoom room = roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Room not found"));
        return getHostIds(room);
    }

    private List<UUID> getHostIds(ListeningRoom room) {
        UUID primary = room.getHostId();
        LinkedHashSet<UUID> ids = new LinkedHashSet<>();
        if (primary != null) ids.add(primary);
        for (RoomParticipant p : participantRepo.findByRoomIdAndRole(room.getId(), ParticipantRole.HOST)) {
            ids.add(p.getUserId());
        }
        return new ArrayList<>(ids);
    }

    public boolean isHost(UUID roomId, UUID userId) {
        ListeningRoom room = roomRepo.findById(roomId).orElse(null);
        if (room == null) return false;
        return isHost(roomId, userId, room);
    }

    private boolean isHost(UUID roomId, UUID userId, ListeningRoom room) {
        if (room.getHostId() != null && room.getHostId().equals(userId)) return true;
        return participantRepo.findByRoomIdAndRole(roomId, ParticipantRole.HOST).stream()
                .anyMatch(p -> p.getUserId().equals(userId));
    }

    /** Список всех участников комнаты с никами и ролями. */
    public List<Map<String, Object>> getParticipantsEnriched(UUID roomId) {
        ListeningRoom room = roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Room not found"));
        UUID primary = room.getHostId();
        return participantRepo.findByRoomId(roomId).stream()
                .map(p -> {
                    Map<String, Object> m = new HashMap<>();
                    m.put("userId", p.getUserId().toString());
                    boolean isPrimary = p.getUserId().equals(primary);
                    boolean isHost = isPrimary || p.getRole() == ParticipantRole.HOST;
                    m.put("role", isHost ? "HOST" : "LISTENER");
                    m.put("primary", isPrimary);
                    userRepo.findById(p.getUserId()).ifPresent(u -> m.put("username", u.getUsername()));
                    return m;
                })
                .sorted((a, b) -> Boolean.compare((boolean) b.get("primary"), (boolean) a.get("primary")))
                .toList();
    }

    /** Promote a participant to HOST. Only the primary host may call. */
    @Transactional
    public void addCoHost(UUID roomId, UUID targetUserId, UUID requesterId) {
        ListeningRoom room = roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Room not found"));
        if (!requesterId.equals(room.getHostId())) throw new RuntimeException("Only primary host");
        if (targetUserId.equals(room.getHostId())) return; // already primary
        RoomParticipant p = participantRepo.findById(new RoomParticipantId(roomId, targetUserId))
                .orElseThrow(() -> new RuntimeException("Target not in room"));
        if (p.getRole() == ParticipantRole.HOST) return;
        p.setRole(ParticipantRole.HOST);
        participantRepo.save(p);
        pushHostsUpdate(room);
    }

    /** Revoke HOST role from a participant. The primary host cannot be demoted. */
    @Transactional
    public void removeCoHost(UUID roomId, UUID targetUserId, UUID requesterId) {
        ListeningRoom room = roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Room not found"));
        if (!requesterId.equals(room.getHostId())) throw new RuntimeException("Only primary host");
        if (targetUserId.equals(room.getHostId())) throw new RuntimeException("Primary host cannot be demoted");
        RoomParticipant p = participantRepo.findById(new RoomParticipantId(roomId, targetUserId))
                .orElseThrow(() -> new RuntimeException("Target not in room"));
        if (p.getRole() != ParticipantRole.HOST) return;
        p.setRole(ParticipantRole.LISTENER);
        participantRepo.save(p);
        pushHostsUpdate(room);
    }

    /**
     * Kick a participant out of the room. The primary host can kick anyone
     * (including co-hosts); a co-host can kick non-hosts. The primary host
     * cannot be kicked at all (would orphan the room).
     */
    @Transactional
    public void kickParticipant(UUID roomId, UUID targetUserId, UUID requesterId) {
        ListeningRoom room = roomRepo.findById(roomId).orElseThrow(() -> new RuntimeException("Room not found"));
        if (targetUserId.equals(room.getHostId()))
            throw new RuntimeException("Cannot kick the primary host");
        if (targetUserId.equals(requesterId))
            throw new RuntimeException("Cannot kick yourself — use /leave");
        // Authorization: requester must be a host (primary OR co-host).
        boolean isPrimary = requesterId.equals(room.getHostId());
        boolean isCoHost = participantRepo.findById(new RoomParticipantId(roomId, requesterId))
                .map(p -> p.getRole() == ParticipantRole.HOST).orElse(false);
        if (!isPrimary && !isCoHost) throw new RuntimeException("Only a host can kick");
        // A co-host cannot kick another co-host — only the primary host has that power.
        RoomParticipant target = participantRepo.findById(new RoomParticipantId(roomId, targetUserId))
                .orElseThrow(() -> new RuntimeException("Target not in room"));
        if (!isPrimary && target.getRole() == ParticipantRole.HOST)
            throw new RuntimeException("Only the primary host can kick a co-host");

        try { friendService.clearNowPlaying(targetUserId); } catch (Exception ignore) {}
        participantRepo.deleteByRoomIdAndUserId(roomId, targetUserId);
        // Force-close target's WS connections so the in-memory client map and
        // skip-vote/reaction state get cleaned up on the sync side.
        try { syncPush.pushKick(roomId, targetUserId); } catch (Exception ignore) {}
        broadcast(roomId, Map.of("type", "PARTICIPANT_UPDATE", "action", "KICKED",
                "userId", targetUserId.toString(),
                "count", participantRepo.countByRoomId(roomId)));
    }

    private void pushHostsUpdate(ListeningRoom room) {
        List<UUID> ids = getHostIds(room);
        try { syncPush.pushHosts(room.getId(), room.getHostId(), ids); } catch (Exception ignore) {}
        Map<String, Object> msg = new HashMap<>();
        msg.put("type", "HOSTS_UPDATE");
        msg.put("primaryHostId", room.getHostId().toString());
        msg.put("hostIds", ids.stream().map(UUID::toString).toList());
        sessions.broadcastToRoom(room.getId(), msg);
    }

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
