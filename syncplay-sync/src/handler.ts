import type WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { validateSession, validateWsToken, fetchRoomDetail, popNextTrack } from './auth';
import {
  getOrCreate, getRoom, broadcast, sendTo, uniqueUserCount,
  buildSnapshot, schedulePlay, pausePlayback, seekPlayback, stopPlayback,
  toggleSkipVote, getSkipVoteState, dropUserFromSkipVotes,
  allowReaction, dropUserReactions, ALLOWED_REACTIONS,
} from './roomManager';
import type { Room } from './types';
import { serverNow } from './clock';

export async function handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const remoteIp = req.socket.remoteAddress;
  const userAgent = req.headers['user-agent']?.slice(0, 60) || '';
  console.log(`[ws] upgrade from ${remoteIp} ua="${userAgent}" url=${req.url}`);

  const match = req.url?.match(/\/ws\/room\/([^/?]+)(?:\?(.+))?/);
  if (!match) {
    console.log('[ws] invalid path');
    ws.close(1008, 'Invalid path');
    return;
  }
  const roomId = match[1];
  const query = new URLSearchParams(match[2] ?? '');
  const wsToken = query.get('token');

  // Prefer WS token (works across all browsers/cross-port), fall back to cookies
  const cookie = req.headers.cookie ?? '';
  const result = wsToken
    ? await validateWsToken(wsToken)
    : await validateSession(cookie);
  if (typeof result === 'string') {
    // Surface specific failure reason so the client UI can act on it
    const reasonMap: Record<string, string> = {
      'no-cookie': 'No session cookie',
      'fetch-error': 'Auth service unreachable',
      'unauthorized': 'Session expired',
    };
    const reason = reasonMap[result] ?? 'Unauthorized';
    console.log(`[ws] close: ${reason} (${result})`);
    ws.close(1008, reason);
    return;
  }
  const user = result;

  let room = getRoom(roomId);
  if (!room) {
    const detail = await fetchRoomDetail(roomId);
    if (!detail) {
      console.log(`[ws] close: room ${roomId} not found`);
      ws.close(1008, 'Room not found');
      return;
    }
    // Load-test bootstrap: the first connecting user is host. Spring sends a
    // real hostId in production, so this branch only triggers under BENCH_AUTH.
    const hostId = detail.hostId === '__bootstrap__' ? user.id : detail.hostId;
    room = getOrCreate(roomId, hostId, detail.hostIds ?? [hostId]);
  }

  // Multiple devices of the same user (phone + laptop) are allowed: each connection
  // gets its own connectionId and lives in the map independently. The old "replace
  // existing" logic broke this because both devices would fight to evict each other,
  // producing an endless reconnect loop on the client side (Подключаемся ↔ Подключено).
  const connectionId = randomUUID();
  room.clients.set(connectionId, { ws, userId: user.id, roomId, connectionId });
  const sessionsForUser = Array.from(room.clients.values()).filter(c => c.userId === user.id).length;
  console.log(`[ws] connected room=${roomId} user=${user.id} conn=${connectionId.slice(0, 8)} sessions-of-user=${sessionsForUser} primaryHost=${room.primaryHostId} isHost=${room.hostIds.has(user.id)} hosts=${room.hostIds.size} listeners=${uniqueUserCount(room)}`);

  try {
    ws.send(JSON.stringify(buildSnapshot(room)));
    // Send the joiner the current vote-skip state so the UI is correct on late-join.
    if (room.playback.trackId) {
      ws.send(JSON.stringify({ type: 'VOTE_SKIP_UPDATE', ...getSkipVoteState(room, user.id) }));
    }
    // Inform everyone else about the new listener count — required threshold may shift
    // when a new *unique user* joins. A second device of an already-present user does
    // not change the unique count, so suppress the broadcast in that case.
    if (sessionsForUser === 1) {
      const broadcastState = getSkipVoteState(room, '__nobody__');
      broadcast(room, { type: 'VOTE_SKIP_UPDATE', ...broadcastState }, user.id);
    }
  } catch {}

  ws.on('message', async (data: { toString(): string }) => {
    try {
      const msg = JSON.parse(data.toString());
      await dispatch(room!, user, msg, ws);
    } catch {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ERROR', message: 'Bad message' }));
    }
  });

  ws.on('close', () => {
    const r = getRoom(roomId);
    if (!r) return;
    // Remove just this one connection. Other sessions of the same user (other devices)
    // stay connected.
    if (!r.clients.delete(connectionId)) return;
    const stillPresent = Array.from(r.clients.values()).some(c => c.userId === user.id);
    console.log(`[ws] disconnected room=${roomId} user=${user.id} conn=${connectionId.slice(0, 8)} user-fully-left=${!stillPresent} listeners=${uniqueUserCount(r)}`);
    // Per-user cleanup runs only when the user has no remaining connections.
    if (stillPresent) return;
    dropUserReactions(r, user.id);
    if (r.playback.trackId) {
      const state = dropUserFromSkipVotes(r, user.id);
      broadcast(r, { type: 'VOTE_SKIP_UPDATE', ...state });
      // After someone leaves the threshold may already be met by the remaining voters —
      // re-evaluate so we don't strand the room on an obsolete skip-vote.
      if (state.votes >= state.required && state.listeners > 0) {
        autoSkip(r).catch(err => console.error('[ws] vote-skip after disconnect failed:', err));
      }
    }
  });
}

async function dispatch(room: Room, user: { id: string }, msg: Record<string, unknown>, sourceWs: WebSocket): Promise<void> {
  const isHost = room.hostIds.has(user.id);
  if (msg.type !== 'PING') {
    console.log(`[ws] cmd type=${msg.type} user=${user.id} isHost=${isHost} primaryHost=${room.primaryHostId}`);
  }

  switch (msg.type) {
    case 'PING': {
      // PONG must go back to the exact socket that PINGed — clockSync calculates
      // RTT and offset using that specific PING's clientTimestamp. Sending PONG
      // to a different device of the same user would corrupt the clock estimate.
      if (sourceWs.readyState === 1) {
        sourceWs.send(JSON.stringify({
          type: 'PONG',
          serverTimestamp: serverNow(),
          clientTimestamp: msg.clientTimestamp,
        }));
      }
      break;
    }

    case 'PLAY_COMMAND': {
      if (!isHost) return;
      const pb = room.playback;
      if (!pb.trackId || !pb.meta) {
        const meta = await popNextTrack(room.roomId);
        if (!meta) { sendTo(room, user.id, { type: 'ERROR', message: 'Queue empty' }); return; }
        broadcast(room, { type: 'QUEUE_UPDATE' });
        schedulePlay(room, meta, 0, () => autoSkip(room));
      } else if (!pb.isPlaying) {
        schedulePlay(room, pb.meta, pb.pausedPosition, () => autoSkip(room));
      }
      break;
    }

    case 'PAUSE_COMMAND': {
      if (!isHost || !room.playback.isPlaying) return;
      pausePlayback(room);
      break;
    }

    case 'SEEK_COMMAND': {
      if (!isHost) return;
      const posMs = Number(msg.positionMs);
      if (isNaN(posMs) || posMs < 0) return;
      seekPlayback(room, posMs, () => autoSkip(room));
      break;
    }

    case 'SKIP_COMMAND': {
      if (!isHost) return;
      await autoSkip(room);
      break;
    }

    case 'CHAT_MESSAGE': {
      const content = String(msg.content ?? '').trim().slice(0, 500);
      if (content) broadcast(room, { type: 'CHAT', userId: user.id, content, ts: serverNow() });
      break;
    }

    case 'REACTION': {
      const emoji = typeof msg.emoji === 'string' ? msg.emoji : '';
      if (!ALLOWED_REACTIONS.has(emoji)) return;
      if (!allowReaction(room, user.id)) return; // rate-limited silently
      broadcast(room, { type: 'REACTION', userId: user.id, emoji, ts: serverNow() });
      break;
    }

    case 'VOTE_SKIP': {
      // Any participant (including host) can vote. Host can also bypass via SKIP_COMMAND.
      const result = toggleSkipVote(room, user.id);
      if (!result) {
        sendTo(room, user.id, { type: 'ERROR', message: 'Nothing playing' });
        return;
      }
      console.log(`[ws] vote-skip room=${room.roomId} user=${user.id} voted=${result.state.voted} ${result.state.votes}/${result.state.required}`);
      // Broadcast counts to everyone with voterId so each client can update its own "voted" flag.
      broadcast(room, {
        type: 'VOTE_SKIP_UPDATE',
        votes: result.state.votes,
        required: result.state.required,
        listeners: result.state.listeners,
        voterId: user.id,
        voted: result.state.voted,
      });
      if (result.thresholdReached) {
        console.log(`[ws] vote-skip threshold reached on room=${room.roomId} — skipping`);
        await autoSkip(room);
      }
      break;
    }
  }
}

async function autoSkip(room: Room): Promise<void> {
  const meta = await popNextTrack(room.roomId);
  broadcast(room, { type: 'QUEUE_UPDATE' });
  if (!meta) {
    stopPlayback(room);
  } else {
    schedulePlay(room, meta, 0, () => autoSkip(room));
  }
}
