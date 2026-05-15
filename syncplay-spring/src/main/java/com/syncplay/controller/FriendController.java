package com.syncplay.controller;

import com.syncplay.repo.UserNowPlayingRepo;
import com.syncplay.security.AuthHelper;
import com.syncplay.service.FriendService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/friends")
public class FriendController {
    private final FriendService service;
    private final UserNowPlayingRepo nowPlayingRepo;

    public FriendController(FriendService s, UserNowPlayingRepo np) {
        this.service = s; this.nowPlayingRepo = np;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return service.getFriends(AuthHelper.currentUserId());
    }

    @GetMapping("/requests")
    public List<Map<String, Object>> pending() {
        return service.getPendingRequests(AuthHelper.currentUserId());
    }

    @PostMapping("/requests")
    public Map<String, Object> sendRequest(@RequestBody Map<String, String> body) {
        var fr = service.sendRequest(AuthHelper.currentUserId(), body.get("username"));
        return Map.of("id", fr.getId().toString());
    }

    @PostMapping("/requests/{id}/accept")
    public ResponseEntity<Void> accept(@PathVariable UUID id) {
        service.acceptRequest(id, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/requests/{id}/reject")
    public ResponseEntity<Void> reject(@PathVariable UUID id) {
        service.rejectRequest(id, AuthHelper.currentUserId());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{friendId}")
    public ResponseEntity<Void> remove(@PathVariable UUID friendId) {
        service.removeFriend(AuthHelper.currentUserId(), friendId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/search")
    public List<Map<String, Object>> search(@RequestParam String q) {
        return service.searchUsers(q, AuthHelper.currentUserId());
    }

    /** Получить ID комнаты в которой сейчас слушает друг — для Join session. */
    @GetMapping("/{friendId}/session")
    public Map<String, Object> getSession(@PathVariable UUID friendId) {
        return nowPlayingRepo.findById(friendId)
            .filter(np -> np.getRoomId() != null)
            .map(np -> Map.<String, Object>of("roomId", np.getRoomId().toString()))
            .orElse(Map.of());
    }
}
