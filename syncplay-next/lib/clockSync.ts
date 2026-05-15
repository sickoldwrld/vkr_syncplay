'use client';

export interface ClockSync {
  serverOffset: number;   // serverNow() = performance.now() + serverOffset ≈ Date.now() on server
  rttEwma: number;
  rttMin: number;
  offsetSamples: number[];
  rttHistory: number[];
  calibrated: boolean;    // true once ≥3 non-spike samples collected
}

export function createClockSync(): ClockSync {
  return {
    serverOffset: 0,
    rttEwma: 0,
    rttMin: Infinity,
    offsetSamples: [],
    rttHistory: [],
    calibrated: false,
  };
}

// Returns current server-equivalent time in ms (same epoch as Date.now() on server)
export function serverNow(sync: ClockSync): number {
  return performance.now() + sync.serverOffset;
}

// Call with each PONG message. clientTimestamp must have been set via performance.now() at PING send time.
export function handlePong(
  sync: ClockSync,
  msg: { serverTimestamp: number; clientTimestamp: number },
): void {
  const now = performance.now();
  const rtt = now - msg.clientTimestamp;
  if (rtt < 0 || rtt > 10_000) return;

  if (!isFinite(sync.rttMin)) {
    sync.rttEwma = rtt;
    sync.rttMin = rtt;
  } else {
    sync.rttEwma = 0.8 * sync.rttEwma + 0.2 * rtt;
    sync.rttMin = Math.min(sync.rttMin * 0.998 + rtt * 0.002, rtt);
  }
  sync.rttHistory.push(rtt);
  if (sync.rttHistory.length > 60) sync.rttHistory.shift();

  // Spike filter: discard samples with RTT > 1.5× rttMin + 50ms
  if (rtt > sync.rttMin * 1.5 + 50) return;

  // NTP-style offset: server clock value at midpoint of round-trip
  const offset = msg.serverTimestamp - (msg.clientTimestamp + rtt / 2);
  sync.offsetSamples.push(offset);
  if (sync.offsetSamples.length > 30) sync.offsetSamples.shift();

  // Median offset for stability
  const sorted = [...sync.offsetSamples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  sync.serverOffset = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  sync.calibrated = sync.offsetSamples.length >= 3;
}

export function getJitter(sync: ClockSync): number {
  if (sync.rttHistory.length < 4) return 0;
  const sorted = [...sync.rttHistory.slice(-40)].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  return p75 - p25;
}
