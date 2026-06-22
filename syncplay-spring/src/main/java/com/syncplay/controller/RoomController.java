package com.syncplay.controller;

import com.syncplay.repo.PlaylistTrackRepo;
import com.syncplay.security.AuthHelper;
import com.syncplay.service.RoomService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomService service;
    private final PlaylistTrackRepo ptRepo;

    public RoomController(RoomService s, PlaylistTrackRepo p) {
        this.service = s; this.ptRepo = p;
    }

    @GetMapping
    public List<Map<String, Object>> list() { return service.getActiveRooms(); }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        UUID uid = AuthHelper.currentUserId();
        var r = service.createRoom(uid, (String) body.get("name"));
        // Если указан плейлист — preload первых 6 треков
        Object pl = body.get("playlistId");
        if (pl instanceof String pls && !pls.isBlank()) {
            try { service.preloadFromPlaylist(r.getId(), UUID.fromString(pls), uid, 6, ptRepo); }
            catch (Exception ignore) {}
        }
        return Map.of("id", r.getId().toString(), "name", r.getName());
    }

    @PostMapping("/{id}/join")
    public ResponseEntity<Void> join(@PathVariable UUID id) {
        service.joinRoom(id, AuthHelper.currentUserId());
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{id}/leave")
    public ResponseEntity<Void> leave(@PathVariable UUID id) {
        service.leaveRoom(id, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/queue")
    public List<Map<String, Object>> queue(@PathVariable UUID id) {
        return service.getQueueEnriched(id, AuthHelper.currentUserId());
    }

    @PostMapping("/{id}/queue/{trackId}")
    public ResponseEntity<Void> addToQueue(@PathVariable UUID id, @PathVariable UUID trackId) {
        service.addToQueue(id, trackId, AuthHelper.currentUserId());
        return ResponseEntity.status(201).build();
    }

    /** Toggle голос за элемент очереди. {voted: true} = добавлен, {voted: false} = снят. */
    @PostMapping("/{id}/queue/{queueId}/vote")
    public Map<String, Object> voteQueueItem(@PathVariable UUID id, @PathVariable UUID queueId) {
        boolean added = service.toggleVote(id, queueId, AuthHelper.currentUserId());
        return Map.of("voted", added);
    }

    /** Все участники комнаты с никами и текущей ролью (HOST/LISTENER). */
    @GetMapping("/{id}/participants")
    public List<Map<String, Object>> participants(@PathVariable UUID id) {
        return service.getParticipantsEnriched(id);
    }

    /** Список идентификаторов хостов (первичный + co-host). */
    @GetMapping("/{id}/hosts")
    public Map<String, Object> hosts(@PathVariable UUID id) {
        var ids = service.getHostIds(id);
        return Map.of("hostIds", ids.stream().map(UUID::toString).toList());
    }

    /** Назначить co-host. Доступно только первичному хосту. */
    @PostMapping("/{id}/cohosts/{userId}")
    public ResponseEntity<Void> addCoHost(@PathVariable UUID id, @PathVariable UUID userId) {
        service.addCoHost(id, userId, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    /** Снять co-host. Первичного хоста демонтировать нельзя. */
    @DeleteMapping("/{id}/cohosts/{userId}")
    public ResponseEntity<Void> removeCoHost(@PathVariable UUID id, @PathVariable UUID userId) {
        service.removeCoHost(id, userId, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    /** Выкинуть участника из комнаты. Только host может. Primary host неуязвим. */
    @DeleteMapping("/{id}/participants/{userId}")
    public ResponseEntity<Void> kick(@PathVariable UUID id, @PathVariable UUID userId) {
        service.kickParticipant(id, userId, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }
}
