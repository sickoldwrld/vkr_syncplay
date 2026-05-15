package com.syncplay.service;

import com.syncplay.model.Track;
import com.syncplay.repo.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Гибридный recommender:
 *   • content-based по жанру (с case-insensitive matching и весами по позиции в топе)
 *   • content-based по артисту (fallback когда жанра нет, или дополняет)
 *   • collaborative — что лайкают друзья
 *   • cold start — самые залайканные треки глобально
 *
 * Скоринг кандидата: weight(genre) * 2.0 + weight(artist) * 1.5 + popularity * 0.3
 * Diversity: не больше MAX_PER_ARTIST треков от одного исполнителя.
 */
@Service
public class RecommendationService {
    private static final Logger log = LoggerFactory.getLogger(RecommendationService.class);

    private static final int TOP_GENRES = 5;
    private static final int TOP_ARTISTS = 5;
    private static final int MAX_PER_ARTIST = 2;
    private static final double GENRE_WEIGHT = 2.0;
    private static final double ARTIST_WEIGHT = 1.5;
    private static final double LIKES_WEIGHT = 0.3;
    private static final double NOISE = 0.15;

    private final ListenHistoryRepo historyRepo;
    private final TrackLikeRepo likeRepo;
    private final TrackRepo trackRepo;
    private final FriendshipRepo friendshipRepo;

    @PersistenceContext
    private EntityManager em;

    public RecommendationService(ListenHistoryRepo h, TrackLikeRepo l, TrackRepo t, FriendshipRepo f) {
        this.historyRepo = h; this.likeRepo = l; this.trackRepo = t; this.friendshipRepo = f;
    }

    public List<Track> recommend(UUID userId, int limit) {
        // --- 1. Собираем сигналы из истории + лайков ---
        Map<String, Double> genreWeights = topItemsToWeights(historyRepo.topGenres(userId, TOP_GENRES));
        Map<String, Double> artistWeights = topItemsToWeights(historyRepo.topArtists(userId, TOP_ARTISTS));

        // Подмешиваем жанры/артистов из лайков (если есть)
        Set<UUID> likedIds = likeRepo.findLikedTrackIds(userId);
        if (!likedIds.isEmpty()) {
            List<Track> likedTracks = trackRepo.findAllById(likedIds);
            for (Track t : likedTracks) {
                if (t.getGenre() != null && !t.getGenre().isBlank()) {
                    genreWeights.merge(normalize(t.getGenre()), 1.0, Double::sum);
                }
                if (t.getArtist() != null && !t.getArtist().isBlank()) {
                    artistWeights.merge(normalize(t.getArtist()), 1.0, Double::sum);
                }
            }
            // Re-normalize после merge
            normalizeWeights(genreWeights);
            normalizeWeights(artistWeights);
        }

        // --- 2. Что исключить: лайкнутое + всё что когда-либо слушал ---
        Set<UUID> excludeIds = new HashSet<>(likedIds);
        excludeIds.addAll(historyRepo.recentTrackIds(userId));

        log.debug("recommend user={} genres={} artists={} excludeCount={}",
            userId, genreWeights.keySet(), artistWeights.keySet(), excludeIds.size());

        // --- 3. Cold start: нет ни истории, ни лайков ---
        if (genreWeights.isEmpty() && artistWeights.isEmpty()) {
            log.debug("recommend cold-start for user={}", userId);
            return coldStart(excludeIds, limit);
        }

        // --- 4. Скорим всех кандидатов (то что не в exclude) ---
        List<Track> all = trackRepo.findAll();
        List<ScoredTrack> scored = new ArrayList<>();
        Random rnd = new Random(userId.hashCode());

        for (Track t : all) {
            if (excludeIds.contains(t.getId())) continue;
            double s = scoreTrack(t, genreWeights, artistWeights, rnd);
            if (s > 0) scored.add(new ScoredTrack(t, s));
        }

        scored.sort((a, b) -> Double.compare(b.score, a.score));

        // --- 5. Diversity: не больше MAX_PER_ARTIST треков от одного исполнителя ---
        List<Track> result = new ArrayList<>();
        Map<String, Integer> perArtist = new HashMap<>();
        for (ScoredTrack st : scored) {
            if (result.size() >= limit) break;
            String key = normalize(st.track.getArtist());
            int count = perArtist.getOrDefault(key, 0);
            if (count >= MAX_PER_ARTIST) continue;
            result.add(st.track);
            perArtist.put(key, count + 1);
        }

        // --- 6. Если не добрали — collaborative от друзей ---
        if (result.size() < limit) {
            result.addAll(fromFriends(userId, excludeIds, dejaPicked(result), limit - result.size()));
        }

        // --- 7. Если всё ещё не добрали — случайные ---
        if (result.size() < limit) {
            result.addAll(randomFill(excludeIds, dejaPicked(result), limit - result.size()));
        }

        return result;
    }

    /** Map (genre|artist → count) с весами по позиции (rank 1 = вес 1.0, rank N = вес 1/N). */
    private Map<String, Double> topItemsToWeights(List<Object[]> rows) {
        Map<String, Double> weights = new HashMap<>();
        for (int i = 0; i < rows.size(); i++) {
            Object[] row = rows.get(i);
            if (row[0] == null) continue;
            String key = normalize((String) row[0]);
            if (key.isEmpty()) continue;
            // Linear decay: 1.0, 0.83, 0.71, 0.625, 0.55 для топ-5
            double rankWeight = 1.0 / (1.0 + i * 0.2);
            weights.merge(key, rankWeight, Double::sum);
        }
        normalizeWeights(weights);
        return weights;
    }

    private void normalizeWeights(Map<String, Double> m) {
        if (m.isEmpty()) return;
        double max = m.values().stream().max(Double::compare).orElse(1.0);
        if (max <= 0) return;
        m.replaceAll((k, v) -> v / max);
    }

    private double scoreTrack(Track t, Map<String, Double> genreWeights,
                              Map<String, Double> artistWeights, Random rnd) {
        double score = 0;
        if (t.getGenre() != null && !genreWeights.isEmpty()) {
            Double gw = genreWeights.get(normalize(t.getGenre()));
            if (gw != null) score += gw * GENRE_WEIGHT;
        }
        if (t.getArtist() != null && !artistWeights.isEmpty()) {
            Double aw = artistWeights.get(normalize(t.getArtist()));
            if (aw != null) score += aw * ARTIST_WEIGHT;
        }
        if (score > 0) {
            // Лёгкий шум — иначе для одинакового рейтинга получим тот же порядок каждый раз
            score += rnd.nextDouble() * NOISE;
        }
        return score;
    }

    private List<Track> fromFriends(UUID userId, Set<UUID> excludeIds, Set<UUID> alreadyPicked, int n) {
        List<UUID> friendIds = friendshipRepo.findFriendIds(userId);
        if (friendIds.isEmpty()) return List.of();
        String sql = "SELECT * FROM (" +
                     "  SELECT DISTINCT t.* FROM tracks t " +
                     "  JOIN track_likes tl ON tl.track_id = t.id " +
                     "  WHERE tl.user_id IN (:friends) " +
                     (excludeIds.isEmpty() ? "" : "  AND t.id NOT IN (:exclude) ") +
                     ") sub ORDER BY RANDOM() LIMIT :lim";
        var q = em.createNativeQuery(sql, Track.class);
        q.setParameter("friends", friendIds);
        q.setParameter("lim", n);
        if (!excludeIds.isEmpty()) q.setParameter("exclude", excludeIds);
        @SuppressWarnings("unchecked")
        List<Track> tracks = q.getResultList();
        return tracks.stream().filter(t -> !alreadyPicked.contains(t.getId())).toList();
    }

    private List<Track> randomFill(Set<UUID> excludeIds, Set<UUID> alreadyPicked, int n) {
        String sql = "SELECT t.* FROM tracks t " +
                     (excludeIds.isEmpty() ? "" : "WHERE t.id NOT IN (:exclude) ") +
                     "ORDER BY RANDOM() LIMIT :lim";
        var q = em.createNativeQuery(sql, Track.class);
        q.setParameter("lim", n + alreadyPicked.size());
        if (!excludeIds.isEmpty()) q.setParameter("exclude", excludeIds);
        @SuppressWarnings("unchecked")
        List<Track> tracks = q.getResultList();
        return tracks.stream().filter(t -> !alreadyPicked.contains(t.getId())).limit(n).toList();
    }

    /** Cold start: самые залайканные треки по всей платформе. */
    private List<Track> coldStart(Set<UUID> excludeIds, int limit) {
        String sql = "SELECT t.*, COUNT(tl.user_id) AS like_count " +
                     "FROM tracks t LEFT JOIN track_likes tl ON tl.track_id = t.id " +
                     (excludeIds.isEmpty() ? "" : "WHERE t.id NOT IN (:exclude) ") +
                     "GROUP BY t.id " +
                     "ORDER BY like_count DESC, RANDOM() LIMIT :lim";
        var q = em.createNativeQuery(sql, Track.class);
        q.setParameter("lim", limit);
        if (!excludeIds.isEmpty()) q.setParameter("exclude", excludeIds);
        @SuppressWarnings("unchecked")
        List<Track> tracks = q.getResultList();
        return tracks;
    }

    private Set<UUID> dejaPicked(List<Track> tracks) {
        return tracks.stream().map(Track::getId).collect(Collectors.toSet());
    }

    private String normalize(String s) {
        if (s == null) return "";
        return s.trim().toLowerCase(Locale.ROOT);
    }

    private record ScoredTrack(Track track, double score) {}

    public Map<String, Object> getStats(UUID userId) {
        Map<String, Object> m = new HashMap<>();
        m.put("topGenres", historyRepo.topGenres(userId, 5).stream()
            .map(row -> Map.of("genre", row[0], "count", row[1])).toList());
        m.put("topArtists", historyRepo.topArtists(userId, 5).stream()
            .map(row -> Map.of("artist", row[0], "count", row[1])).toList());
        return m;
    }
}
