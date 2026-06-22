package com.syncplay.service;

import com.syncplay.model.Track;
import com.syncplay.repo.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RecommendationServiceTest {

    @Mock ListenHistoryRepo historyRepo;
    @Mock TrackLikeRepo likeRepo;
    @Mock TrackRepo trackRepo;
    @Mock FriendshipRepo friendshipRepo;
    @Mock EntityManager em;
    @Mock Query nativeQuery;

    RecommendationService service;

    @BeforeEach
    void setUp() {
        service = new RecommendationService(historyRepo, likeRepo, trackRepo, friendshipRepo);
        ReflectionTestUtils.setField(service, "em", em);
    }

    @Test
    void cold_start_when_no_history_and_no_likes_returns_global_top() {
        UUID uid = UUID.randomUUID();
        when(historyRepo.topGenres(uid, 5)).thenReturn(List.of());
        when(historyRepo.topArtists(uid, 5)).thenReturn(List.of());
        when(likeRepo.findLikedTrackIds(uid)).thenReturn(Set.of());
        when(historyRepo.recentTrackIds(uid)).thenReturn(List.of());

        List<Track> coldResult = List.of(track("A"), track("B"));
        when(em.createNativeQuery(any(String.class), eq(Track.class))).thenReturn(nativeQuery);
        when(nativeQuery.setParameter(any(String.class), any())).thenReturn(nativeQuery);
        when(nativeQuery.getResultList()).thenReturn(new ArrayList<>(coldResult));

        var res = service.recommend(uid, 10);
        assertThat(res).hasSize(2);
    }

    @Test
    void scoring_with_genre_and_artist_signals_orders_by_score() {
        UUID uid = UUID.randomUUID();
        List<Object[]> genres = new ArrayList<>();
        genres.add(new Object[]{"rock", 20L});
        List<Object[]> artists = new ArrayList<>();
        artists.add(new Object[]{"Pixies", 5L});
        when(historyRepo.topGenres(uid, 5)).thenReturn(genres);
        when(historyRepo.topArtists(uid, 5)).thenReturn(artists);
        when(likeRepo.findLikedTrackIds(uid)).thenReturn(Set.of());
        when(historyRepo.recentTrackIds(uid)).thenReturn(List.of());

        Track strong = track("Hey", "Pixies", "rock");
        Track medium = track("Other", "Unknown", "rock");
        Track unrelated = track("Z", "Z", "jazz");
        when(trackRepo.findAll()).thenReturn(List.of(strong, medium, unrelated));

        // limit=2 keeps us inside the content-scored branch; if we asked for more, fromFriends/randomFill
        // would fire and need the EntityManager mocked. We only care about ranking here.
        var res = service.recommend(uid, 2);
        assertThat(res).isNotEmpty();
        assertThat(res.get(0).getTitle()).isEqualTo("Hey");
    }

    // Mockito eq() helper for Track.class typed arg
    private static <T> Class<T> eq(Class<T> c) { return org.mockito.ArgumentMatchers.eq(c); }

    private static Track track(String title) { return track(title, "Artist", "Genre"); }

    private static Track track(String title, String artist, String genre) {
        Track t = new Track();
        t.setId(UUID.randomUUID());
        t.setTitle(title); t.setArtist(artist); t.setGenre(genre);
        t.setDurationMs(180_000);
        return t;
    }
}
