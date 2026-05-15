import type WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import { validateSession, validateWsToken, fetchRoomDetail, popNextTrack } from './auth';
import {
  getOrCreate, getRoom, broadcast, sendTo,
  buildSnapshot, schedulePlay, pausePlayback, seekPlayback, stopPlayback,
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
    room = getOrCreate(roomId, detail.hostId);
  }

  room.clients.set(user.id, { ws, userId: user.id, roomId });
  console.log(`[ws] connected room=${roomId} user=${user.id} hostId=${room.hostId} isHost=${user.id === room.hostId}`);

  try {
    ws.send(JSON.stringify(buildSnapshot(room)));
  } catch {}

  ws.on('message', async (data: { toString(): string }) => {
    try {
      const msg = JSON.parse(data.toString());
      await dispatch(room!, user, msg);
    } catch {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ERROR', message: 'Bad message' }));
    }
  });

  ws.on('close', () => {
    getRoom(roomId)?.clients.delete(user.id);
  });
}

async function dispatch(room: Room, user: { id: string }, msg: Record<string, unknown>): Promise<void> {
  const isHost = user.id === room.hostId;
  if (msg.type !== 'PING') {
    console.log(`[ws] cmd type=${msg.type} user=${user.id} isHost=${isHost} hostId=${room.hostId}`);
  }

  switch (msg.type) {
    case 'PING': {
      const c = room.clients.get(user.id);
      if (c?.ws.readyState === 1) {
        c.ws.send(JSON.stringify({
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
