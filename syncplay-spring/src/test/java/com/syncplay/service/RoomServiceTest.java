package com.syncplay.service;

import com.syncplay.model.*;
import com.syncplay.repo.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RoomServiceTest {

    @Mock RoomRepo roomRepo;
    @Mock RoomParticipantRepo participantRepo;
    @Mock RoomQueueRepo queueRepo;
    @Mock RoomQueueVoteRepo voteRepo;
    @Mock TrackRepo trackRepo;
    @Mock UserRepo userRepo;
    @Mock SessionManager sessions;
    @Mock PlaybackScheduler scheduler;
    @Mock FriendService friendService;

    @InjectMocks RoomService service;

    @Test
    void createRoom_requires_non_blank_name() {
        UUID uid = UUID.randomUUID();
        assertThatThrownBy(() -> service.createRoom(uid, "  "))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.createRoom(uid, null))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void createRoom_persists_room_and_host_participant() {
        UUID uid = UUID.randomUUID();
        when(roomRepo.save(any(ListeningRoom.class))).thenAnswer(inv -> {
            ListeningRoom r = inv.getArgument(0);
            r.setId(UUID.randomUUID());
            return r;
        });

        var room = service.createRoom(uid, "Chill ");
        assertThat(room.getName()).isEqualTo("Chill");
        assertThat(room.getHostId()).isEqualTo(uid);

        ArgumentCaptor<RoomParticipant> capt = ArgumentCaptor.forClass(RoomParticipant.class);
        verify(participantRepo).save(capt.capture());
        assertThat(capt.getValue().getRole()).isEqualTo(ParticipantRole.HOST);
        assertThat(capt.getValue().getUserId()).isEqualTo(uid);
    }

    @Test
    void joinRoom_rejects_when_full() {
        UUID roomId = UUID.randomUUID();
        UUID uid = UUID.randomUUID();
        ListeningRoom room = new ListeningRoom();
        room.setId(roomId); room.setMaxListeners(2);
        when(roomRepo.findById(roomId)).thenReturn(Optional.of(room));
        when(participantRepo.existsByRoomIdAndUserId(roomId, uid)).thenReturn(false);
        when(participantRepo.countByRoomId(roomId)).thenReturn(2L);

        assertThatThrownBy(() -> service.joinRoom(roomId, uid))
            .isInstanceOf(RuntimeException.class)
            .hasMessageContaining("full");
    }

    @Test
    void joinRoom_idempotent_for_existing_participant() {
        UUID roomId = UUID.randomUUID();
        UUID uid = UUID.randomUUID();
        ListeningRoom room = new ListeningRoom();
        room.setId(roomId);
        when(roomRepo.findById(roomId)).thenReturn(Optional.of(room));
        when(participantRepo.existsByRoomIdAndUserId(roomId, uid)).thenReturn(true);

        service.joinRoom(roomId, uid);

        verify(participantRepo, never()).save(any());
        // and no PARTICIPANT_UPDATE broadcast on no-op join
        verify(sessions, never()).broadcastToRoom(eq(roomId), any());
    }

    @Test
    void addToQueue_increments_position() {
        UUID roomId = UUID.randomUUID();
        UUID trackId = UUID.randomUUID();
        UUID uid = UUID.randomUUID();
        when(roomRepo.findById(roomId)).thenReturn(Optional.of(new ListeningRoom()));
        when(trackRepo.findById(trackId)).thenReturn(Optional.of(new Track()));
        when(queueRepo.maxPosition(roomId)).thenReturn(5);

        service.addToQueue(roomId, trackId, uid);

        ArgumentCaptor<RoomQueue> capt = ArgumentCaptor.forClass(RoomQueue.class);
        verify(queueRepo).save(capt.capture());
        assertThat(capt.getValue().getPosition()).isEqualTo(6);
        assertThat(capt.getValue().getAddedBy()).isEqualTo(uid);
    }

    @Test
    void toggleVote_adds_vote_when_absent() {
        UUID roomId = UUID.randomUUID();
        UUID queueId = UUID.randomUUID();
        UUID uid = UUID.randomUUID();

        RoomQueue q = new RoomQueue();
        q.setId(queueId); q.setRoomId(roomId);
        when(queueRepo.findById(queueId)).thenReturn(Optional.of(q));
        when(voteRepo.deleteByQueueAndUser(queueId, uid)).thenReturn(0);

        boolean added = service.toggleVote(roomId, queueId, uid);

        assertThat(added).isTrue();
        verify(voteRepo).save(any(RoomQueueVote.class));
        verify(sessions).broadcastToRoom(eq(roomId), any());
    }

    @Test
    void toggleVote_removes_vote_when_present() {
        UUID roomId = UUID.randomUUID();
        UUID queueId = UUID.randomUUID();
        UUID uid = UUID.randomUUID();

        RoomQueue q = new RoomQueue();
        q.setId(queueId); q.setRoomId(roomId);
        when(queueRepo.findById(queueId)).thenReturn(Optional.of(q));
        when(voteRepo.deleteByQueueAndUser(queueId, uid)).thenReturn(1);

        boolean added = service.toggleVote(roomId, queueId, uid);

        assertThat(added).isFalse();
        verify(voteRepo, never()).save(any());
    }

    @Test
    void toggleVote_rejects_queue_item_from_other_room() {
        UUID roomId = UUID.randomUUID();
        UUID queueId = UUID.randomUUID();

        RoomQueue q = new RoomQueue();
        q.setId(queueId);
        q.setRoomId(UUID.randomUUID()); // different room — cross-room injection attempt
        when(queueRepo.findById(queueId)).thenReturn(Optional.of(q));

        assertThatThrownBy(() -> service.toggleVote(roomId, queueId, UUID.randomUUID()))
            .isInstanceOf(NoSuchElementException.class);
        verify(voteRepo, never()).save(any());
    }

    @Test
    void getQueueEnriched_sorts_by_votes_then_position() {
        UUID roomId = UUID.randomUUID();
        UUID viewer = UUID.randomUUID();

        UUID qid1 = UUID.randomUUID();
        UUID qid2 = UUID.randomUUID();
        UUID qid3 = UUID.randomUUID();

        RoomQueue q1 = mkQueue(qid1, roomId, 1);
        RoomQueue q2 = mkQueue(qid2, roomId, 2);
        RoomQueue q3 = mkQueue(qid3, roomId, 3);

        when(queueRepo.findByRoomIdOrderByPosition(roomId)).thenReturn(List.of(q1, q2, q3));
        // votes: q2=5, q1=2, q3=0
        when(voteRepo.countVotesByRoom(roomId)).thenReturn(List.of(
            new Object[]{qid2, 5L},
            new Object[]{qid1, 2L}
        ));
        when(voteRepo.myVotedQueueIds(roomId, viewer)).thenReturn(List.of(qid2));
        when(trackRepo.findById(any())).thenReturn(Optional.empty());

        var res = service.getQueueEnriched(roomId, viewer);

        assertThat(res).hasSize(3);
        assertThat(res.get(0).get("id")).isEqualTo(qid2.toString());
        assertThat((long) res.get(0).get("votes")).isEqualTo(5);
        assertThat((boolean) res.get(0).get("hasMyVote")).isTrue();
        assertThat(res.get(1).get("id")).isEqualTo(qid1.toString());
        assertThat(res.get(2).get("id")).isEqualTo(qid3.toString());
        assertThat((boolean) res.get(2).get("hasMyVote")).isFalse();
    }

    @Test
    void handleCommand_rejects_non_host() {
        UUID roomId = UUID.randomUUID();
        UUID hostId = UUID.randomUUID();
        UUID otherId = UUID.randomUUID();
        ListeningRoom room = new ListeningRoom();
        room.setId(roomId); room.setHostId(hostId);
        when(roomRepo.findById(roomId)).thenReturn(Optional.of(room));

        assertThatThrownBy(() -> service.handleCommand(roomId, otherId, "PLAY", null))
            .isInstanceOf(RuntimeException.class)
            .hasMessageContaining("host");
    }

    @Test
    void leaveRoom_deactivates_when_empty() {
        UUID roomId = UUID.randomUUID();
        UUID uid = UUID.randomUUID();
        ListeningRoom room = new ListeningRoom();
        room.setId(roomId); room.setActive(true);
        when(participantRepo.countByRoomId(roomId)).thenReturn(0L);
        when(roomRepo.findById(roomId)).thenReturn(Optional.of(room));

        service.leaveRoom(roomId, uid);

        assertThat(room.isActive()).isFalse();
        verify(scheduler).cancel(roomId);
        verify(queueRepo).deleteByRoomId(roomId);
    }

    private static RoomQueue mkQueue(UUID id, UUID roomId, int pos) {
        RoomQueue q = new RoomQueue();
        q.setId(id); q.setRoomId(roomId); q.setTrackId(UUID.randomUUID());
        q.setAddedBy(UUID.randomUUID()); q.setPosition(pos);
        return q;
    }
}
