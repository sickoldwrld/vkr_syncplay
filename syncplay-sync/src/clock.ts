import type { RoomPlayback } from './types';

export const SCHEDULE_AHEAD_MS = 600;
export const LATE_JOIN_AHEAD_MS = 3000;

export function serverNow(): number {
  return Date.now();
}

export function getExpectedPosition(pb: Pick<RoomPlayback, 'isPlaying' | 'startAtServerTime' | 'startedPosition' | 'pausedPosition'>): number {
  if (!pb.isPlaying) return pb.pausedPosition;
  const now = serverNow();
  if (now < pb.startAtServerTime) return pb.startedPosition;
  return pb.startedPosition + (now - pb.startAtServerTime);
}
