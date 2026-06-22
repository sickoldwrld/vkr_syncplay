package com.syncplay.service;

import com.syncplay.model.ListenHistory;
import com.syncplay.model.Track;
import com.syncplay.repo.ListenHistoryRepo;
import com.syncplay.repo.TrackRepo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class HistoryServiceTest {

    @Mock ListenHistoryRepo historyRepo;
    @Mock TrackRepo trackRepo;

    @InjectMocks HistoryService service;

    @Test
    void record_ignores_listens_below_5_seconds() {
        service.record(UUID.randomUUID(), UUID.randomUUID(), null, 4_000);
        verify(historyRepo, never()).save(any());
    }

    @Test
    void record_persists_listen_at_or_above_threshold() {
        service.record(UUID.randomUUID(), UUID.randomUUID(), null, 5_000);
        verify(historyRepo).save(any(ListenHistory.class));
    }

    @Test
    void getRecentHistory_deduplicates_by_trackId_keeping_most_recent() {
        UUID uid = UUID.randomUUID();
        UUID t1 = UUID.randomUUID();
        UUID t2 = UUID.randomUUID();

        ListenHistory h1 = h(uid, t1);
        ListenHistory h2 = h(uid, t2);
        ListenHistory h3 = h(uid, t1); // duplicate — older
        when(historyRepo.findByUserIdOrderByPlayedAtDesc(eq(uid), any(Pageable.class)))
            .thenReturn(List.of(h1, h2, h3));

        when(trackRepo.findById(t1)).thenReturn(Optional.of(track(t1, "Song A")));
        when(trackRepo.findById(t2)).thenReturn(Optional.of(track(t2, "Song B")));

        var result = service.getRecentHistory(uid, 10);
        assertThat(result).hasSize(2);
        assertThat(result.get(0).get("trackId")).isEqualTo(t1.toString());
        assertThat(result.get(1).get("trackId")).isEqualTo(t2.toString());
    }

    private static ListenHistory h(UUID userId, UUID trackId) {
        ListenHistory lh = new ListenHistory();
        lh.setUserId(userId); lh.setTrackId(trackId); lh.setDurationMs(10_000);
        return lh;
    }

    private static Track track(UUID id, String title) {
        Track t = new Track();
        t.setId(id); t.setTitle(title); t.setArtist("X"); t.setDurationMs(200_000);
        return t;
    }
}
