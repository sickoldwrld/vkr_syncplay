package com.syncplay.service;

import com.syncplay.model.*;
import com.syncplay.repo.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class FriendService {
    private final FriendshipRepo friendshipRepo;
    private final FriendRequestRepo requestRepo;
    private final UserRepo userRepo;
    private final UserNowPlayingRepo nowPlayingRepo;
    private final TrackRepo trackRepo;

    public FriendService(FriendshipRepo f, FriendRequestRepo r, UserRepo u,
                         UserNowPlayingRepo np, TrackRepo t) {
        this.friendshipRepo = f; this.requestRepo = r; this.userRepo = u;
        this.nowPlayingRepo = np; this.trackRepo = t;
    }

    @Transactional
    public FriendRequest sendRequest(UUID fromUserId, String toUsername) {
        User to = userRepo.findByUsername(toUsername)
            .orElseThrow(() -> new RuntimeException("User not found"));
        if (to.getId().equals(fromUserId)) throw new RuntimeException("Cannot add yourself");
        if (friendshipRepo.existsByUserIdAndFriendId(fromUserId, to.getId()))
            throw new RuntimeException("Already friends");

        var existing = requestRepo.findByFromUserIdAndToUserId(fromUserId, to.getId());
        if (existing.isPresent() && existing.get().getStatus() == FriendRequestStatus.PENDING)
            throw new RuntimeException("Request already pending");

        var fr = new FriendRequest();
        fr.setFromUserId(fromUserId); fr.setToUserId(to.getId());
        return requestRepo.save(fr);
    }

    @Transactional
    public void acceptRequest(UUID requestId, UUID userId) {
        FriendRequest fr = requestRepo.findById(requestId).orElseThrow(() -> new RuntimeException("Not found"));
        if (!fr.getToUserId().equals(userId)) throw new RuntimeException("Not your request");
        if (fr.getStatus() != FriendRequestStatus.PENDING) throw new RuntimeException("Already handled");

        fr.setStatus(FriendRequestStatus.ACCEPTED);
        // Симметричная связь — два направления
        var f1 = new Friendship(); f1.setUserId(fr.getFromUserId()); f1.setFriendId(fr.getToUserId());
        var f2 = new Friendship(); f2.setUserId(fr.getToUserId()); f2.setFriendId(fr.getFromUserId());
        friendshipRepo.save(f1); friendshipRepo.save(f2);
    }

    @Transactional
    public void rejectRequest(UUID requestId, UUID userId) {
        FriendRequest fr = requestRepo.findById(requestId).orElseThrow(() -> new RuntimeException("Not found"));
        if (!fr.getToUserId().equals(userId)) throw new RuntimeException("Not your request");
        fr.setStatus(FriendRequestStatus.REJECTED);
    }

    @Transactional
    public void removeFriend(UUID userId, UUID friendId) {
        friendshipRepo.deleteByUserIdAndFriendId(userId, friendId);
        friendshipRepo.deleteByUserIdAndFriendId(friendId, userId);
    }

    /** Окно heartbeat: запись в UserNowPlaying считается «свежей» если updatedAt
     *  не старше этого порога. Клиент пингует раз в 20с, поэтому 60с даёт запас. */
    private static final long ONLINE_TTL_SECONDS = 60;

    /** Возвращает список друзей с их текущим статусом прослушивания и онлайн-статусом. */
    public List<Map<String, Object>> getFriends(UUID userId) {
        List<UUID> friendIds = friendshipRepo.findFriendIds(userId);
        if (friendIds.isEmpty()) return List.of();

        Map<UUID, UserNowPlaying> npMap = new HashMap<>();
        nowPlayingRepo.findByUserIdIn(friendIds).forEach(np -> npMap.put(np.getUserId(), np));

        java.time.LocalDateTime onlineThreshold =
            java.time.LocalDateTime.now().minusSeconds(ONLINE_TTL_SECONDS);

        return friendIds.stream().map(fid -> {
            Map<String, Object> m = new HashMap<>();
            User u = userRepo.findById(fid).orElse(null);
            if (u == null) return null;
            m.put("id", u.getId().toString());
            m.put("username", u.getUsername());
            m.put("avatarUrl", u.getAvatarUrl());

            UserNowPlaying np = npMap.get(fid);
            boolean fresh = np != null && np.getUpdatedAt() != null
                && np.getUpdatedAt().isAfter(onlineThreshold);

            // Online — есть свежий heartbeat, независимо от наличия trackId
            m.put("online", fresh);
            // Live (слушает прямо сейчас) — есть и свежий heartbeat и активный трек
            boolean live = fresh && np.getTrackId() != null;
            m.put("isLive", live);

            if (live) {
                trackRepo.findById(np.getTrackId()).ifPresent(t -> {
                    Map<String, Object> tm = new HashMap<>();
                    tm.put("title", t.getTitle()); tm.put("artist", t.getArtist());
                    m.put("nowPlaying", tm);
                });
                if (np.getRoomId() != null) m.put("roomId", np.getRoomId().toString());
            }
            if (np != null && np.getUpdatedAt() != null) {
                m.put("lastSeenAt", np.getUpdatedAt()
                    .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli());
            }
            return m;
        }).filter(Objects::nonNull).toList();
    }

    /** Heartbeat: обновить updatedAt без изменения trackId/roomId.
     *  Используется и WS-PING'ом из комнаты, и периодическим ping'ом из главного UI. */
    @Transactional
    public void touchPresence(UUID userId) {
        var np = nowPlayingRepo.findById(userId).orElseGet(() -> {
            var n = new UserNowPlaying(); n.setUserId(userId); return n;
        });
        np.setUpdatedAt(java.time.LocalDateTime.now());
        nowPlayingRepo.save(np);
    }

    /** Очистить трек/комнату (юзер вышел из комнаты) — сохраняем online через updatedAt. */
    @Transactional
    public void clearNowPlaying(UUID userId) {
        nowPlayingRepo.findById(userId).ifPresent(np -> {
            np.setTrackId(null); np.setRoomId(null);
            np.setUpdatedAt(java.time.LocalDateTime.now());
            nowPlayingRepo.save(np);
        });
    }

    public List<Map<String, Object>> getPendingRequests(UUID userId) {
        return requestRepo.findByToUserIdAndStatus(userId, FriendRequestStatus.PENDING).stream().map(fr -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", fr.getId().toString());
            userRepo.findById(fr.getFromUserId()).ifPresent(u -> {
                m.put("fromUserId", u.getId().toString());
                m.put("fromUsername", u.getUsername());
            });
            m.put("createdAt", fr.getCreatedAt());
            return m;
        }).toList();
    }

    /** Поиск пользователей по имени для добавления в друзья. */
    public List<Map<String, Object>> searchUsers(String query, UUID excludeUserId) {
        if (query == null || query.length() < 2) return List.of();
        return userRepo.findByUsernameContainingIgnoreCase(query).stream()
            .filter(u -> !u.getId().equals(excludeUserId))
            .limit(10)
            .map(u -> {
                Map<String, Object> m = new HashMap<>();
                m.put("id", u.getId().toString()); m.put("username", u.getUsername());
                m.put("isFriend", friendshipRepo.existsByUserIdAndFriendId(excludeUserId, u.getId()));
                return m;
            }).toList();
    }

    @Transactional
    public void updateNowPlaying(UUID userId, UUID trackId, UUID roomId) {
        var np = nowPlayingRepo.findById(userId).orElseGet(() -> {
            var n = new UserNowPlaying(); n.setUserId(userId); return n;
        });
        np.setTrackId(trackId); np.setRoomId(roomId);
        np.setUpdatedAt(java.time.LocalDateTime.now());
        nowPlayingRepo.save(np);
    }
}
