import type WebSocket from 'ws';

export interface TrackMeta {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  coverKey: string | null;
}

export interface RoomPlayback {
  trackId: string | null;
  meta: TrackMeta | null;
  isPlaying: boolean;
  startAtServerTime: number;  // epoch ms: when audio should begin on all clients
  startedPosition: number;    // track offset ms at startAtServerTime
  pausedPosition: number;     // track offset ms when paused
}

export interface ClientSession {
  ws: WebSocket;
  userId: string;
  roomId: string;
  // Per-connection identifier. Multiple devices of the same user produce
  // multiple ClientSessions with the same userId but distinct connectionIds.
  connectionId: string;
}

export interface Room {
  roomId: string;
  // The room creator. Cannot be demoted, broadcast as hostId for back-compat.
  primaryHostId: string;
  // All users with host privileges (primary + co-hosts). PLAY/PAUSE/SKIP/SEEK
  // commands are authorized against this set. Always contains primaryHostId.
  hostIds: Set<string>;
  playback: RoomPlayback;
  skipTimer: ReturnType<typeof setTimeout> | null;
  // Keyed by connectionId, not userId — one user may have several active
  // connections (e.g. phone + laptop). Listener counts that should be
  // user-unique (vote-skip threshold) must dedup via uniqueUserCount().
  clients: Map<string, ClientSession>;
  // Ephemeral set of userIds that voted to skip the currently playing track.
  // Reset on every track change (schedulePlay / stopPlayback).
  skipVotes: Set<string>;
  // Per-user reaction timestamps within the recent rate-limit window.
  // Used to throttle abuse (max N reactions per window per user).
  reactionWindow: Map<string, number[]>;
}

export interface SkipVoteState {
  votes: number;
  required: number;
  listeners: number;
  voted: boolean;
}
