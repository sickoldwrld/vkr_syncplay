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
}

export interface Room {
  roomId: string;
  hostId: string;
  playback: RoomPlayback;
  skipTimer: ReturnType<typeof setTimeout> | null;
  clients: Map<string, ClientSession>;
}
