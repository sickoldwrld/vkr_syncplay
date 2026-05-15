import type { Room, TrackMeta } from './types';
import { LATE_JOIN_AHEAD_MS, SCHEDULE_AHEAD_MS, getExpectedPosition, serverNow } from './clock';

export const rooms = new Map<string, Room>();

export function getOrCreate(roomId: string, hostId: string): Room {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      hostId,
      playback: {
        trackId: null,
        meta: null,
        isPlaying: false,
        startAtServerTime: 0,
        startedPosition: 0,
        pausedPosition: 0,
      },
      skipTimer: null,
      clients: new Map(),
    });
  }
  return rooms.get(roomId)!;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function broadcast(room: Room, msg: object, excludeUserId?: string): void {
  const json = JSON.stringify(msg);
  for (const [uid, client] of room.clients) {
    if (uid === excludeUserId) continue;
    if (client.ws.readyState === 1) client.ws.send(json);
  }
}

export function sendTo(room: Room, userId: string, msg: object): void {
  const c = room.clients.get(userId);
  if (c?.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

export function buildSnapshot(room: Room): object {
  const pb = room.playback;
  const base = { type: 'SNAPSHOT', hostId: room.hostId };

  if (!pb.trackId || !pb.meta) {
    return { ...base, state: 'STOPPED', position: 0 };
  }

  const pos = getExpectedPosition(pb);
  const trackBase = {
    ...base,
    trackId: pb.trackId,
    title: pb.meta.title,
    artist: pb.meta.artist,
    durationMs: pb.meta.durationMs,
    coverKey: pb.meta.coverKey,
    position: pos,
  };

  if (!pb.isPlaying) {
    return { ...trackBase, state: 'PAUSED' };
  }

  // Late joiner: schedule LATE_JOIN_AHEAD_MS in the future so client has time to preload+decode
  const now = serverNow();
  const startAtServerTime = now + LATE_JOIN_AHEAD_MS;
  // position at startAtServerTime = currentPos + LATE_JOIN_AHEAD_MS (capped at track end)
  const futurePos = Math.min(pos + LATE_JOIN_AHEAD_MS, pb.meta.durationMs - 100);
  return { ...trackBase, state: 'PLAYING', position: futurePos, startAtServerTime };
}

export function schedulePlay(room: Room, meta: TrackMeta, positionMs: number, onEnded: () => void): void {
  clearSkipTimer(room);
  const startAtServerTime = serverNow() + SCHEDULE_AHEAD_MS;

  room.playback.trackId = meta.id;
  room.playback.meta = meta;
  room.playback.isPlaying = true;
  room.playback.startAtServerTime = startAtServerTime;
  room.playback.startedPosition = positionMs;
  room.playback.pausedPosition = positionMs;

  const remaining = meta.durationMs - positionMs - SCHEDULE_AHEAD_MS;
  if (remaining > 1000) {
    room.skipTimer = setTimeout(onEnded, remaining + SCHEDULE_AHEAD_MS);
  }

  broadcast(room, {
    type: 'PLAY',
    hostId: room.hostId,
    trackId: meta.id,
    title: meta.title,
    artist: meta.artist,
    durationMs: meta.durationMs,
    coverKey: meta.coverKey,
    position: positionMs,
    startAtServerTime,
  });
}

export function pausePlayback(room: Room): number {
  clearSkipTimer(room);
  const pos = getExpectedPosition(room.playback);
  room.playback.isPlaying = false;
  room.playback.pausedPosition = pos;
  broadcast(room, { type: 'PAUSE', position: pos });
  return pos;
}

export function seekPlayback(room: Room, positionMs: number, onEnded: () => void): void {
  clearSkipTimer(room);
  const startAtServerTime = serverNow() + SCHEDULE_AHEAD_MS;
  room.playback.startAtServerTime = startAtServerTime;
  room.playback.startedPosition = positionMs;
  room.playback.pausedPosition = positionMs;

  if (room.playback.isPlaying && room.playback.meta) {
    const remaining = room.playback.meta.durationMs - positionMs - SCHEDULE_AHEAD_MS;
    if (remaining > 1000) {
      room.skipTimer = setTimeout(onEnded, remaining + SCHEDULE_AHEAD_MS);
    }
  }

  broadcast(room, {
    type: 'SEEK',
    position: positionMs,
    startAtServerTime,
    isPlaying: room.playback.isPlaying,
  });
}

export function stopPlayback(room: Room): void {
  clearSkipTimer(room);
  room.playback = {
    trackId: null,
    meta: null,
    isPlaying: false,
    startAtServerTime: 0,
    startedPosition: 0,
    pausedPosition: 0,
  };
  broadcast(room, { type: 'STOP' });
}

function clearSkipTimer(room: Room): void {
  if (room.skipTimer) {
    clearTimeout(room.skipTimer);
    room.skipTimer = null;
  }
}
