import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getExpectedPosition, serverNow, SCHEDULE_AHEAD_MS } from '../clock';
import type { RoomPlayback } from '../types';

describe('serverNow', () => {
  it('returns Date.now()', () => {
    const t0 = Date.now();
    const v = serverNow();
    expect(v).toBeGreaterThanOrEqual(t0);
    expect(v).toBeLessThan(t0 + 5);
  });
});

describe('getExpectedPosition', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns pausedPosition when paused', () => {
    const pb: RoomPlayback = {
      trackId: 't', meta: null,
      isPlaying: false,
      startAtServerTime: 0,
      startedPosition: 0,
      pausedPosition: 12_345,
    };
    expect(getExpectedPosition(pb)).toBe(12_345);
  });

  it('returns startedPosition before scheduled start (still in lookahead)', () => {
    vi.setSystemTime(1_000_000);
    const pb: RoomPlayback = {
      trackId: 't', meta: null,
      isPlaying: true,
      startAtServerTime: 1_000_500, // 500ms in the future
      startedPosition: 7_000,
      pausedPosition: 0,
    };
    expect(getExpectedPosition(pb)).toBe(7_000);
  });

  it('returns startedPosition + elapsed once past startAtServerTime', () => {
    vi.setSystemTime(2_000_000);
    const pb: RoomPlayback = {
      trackId: 't', meta: null,
      isPlaying: true,
      startAtServerTime: 1_999_000, // 1000ms in the past
      startedPosition: 5_000,
      pausedPosition: 0,
    };
    expect(getExpectedPosition(pb)).toBe(6_000);
  });
});

describe('SCHEDULE_AHEAD_MS', () => {
  it('is a small positive number suitable for client warm-up', () => {
    expect(SCHEDULE_AHEAD_MS).toBeGreaterThan(0);
    expect(SCHEDULE_AHEAD_MS).toBeLessThan(2000);
  });
});
