package com.syncplay.service;

import com.syncplay.model.*;
import com.syncplay.repo.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class PlaylistService {
    private final PlaylistRepo playlistRepo;
    private final PlaylistTrackRepo ptRepo;
    private final TrackRepo trackRepo;
    private final UserRepo userRepo;
    private final PlaylistLikeRepo likeRepo;

    public PlaylistService(PlaylistRepo p, PlaylistTrackRepo pt, TrackRepo t, UserRepo u, PlaylistLikeRepo l) {
        this.playlistRepo = p; this.ptRepo = pt; this.trackRepo = t; this.userRepo = u; this.likeRepo = l;
    }

    @Transactional
    public Playlist create(UUID ownerId, String name, boolean isPublic) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("Name required");
        Playlist p = new Playlist();
        p.setName(name.trim()); p.setOwnerId(ownerId); p.setPublic(isPublic);
        return playlistRepo.save(p);
    }

    @Transactional
    public Playlist update(UUID playlistId, UUID userId, String newName, Boolean isPublic) {
        Playlist p = playlistRepo.findById(playlistId)
            .orElseThrow(() -> new RuntimeException("Playlist not found"));
        if (!p.getOwnerId().equals(userId)) throw new RuntimeException("Not owner");
        if (newName != null && !newName.isBlank()) p.setName(newName.trim());
        if (isPublic != null) p.setPublic(isPublic);
        return playlistRepo.save(p);
    }

    public List<Playlist> getByOwner(UUID ownerId) {
        return playlistRepo.findByOwnerIdOrderByCreatedAtDesc(ownerId);
    }

    public List<Map<String, Object>> getPublicEnriched() {
        return playlistRepo.findByIsPublicTrueOrderByCreatedAtDesc().stream().map(p -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", p.getId().toString()); m.put("name", p.getName()); m.put("isPublic", p.isPublic());
            userRepo.findById(p.getOwnerId()).ifPresent(u -> m.put("ownerName", u.getUsername()));
            m.put("trackCount", ptRepo.countByPlaylistId(p.getId()));
            return m;
        }).toList();
    }

    public List<Map<String, Object>> getTracksEnriched(UUID playlistId) {
        playlistRepo.findById(playlistId).orElseThrow(() -> new RuntimeException("Playlist not found"));
        return ptRepo.findByPlaylistIdOrderByPosition(playlistId).stream().map(pt -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", pt.getTrackId().toString());
            m.put("position", pt.getPosition());
            trackRepo.findById(pt.getTrackId()).ifPresentOrElse(t -> {
                m.put("title", t.getTitle()); m.put("artist", t.getArtist());
                m.put("album", t.getAlbum()); m.put("durationMs", t.getDurationMs());
                m.put("coverKey", t.getCoverKey());
            }, () -> { m.put("title", "Удалён"); m.put("durationMs", 0); });
            return m;
        }).toList();
    }

    @Transactional
    public void reorderTracks(UUID playlistId, UUID userId, List<UUID> trackOrder) {
        Playlist p = playlistRepo.findById(playlistId).orElseThrow(() -> new RuntimeException("Not found"));
        if (!p.getOwnerId().equals(userId)) throw new RuntimeException("Not owner");
        Map<UUID, PlaylistTrack> ptMap = new HashMap<>();
        ptRepo.findByPlaylistIdOrderByPosition(playlistId).forEach(pt -> ptMap.put(pt.getTrackId(), pt));
        for (int i = 0; i < trackOrder.size(); i++) {
            PlaylistTrack pt = ptMap.get(trackOrder.get(i));
            if (pt != null) { pt.setPosition(i + 1); ptRepo.save(pt); }
        }
    }

    @Transactional
    public void addTrack(UUID playlistId, UUID trackId, UUID userId) {
        Playlist p = playlistRepo.findById(playlistId).orElseThrow(() -> new RuntimeException("Not found"));
        if (!p.getOwnerId().equals(userId)) throw new RuntimeException("Not owner");
        trackRepo.findById(trackId).orElseThrow(() -> new RuntimeException("Track not found"));
        if (ptRepo.existsByPlaylistIdAndTrackId(playlistId, trackId)) {
            throw new IllegalArgumentException("Трек уже в плейлисте");
        }
        int max = ptRepo.maxPosition(playlistId);
        var pt = new PlaylistTrack();
        pt.setPlaylistId(playlistId); pt.setTrackId(trackId); pt.setPosition(max + 1);
        ptRepo.save(pt);
    }

    @Transactional
    public void removeTrack(UUID playlistId, UUID trackId, UUID userId) {
        Playlist p = playlistRepo.findById(playlistId).orElseThrow(() -> new RuntimeException("Not found"));
        if (!p.getOwnerId().equals(userId)) throw new RuntimeException("Not owner");
        ptRepo.deleteByPlaylistIdAndTrackId(playlistId, trackId);
    }

    @Transactional
    public void delete(UUID playlistId, UUID userId) {
        Playlist p = playlistRepo.findById(playlistId).orElseThrow(() -> new RuntimeException("Not found"));
        if (!p.getOwnerId().equals(userId)) throw new RuntimeException("Not owner");
        ptRepo.deleteByPlaylistId(playlistId);
        playlistRepo.deleteById(playlistId);
    }

    @Transactional
    public void like(UUID userId, UUID playlistId) {
        if (likeRepo.existsByUserIdAndPlaylistId(userId, playlistId)) return;
        var pl = new PlaylistLike();
        pl.setUserId(userId); pl.setPlaylistId(playlistId);
        likeRepo.save(pl);
    }

    @Transactional
    public void unlike(UUID userId, UUID playlistId) {
        likeRepo.deleteByUserIdAndPlaylistId(userId, playlistId);
    }

    public Set<UUID> likedPlaylistIds(UUID userId) { return likeRepo.findLikedPlaylistIds(userId); }
}
