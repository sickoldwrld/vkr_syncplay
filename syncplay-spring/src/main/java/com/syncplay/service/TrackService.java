package com.syncplay.service;

import com.syncplay.model.Track;
import com.syncplay.repo.TrackLikeRepo;
import com.syncplay.repo.TrackRepo;
import com.syncplay.storage.MinioStorage;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.metadata.TikaCoreProperties;
import org.apache.tika.parser.AutoDetectParser;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.sax.BodyContentHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.Artwork;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class TrackService {
    private final TrackRepo trackRepo;
    private final TrackLikeRepo likeRepo;
    private final MinioStorage minio;

    public TrackService(TrackRepo trackRepo, TrackLikeRepo likeRepo, MinioStorage minio) {
        this.trackRepo = trackRepo;
        this.likeRepo = likeRepo;
        this.minio = minio;
    }

    public List<Track> findAll() { return trackRepo.findAllByOrderByCreatedAtDesc(); }
    public List<Track> search(String q) {
        return q == null || q.isBlank() ? findAll() : trackRepo.search(q);
    }
    public Track findById(UUID id) {
        return trackRepo.findById(id).orElseThrow(() -> new RuntimeException("Track not found"));
    }

    @Transactional
    public Track upload(MultipartFile file, UUID userId) {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("File required");
        String ct = file.getContentType();
        if (ct == null || !ct.startsWith("audio/")) throw new IllegalArgumentException("Not audio");

        String orig = file.getOriginalFilename() != null ? file.getOriginalFilename() : "track";
        String ext = "";
        int dot = orig.lastIndexOf('.');
        if (dot >= 0) ext = orig.substring(dot + 1).toLowerCase();

        // Сохраняем во временный файл — нужен и для jaudiotagger (читает File),
        // и для повторного открытия потоков без двойного буферирования multipart.
        Path tmp;
        try {
            tmp = Files.createTempFile("upload-", ext.isEmpty() ? ".bin" : "." + ext);
            file.transferTo(tmp.toFile());
        } catch (Exception e) {
            throw new RuntimeException("Failed to buffer upload", e);
        }

        try {
            // --- 1. jaudiotagger: метаданные + обложка (надёжно для ID3v2 APIC, FLAC, MP4, OGG) ---
            String jTitle = null, jArtist = null, jAlbum = null, jGenre = null;
            long jDurMs = 0;
            byte[] coverBytes = null;
            String coverMime = null;

            try {
                AudioFile af = AudioFileIO.read(tmp.toFile());
                if (af.getAudioHeader() != null) {
                    jDurMs = af.getAudioHeader().getTrackLength() * 1000L;
                }
                Tag tag = af.getTag();
                if (tag != null) {
                    jTitle = safe(tag, FieldKey.TITLE);
                    jArtist = safe(tag, FieldKey.ARTIST);
                    jAlbum = safe(tag, FieldKey.ALBUM);
                    jGenre = safe(tag, FieldKey.GENRE);
                    Artwork art = tag.getFirstArtwork();
                    if (art != null) {
                        coverBytes = art.getBinaryData();
                        coverMime = art.getMimeType();
                    }
                }
            } catch (Exception ignore) { /* jaudiotagger может не поддерживать формат — упадём на Tika */ }

            // --- 2. Tika как safety-net (особенно для длительности и редких контейнеров) ---
            Metadata md = new Metadata();
            ByteArrayOutputStream tikaCover = new ByteArrayOutputStream();
            String[] tikaCoverCT = { null };

            try (InputStream in = Files.newInputStream(tmp)) {
                ParseContext context = new ParseContext();
                context.set(org.apache.tika.extractor.EmbeddedDocumentExtractor.class,
                    new org.apache.tika.extractor.EmbeddedDocumentExtractor() {
                        @Override
                        public boolean shouldParseEmbedded(Metadata m) { return true; }
                        @Override
                        public void parseEmbedded(InputStream stream, org.xml.sax.ContentHandler handler,
                                                  Metadata m, boolean outputHtml) throws java.io.IOException {
                            String embCT = m.get(Metadata.CONTENT_TYPE);
                            if (embCT != null && embCT.startsWith("image/") && tikaCover.size() == 0) {
                                tikaCoverCT[0] = embCT;
                                stream.transferTo(tikaCover);
                            }
                        }
                    });
                new AutoDetectParser().parse(in, new BodyContentHandler(-1), md, context);
            } catch (Exception ignore) {}

            String tTitle = md.get(TikaCoreProperties.TITLE);
            String tArtist = md.get("xmpDM:artist");
            String tAlbum = md.get("xmpDM:album");
            String tGenre = md.get("xmpDM:genre");
            String tDur = md.get("xmpDM:duration");

            // --- 3. Свод метаданных: jaudiotagger > Tika > имя файла ---
            String title = firstNonBlank(jTitle, tTitle);
            if (title == null || title.isBlank()) {
                title = dot >= 0 ? orig.substring(0, dot) : orig;
            }
            String artist = firstNonBlank(jArtist, tArtist);
            String album = firstNonBlank(jAlbum, tAlbum);
            String genre = firstNonBlank(jGenre, tGenre);

            long durMs = jDurMs;
            if (durMs <= 0 && tDur != null) {
                try { durMs = Math.round(Double.parseDouble(tDur)); } catch (Exception ignore) {}
            }

            // --- 4. Cover: предпочитаем jaudiotagger, иначе Tika ---
            byte[] finalCover = coverBytes;
            String finalCoverMime = coverMime;
            if ((finalCover == null || finalCover.length == 0) && tikaCover.size() > 0) {
                finalCover = tikaCover.toByteArray();
                finalCoverMime = tikaCoverCT[0];
            }

            // --- 5. Загрузка трека в MinIO ---
            String key;
            try (InputStream in = Files.newInputStream(tmp)) {
                key = minio.upload(in, file.getSize(), ct, "tracks", ext);
            } catch (Exception e) {
                throw new RuntimeException("Upload failed", e);
            }

            // --- 6. Загрузка обложки в MinIO ---
            String coverKey = null;
            if (finalCover != null && finalCover.length > 0 && finalCoverMime != null) {
                String coverExt = finalCoverMime.toLowerCase().contains("png") ? "png" : "jpg";
                try (InputStream in = new ByteArrayInputStream(finalCover)) {
                    coverKey = minio.upload(in, finalCover.length, finalCoverMime, "covers", coverExt);
                } catch (Exception ignore) {}
            }

            Track t = new Track();
            t.setTitle(title);
            t.setArtist(artist);
            t.setAlbum(album);
            t.setGenre(genre);
            t.setDurationMs(durMs);
            t.setMinioKey(key);
            t.setCoverKey(coverKey);
            t.setFileSize(file.getSize());
            t.setContentType(ct);
            t.setUploadedBy(userId);

            return trackRepo.save(t);
        } finally {
            try { Files.deleteIfExists(tmp); } catch (Exception ignore) {}
        }
    }

    private static String safe(Tag tag, FieldKey key) {
        try {
            String v = tag.getFirst(key);
            return (v == null || v.isBlank()) ? null : v;
        } catch (Exception e) { return null; }
    }

    private static String firstNonBlank(String... vals) {
        for (String v : vals) if (v != null && !v.isBlank()) return v;
        return null;
    }

    @Transactional
    public void delete(UUID id, UUID userId) {
        Track t = findById(id);
        if (!t.getUploadedBy().equals(userId)) throw new RuntimeException("Not owner");
        if (t.getMinioKey() != null) minio.delete(t.getMinioKey());
        if (t.getCoverKey() != null) minio.delete(t.getCoverKey());
        trackRepo.deleteById(id);
    }

    public Set<UUID> likedTrackIds(UUID userId) { return likeRepo.findLikedTrackIds(userId); }

    @Transactional
    public void like(UUID userId, UUID trackId) {
        if (likeRepo.existsByUserIdAndTrackId(userId, trackId)) return;
        var like = new com.syncplay.model.TrackLike();
        like.setUserId(userId);
        like.setTrackId(trackId);
        likeRepo.save(like);
    }

    @Transactional
    public void unlike(UUID userId, UUID trackId) {
        likeRepo.deleteByUserIdAndTrackId(userId, trackId);
    }

    public List<Track> liked(UUID userId) {
        return likeRepo.findLikedTrackIdsOrdered(userId).stream()
            .map(trackRepo::findById)
            .filter(java.util.Optional::isPresent)
            .map(java.util.Optional::get)
            .toList();
    }
}
