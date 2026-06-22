package com.syncplay.repo;

import com.syncplay.model.RoomQueueVote;
import com.syncplay.model.RoomQueueVoteId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface RoomQueueVoteRepo extends JpaRepository<RoomQueueVote, RoomQueueVoteId> {

    /** Подсчёт голосов по каждому item очереди в комнате. */
    @Query(value = """
        SELECT v.queue_id, COUNT(*) AS cnt
        FROM room_queue_votes v JOIN room_queue q ON q.id = v.queue_id
        WHERE q.room_id = :roomId
        GROUP BY v.queue_id
        """, nativeQuery = true)
    List<Object[]> countVotesByRoom(@Param("roomId") UUID roomId);

    /** ID треков очереди за которые проголосовал данный пользователь. */
    @Query(value = """
        SELECT v.queue_id FROM room_queue_votes v
        JOIN room_queue q ON q.id = v.queue_id
        WHERE q.room_id = :roomId AND v.user_id = :userId
        """, nativeQuery = true)
    List<UUID> myVotedQueueIds(@Param("roomId") UUID roomId, @Param("userId") UUID userId);

    @Modifying
    @Query("DELETE FROM RoomQueueVote v WHERE v.queueId = :qid AND v.userId = :uid")
    int deleteByQueueAndUser(@Param("qid") UUID queueId, @Param("uid") UUID userId);
}
