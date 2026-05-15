'use client';

export interface SyncState {
  // Оценка смещения часов: Date.now() + clockOffset ≈ server.now()
  clockOffset: number;
  // EWMA RTT для сглаживания
  rttEwma: number;
  // Минимальный наблюдаемый RTT — нижняя граница задержки, используется как фильтр спайков
  rttMin: number;
  // Последние N сырых RTT (для отображения jitter)
  rttHistory: number[];
  // Только отфильтрованные (без спайков) оценки offset — для медианы
  offsetSamples: number[];
  // Время последнего hard-seek (wall clock) — антиосцилляция
  lastSeekAt: number;
  // Счётчик подряд идущих коррекций одного направления
  correctionStreak: number;
  lastCorrectionDir: number; // +1 = behind, -1 = ahead
}

export function createSyncState(): SyncState {
  return {
    clockOffset: 0,
    rttEwma: 200,
    rttMin: Infinity,
    rttHistory: [],
    offsetSamples: [],
    lastSeekAt: 0,
    correctionStreak: 0,
    lastCorrectionDir: 0,
  };
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.floor((s[m - 1] + s[m]) / 2) : s[m];
}

// Пинги каждые 800ms — быстрее сходится offset, лучше детектируем спайки
export function startPingPong(ws: WebSocket, intervalMs = 800): number {
  return window.setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'PING', payload: { clientTimestamp: Date.now() } }));
    }
  }, intervalMs);
}

export function handlePong(state: SyncState, msg: any): void {
  const now = Date.now();
  const rtt = now - msg.clientTimestamp;
  if (rtt < 0 || rtt > 10_000) return; // совсем невалидный

  // Обновляем EWMA RTT
  if (!isFinite(state.rttMin)) {
    state.rttEwma = rtt;
    state.rttMin = rtt;
  } else {
    state.rttEwma = Math.round(0.8 * state.rttEwma + 0.2 * rtt);
    // rttMin медленно «забывает» — позволяет адаптироваться к ухудшению сети
    state.rttMin = state.rttMin * 0.998 + rtt * 0.002;
    state.rttMin = Math.min(state.rttMin, rtt);
  }

  // Храним для отображения jitter
  state.rttHistory.push(rtt);
  if (state.rttHistory.length > 60) state.rttHistory.shift();

  // Spike filter: discard samples where RTT is more than 1.5× rttMin + 50ms.
  // Tighter than the classic NTP 2× rule to keep WiFi PSM bursts out of the offset median.
  const spike = state.rttMin * 1.5 + 50;
  if (rtt > spike) return;

  // NTP-оценка clockOffset:
  // serverTimestamp ≈ midpoint of round-trip
  const offset = msg.serverTimestamp - msg.clientTimestamp - Math.floor(rtt / 2);
  state.offsetSamples.push(offset);
  if (state.offsetSamples.length > 30) state.offsetSamples.shift();

  // Медиана отфильтрованных образцов — устойчива к редким выбросам
  state.clockOffset = median(state.offsetSamples);
}

// Вычисляет ожидаемую позицию в мс с учётом clock offset
export function calculatePosition(
  state: SyncState,
  positionMs: number,
  serverTimestamp: number,
): number {
  const serverNow = Date.now() + state.clockOffset;
  const elapsed = Math.max(0, serverNow - serverTimestamp);
  return Math.max(0, positionMs + elapsed);
}

export interface CorrectionResult {
  action: 'none' | 'rate' | 'seek';
  drift: number;    // секунды, >0 = мы отстаём
  rate?: number;
}

// Returns how many seconds are buffered ahead of currentTime (0 if nothing).
export function getBufferedAheadSec(audio: HTMLAudioElement): number {
  const t = audio.currentTime;
  for (let i = 0; i < audio.buffered.length; i++) {
    if (audio.buffered.start(i) <= t + 0.1 && audio.buffered.end(i) > t) {
      return audio.buffered.end(i) - t;
    }
  }
  return 0;
}

export function isPositionBuffered(audio: HTMLAudioElement, posSec: number): boolean {
  for (let i = 0; i < audio.buffered.length; i++) {
    if (audio.buffered.start(i) <= posSec && posSec <= audio.buffered.end(i)) {
      return true;
    }
  }
  return false;
}

// Returns the best seek target that won't trigger a new network fetch:
// - If targetSec is already buffered, returns targetSec.
// - Otherwise returns the end of the furthest buffered range before targetSec,
//   minus safetyMargin (to keep a small buffer after the seek).
// Returns -1 if there is no useful buffered range.
export function getBestBufferedTarget(
  audio: HTMLAudioElement,
  targetSec: number,
  safetyMargin = 1.0,
): number {
  const { buffered, currentTime } = audio;
  let bestEnd = -1;
  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    if (start <= targetSec && end >= targetSec) return targetSec; // target already buffered
    if (end < targetSec && end > currentTime) bestEnd = Math.max(bestEnd, end);
  }
  return bestEnd > 0 ? bestEnd - safetyMargin : -1;
}

// Адаптивная коррекция:
//  < 50ms  → ничего
//  50–500ms → коррекция скоростью воспроизведения (плавно, без щелчков)
//  > 500ms  → hard seek (но не чаще раз в 2с)
export function applyCorrection(
  audio: HTMLAudioElement,
  expectedSec: number,
  state: SyncState,
): CorrectionResult {
  const drift = expectedSec - audio.currentTime; // >0 = отстаём
  const abs = Math.abs(drift);
  const now = Date.now();

  if (abs < 0.05) {
    if (audio.playbackRate !== 1.0) audio.playbackRate = 1.0;
    state.correctionStreak = 0;
    return { action: 'none', drift: abs };
  }

  // readyState < 3 (HAVE_FUTURE_DATA): audio is still buffering ahead.
  // Any correction — seek OR rate change — risks stalling or restarting the buffer cycle.
  // Return to normal rate and wait until the browser has data to play.
  if (audio.readyState < 3) {
    if (audio.playbackRate !== 1.0) audio.playbackRate = 1.0;
    state.correctionStreak = 0;
    return { action: 'none', drift: abs };
  }

  // Hard seek for large drifts (> 3s). Never seek to unbuffered data — that restarts
  // the fetch cycle and causes a drop. Instead use getBestBufferedTarget:
  //   • if target IS buffered → jump there directly (no new fetch)
  //   • if not → jump to the furthest buffered end (partial catch-up, no new fetch)
  // Small drifts (< 3s) are handled by rate correction below, which is silent.
  const sinceSeek = now - state.lastSeekAt;
  if (abs > 3.0 && sinceSeek > 5000) {
    const seekTo = getBestBufferedTarget(audio, expectedSec);
    if (seekTo >= audio.currentTime + 2.0) { // meaningful forward progress only
      audio.currentTime = seekTo;
      audio.playbackRate = 1.0;
      state.lastSeekAt = now;
      state.correctionStreak = 0;
      return { action: 'seek', drift: abs };
    }
  }

  // Коррекция скоростью — масштабируем boost по величине дрифта:
  // 50ms → +1%, 500ms → +3%, cap 3%. Lower cap protects mobile buffers from drain.
  const dir = drift > 0 ? 1 : -1;
  const boost = Math.min(0.03, 0.01 + (abs / 0.5) * 0.02);

  // Антиосцилляция: если часто меняем направление — снижаем агрессивность
  if (state.lastCorrectionDir !== 0 && dir !== state.lastCorrectionDir) {
    state.correctionStreak = 0;
  } else {
    state.correctionStreak++;
  }
  state.lastCorrectionDir = dir;

  const dampedBoost = state.correctionStreak > 5
    ? Math.min(0.03, boost) // если долго в одном направлении — умеренно
    : boost;
  const rate = 1.0 + dir * dampedBoost;

  if (Math.abs(audio.playbackRate - rate) > 0.005) {
    audio.playbackRate = rate;
  }
  return { action: 'rate', drift: abs, rate };
}

// Jitter = IQR (p75−p25) of recent RTT samples.
// IQR ignores outlier spikes (e.g. WiFi PSM wake-up delays) and shows
// the typical variation, not the worst-case spread.
export function getJitter(state: SyncState): number {
  if (state.rttHistory.length < 4) return 0;
  const sorted = [...state.rttHistory.slice(-40)].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  return p75 - p25;
}
