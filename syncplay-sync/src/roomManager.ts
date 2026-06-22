import type { Room, SkipVoteState, TrackMeta } from './types';
import { LATE_JOIN_AHEAD_MS, SCHEDULE_AHEAD_MS, getExpectedPosition, serverNow } from './clock';

export const rooms = new Map<string, Room>();

// Vote-skip threshold: majority of currently connected listeners.
// Host counts as a listener too; host's explicit SKIP_COMMAND bypasses voting.
export function requiredVotes(listeners: number): number {
  if (listeners <= 1) return 1;
  return Math.ceil(listeners / 2);
}

export function getOrCreate(roomId: string, primaryHostId: string, hostIds?: Iterable<string>): Room {
  if (!rooms.has(roomId)) {
    const hosts = new Set<string>(hostIds ?? [primaryHostId]);
    hosts.add(primaryHostId);
    rooms.set(roomId, {
      roomId,
      primaryHostId,
      hostIds: hosts,
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
      skipVotes: new Set(),
      reactionWindow: new Map(),
    });
  }
  return rooms.get(roomId)!;
}

/**
 * Force-close every WebSocket connection of {@code userId} in {@code roomId},
 * notify the kicked client first (1-shot KICKED message before close so the
 * UI can show "you were removed" instead of a generic disconnect error),
 * clean up per-user state. Returns true if the room existed.
 */
export function kickUser(roomId: string, userId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  const toClose: string[] = [];
  for (const [connId, client] of room.clients.entries()) {
    if (client.userId !== userId) continue;
    try {
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify({ type: 'KICKED', reason: 'Removed by host' }));
        // Custom close code 4001: kicked. 1008 (policy) is reserved for auth.
        client.ws.close(4001, 'Kicked');
      }
    } catch {}
    toClose.push(connId);
  }
  for (const id of toClose) room.clients.delete(id);
  // Clean per-user state that would otherwise linger until reconnect timeout.
  if (room.skipVotes.delete(userId)) {
    const state = getSkipVoteState(room, '__nobody__');
    broadcast(room, { type: 'VOTE_SKIP_UPDATE', ...state });
  }
  room.reactionWindow.delete(userId);
  return true;
}

/**
 * Replace the room's host set wholesale. Called by Spring via the internal
 * /internal/rooms/:id/hosts endpoint after promote/demote, so the next
 * PLAY/PAUSE/SKIP/SEEK is authorized against the up-to-date list without
 * waiting for a reconnect.
 */
export function updateHosts(roomId: string, primaryHostId: string, hostIds: Iterable<string>): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  const set = new Set<string>(hostIds);
  set.add(primaryHostId);
  room.primaryHostId = primaryHostId;
  room.hostIds = set;
  broadcast(room, {
    type: 'HOSTS_UPDATE',
    primaryHostId,
    hostIds: Array.from(set),
  });
  return true;
}

/* ─── Realtime reactions ──────────────────────────────────────
 * Whitelist of accepted emoji characters. A whitelist (vs. arbitrary
 * Unicode) prevents abuse (long strings, malicious payloads, off-grapheme
 * combinations). New emoji must be added explicitly.
 * Token rule: per-user up to REACTION_BURST events inside REACTION_WINDOW_MS.
 */
export const ALLOWED_REACTIONS: ReadonlySet<string> = new Set([
  '❤️', '🔥', '👏', '😂', '🎵', '🥳',
]);

export const REACTION_BURST = 5;
export const REACTION_WINDOW_MS = 2000;

/** Returns true if the user is permitted to emit another reaction now.
 *  As a side effect, records the timestamp in the per-user window. */
export function allowReaction(room: Room, userId: string, now: number = Date.now()): boolean {
  const cutoff = now - REACTION_WINDOW_MS;
  const stamps = (room.reactionWindow.get(userId) ?? []).filter(t => t > cutoff);
  if (stamps.length >= REACTION_BURST) {
    room.reactionWindow.set(userId, stamps);
    return false;
  }
  stamps.push(now);
  room.reactionWindow.set(userId, stamps);
  return true;
}

/** Clean per-user window on disconnect to avoid unbounded memory growth. */
export function dropUserReactions(room: Room, userId: string): void {
  room.reactionWindow.delete(userId);
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function broadcast(room: Room, msg: object, excludeUserId?: string): void {
  const json = JSON.stringify(msg);
  for (const client of room.clients.values()) {
    if (excludeUserId && client.userId === excludeUserId) continue;
    if (client.ws.readyState === 1) client.ws.send(json);
  }
}

/** Send a message to every connection of the given userId (phone + laptop etc). */
export function sendTo(room: Room, userId: string, msg: object): void {
  const json = JSON.stringify(msg);
  for (const client of room.clients.values()) {
    if (client.userId !== userId) continue;
    if (client.ws.readyState === 1) client.ws.send(json);
  }
}

/**
 * Number of distinct users present in the room. Use this — not clients.size —
 * for any threshold that should treat a single user with multiple devices as
 * one listener (vote-skip majority, room capacity checks).
 */
export function uniqueUserCount(room: Room): number {
  const set = new Set<string>();
  for (const c of room.clients.values()) set.add(c.userId);
  return set.size;
}

export function buildSnapshot(room: Room): object {
  const pb = room.playback;
  // hostId is kept for back-compat with older clients; hostIds is the source of
  // truth for co-host permission checks.
  const base = {
    type: 'SNAPSHOT',
    hostId: room.primaryHostId,
    primaryHostId: room.primaryHostId,
    hostIds: Array.from(room.hostIds),
  };

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
  // New track → reset skip-votes (they were bound to the previous track).
  room.skipVotes.clear();
  const startAtServerTime = serverNow() + SCHEDULE_AHEAD_MS;

  room.playback.trackId = meta.id;
  room.playback.meta = meta;
  room.playback.isPlaying = true;
  room.playback.startAtServerTime = startAtServerTime;
  room.playback.startedPosition = positionMs;
  room.playback.pausedPosition = positionMs;

  // Clients start playing at T + SCHEDULE_AHEAD_MS, so the real end on clients is
  // T + SCHEDULE_AHEAD_MS + (durationMs - positionMs). The auto-skip timer must
  // fire at that moment — otherwise the track is cut SCHEDULE_AHEAD_MS short.
  const remaining = meta.durationMs - positionMs;
  if (remaining > 1000) {
    room.skipTimer = setTimeout(onEnded, remaining + SCHEDULE_AHEAD_MS);
  }

  broadcast(room, {
    type: 'PLAY',
    hostId: room.primaryHostId,
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
    const remaining = room.playback.meta.durationMs - positionMs;
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
  room.skipVotes.clear();
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

/**
 * Toggle a vote-skip for the currently playing track.
 * Returns the updated aggregate state, or null if nothing is playing (no track to skip).
 *
 * The boolean second tuple element is true when the vote count just crossed the
 * threshold — the caller (handler) uses that signal to trigger autoSkip exactly once.
 */
export function toggleSkipVote(room: Room, userId: string): { state: SkipVoteState; thresholdReached: boolean } | null {
  if (!room.playback.trackId) return null;
  const wasVoted = room.skipVotes.has(userId);
  if (wasVoted) {
    room.skipVotes.delete(userId);
  } else {
    room.skipVotes.add(userId);
  }
  const listeners = uniqueUserCount(room);
  const required = requiredVotes(listeners);
  const votes = room.skipVotes.size;
  const state: SkipVoteState = { votes, required, listeners, voted: !wasVoted };
  // Threshold only "reaches" on the transition (vote added that pushed us to/over threshold).
  const thresholdReached = !wasVoted && votes >= required;
  return { state, thresholdReached };
}

/** Build the current skip-vote snapshot for a viewer (voted=true if they already voted). */
export function getSkipVoteState(room: Room, viewerId: string): SkipVoteState {
  const listeners = uniqueUserCount(room);
  return {
    votes: room.skipVotes.size,
    required: requiredVotes(listeners),
    listeners,
    voted: room.skipVotes.has(viewerId),
  };
}

/** Remove a user from skip-votes on disconnect — and recompute threshold for remaining listeners. */
export function dropUserFromSkipVotes(room: Room, userId: string): SkipVoteState {
  room.skipVotes.delete(userId);
  const listeners = uniqueUserCount(room);
  return {
    votes: room.skipVotes.size,
    required: requiredVotes(listeners),
    listeners,
    voted: false,
  };
}

function clearSkipTimer(room: Room): void {
  if (room.skipTimer) {
    clearTimeout(room.skipTimer);
    room.skipTimer = null;
  }
}
