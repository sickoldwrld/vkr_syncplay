package com.syncplay.service;

import com.syncplay.model.ListenHistory;
import com.syncplay.model.Track;
import com.syncplay.repo.ListenHistoryRepo;
import com.syncplay.repo.TrackRepo;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class HistoryService {
    private final ListenHistoryRepo historyRepo;
    private final TrackRepo trackRepo;

    public HistoryService(ListenHistoryRepo h, TrackRepo t) {
        this.historyRepo = h; this.trackRepo = t;
    }

    @Transactional
    public void record(UUID userId, UUID trackId, UUID roomId, long durationMs) {
        if (durationMs < 5000) return; // не считаем если послушал меньше 5 секунд
        ListenHistory lh = new ListenHistory();
        lh.setUserId(userId); lh.setTrackId(trackId); lh.setRoomId(roomId); lh.setDurationMs(durationMs);
        historyRepo.save(lh);
    }

    public List<Map<String, Object>> getRecentHistory(UUID userId, int limit) {
        var list = historyRepo.findByUserIdOrderByPlayedAtDesc(userId, PageRequest.of(0, limit));
        List<Map<String, Object>> result = new ArrayList<>();
        Set<UUID> seen = new LinkedHashSet<>();
        for (var h : list) {
            if (seen.contains(h.getTrackId())) continue;
            seen.add(h.getTrackId());
            Track t = trackRepo.findById(h.getTrackId()).orElse(null);
            if (t == null) continue;
            Map<String, Object> m = new HashMap<>();
            m.put("trackId", t.getId().toString());
            m.put("title", t.getTitle());
            m.put("artist", t.getArtist());
            m.put("durationMs", t.getDurationMs());
            m.put("playedAt", h.getPlayedAt());
            result.add(m);
        }
        return result;
    }
}
