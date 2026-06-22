import { describe, it, expect } from 'vitest';
import {
  createSyncState,
  handlePong,
  calculatePosition,
  applyCorrection,
  getJitter,
  median,
} from '@/lib/sync';

function pong(state: ReturnType<typeof createSyncState>, rtt: number, offset: number) {
  // emulate PING/PONG round-trip with controlled rtt and offset
  const sendAt = Date.now() - rtt;
  const serverTimestamp = sendAt + Math.floor(rtt / 2) + offset;
  handlePong(state, { clientTimestamp: sendAt, serverTimestamp });
}

describe('median', () => {
  it('returns 0 for empty array', () => expect(median([])).toBe(0));
  it('returns middle element for odd-length', () => expect(median([3, 1, 2])).toBe(2));
  it('returns floor of midpoint mean for even-length', () => expect(median([1, 2, 3, 4])).toBe(2));
});

describe('handlePong', () => {
  it('ignores negative or implausible RTT', () => {
    const s = createSyncState();
    handlePong(s, { clientTimestamp: Date.now() + 1000, serverTimestamp: Date.now() });
    expect(s.offsetSamples).toHaveLength(0);
  });

  it('collects offsets and converges towards the true offset (low jitter)', () => {
    const s = createSyncState();
    const TRUE_OFFSET = 250;
    for (let i = 0; i < 10; i++) pong(s, 40 + Math.random() * 5, TRUE_OFFSET);
    expect(Math.abs(s.clockOffset - TRUE_OFFSET)).toBeLessThan(15);
    expect(s.rttHistory.length).toBeGreaterThan(5);
  });

  it('spike-filters RTT samples > 1.5×rttMin+50ms (does NOT update offset on spike)', () => {
    const s = createSyncState();
    for (let i = 0; i < 8; i++) pong(s, 30, 100);
    const offsetBefore = s.clockOffset;
    const samplesBefore = s.offsetSamples.length;
    // spike: rtt 600ms — should be filtered
    pong(s, 600, 9999);
    expect(s.clockOffset).toBe(offsetBefore);
    expect(s.offsetSamples.length).toBe(samplesBefore);
  });
});

describe('calculatePosition', () => {
  it('returns positionMs when no time has elapsed and offset=0', () => {
    const s = createSyncState();
    const now = Date.now();
    expect(calculatePosition(s, 5000, now)).toBe(5000);
  });

  it('adds elapsed wall-clock time to positionMs', () => {
    const s = createSyncState();
    const pastServerTs = Date.now() - 1000;
    const v = calculatePosition(s, 5000, pastServerTs);
    expect(v).toBeGreaterThanOrEqual(5990);
    expect(v).toBeLessThan(5050 + 1100);
  });

  it('never returns negative position', () => {
    const s = createSyncState();
    expect(calculatePosition(s, -500, Date.now())).toBe(0);
  });
});

describe('applyCorrection', () => {
  function makeAudio(currentTime: number, readyState = 4): HTMLAudioElement {
    const buffered = {
      length: 1,
      start: () => 0,
      end: () => 9999,
    } as unknown as TimeRanges;
    return {
      currentTime,
      duration: 9999,
      playbackRate: 1.0,
      readyState,
      buffered,
      paused: false,
    } as unknown as HTMLAudioElement;
  }

  it('does nothing inside the 50ms dead-zone', () => {
    const s = createSyncState();
    const a = makeAudio(10.02);
    const r = applyCorrection(a, 10.0, s);
    expect(r.action).toBe('none');
    expect(a.playbackRate).toBe(1.0);
  });

  it('returns no-op when audio is still buffering (readyState<3)', () => {
    const s = createSyncState();
    const a = makeAudio(10, 1);
    const r = applyCorrection(a, 12, s);
    expect(r.action).toBe('none');
    expect(a.playbackRate).toBe(1.0);
  });

  it('rate-corrects for drifts above 50ms but below 3s', () => {
    const s = createSyncState();
    const a = makeAudio(9.5); // 500ms behind
    const r = applyCorrection(a, 10.0, s);
    expect(r.action).toBe('rate');
    expect(a.playbackRate).toBeGreaterThan(1.0);
  });

  it('hard-seeks for large drifts when target is buffered', () => {
    const s = createSyncState();
    const a = makeAudio(2);
    const r = applyCorrection(a, 10, s);
    expect(r.action).toBe('seek');
    expect(a.currentTime).toBeCloseTo(10, 1);
  });
});

describe('getJitter', () => {
  it('returns 0 for fewer than 4 samples', () => {
    const s = createSyncState();
    s.rttHistory = [10, 20, 30];
    expect(getJitter(s)).toBe(0);
  });

  it('returns IQR of recent samples', () => {
    const s = createSyncState();
    s.rttHistory = [10, 20, 30, 40, 50, 60, 70, 80];
    const j = getJitter(s);
    expect(j).toBeGreaterThan(0);
  });
});
