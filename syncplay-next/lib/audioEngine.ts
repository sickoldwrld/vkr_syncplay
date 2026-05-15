'use client';

// Thresholds for drift correction
const SOFT_THRESHOLD_SEC = 0.05;   // 50ms  → adjust playbackRate
const HARD_THRESHOLD_SEC = 0.3;    // 300ms → hard reschedule
const RATE_CORRECTION = 0.01;       // ±1% playback rate tweak
const MAX_CACHE = 5;

interface RatePoint {
  ctxTime: number;    // AudioContext.currentTime at which rate took effect
  posSec: number;     // track position in seconds at ctxTime
  rate: number;
}

export class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _gain: GainNode | null = null;
  private _source: AudioBufferSourceNode | null = null;
  private _rateHistory: RatePoint[] = [];
  private _cache = new Map<string, AudioBuffer>();
  private _cacheOrder: string[] = [];
  private _volume = 1;

  private ctx(): AudioContext {
    if (!this._ctx || this._ctx.state === 'closed') {
      this._ctx = new AudioContext();
      this._gain = this._ctx.createGain();
      this._gain.gain.value = this._volume;
      this._gain.connect(this._ctx.destination);
    }
    return this._ctx;
  }

  async resume(): Promise<void> {
    const c = this.ctx();
    if (c.state === 'suspended') await c.resume();
  }

  // Fetch the full audio file and decode into an AudioBuffer. Caches the result.
  async preload(trackId: string, url: string, onProgress?: (p: number) => void): Promise<void> {
    if (this._cache.has(trackId)) return;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);

    let arrayBuffer: ArrayBuffer;

    if (onProgress && res.body) {
      const contentLength = Number(res.headers.get('Content-Length') ?? 0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) onProgress(received / contentLength);
      }
      const merged = new Uint8Array(received);
      let off = 0;
      for (const chunk of chunks) { merged.set(chunk, off); off += chunk.length; }
      arrayBuffer = merged.buffer;
    } else {
      arrayBuffer = await res.arrayBuffer();
    }

    const decoded = await this.ctx().decodeAudioData(arrayBuffer);
    this._addToCache(trackId, decoded);
  }

  isReady(trackId: string): boolean {
    return this._cache.has(trackId);
  }

  // Schedule audio playback at an exact server-clock timestamp.
  // positionMs: track offset where playback starts
  // startAtServerTime: server epoch ms when audio should begin
  // serverNow: callback returning current server time
  schedulePlay(
    trackId: string,
    positionMs: number,
    startAtServerTime: number,
    serverNow: () => number,
    onEnded?: () => void,
  ): void {
    this._stopSource();

    const buf = this._cache.get(trackId);
    if (!buf) throw new Error(`Buffer not loaded: ${trackId}`);

    const c = this.ctx();
    const source = c.createBufferSource();
    this._source = source;
    source.buffer = buf;
    source.connect(this._gain!);
    if (onEnded) {
      // Capture this source in the closure. _stopSource() nulls onended on the OLD source
      // before stop(), so this callback only fires on natural end.
      source.onended = () => { if (this._source === source) onEnded(); };
    }

    const delaySec = Math.max(0, (startAtServerTime - serverNow()) / 1000);
    const startCtxTime = c.currentTime + delaySec;
    const positionSec = Math.max(0, positionMs / 1000);

    source.start(startCtxTime, positionSec);
    this._rateHistory = [{ ctxTime: startCtxTime, posSec: positionSec, rate: 1.0 }];
  }

  pause(): number {
    const pos = this.currentPositionMs();
    this._stopSource();
    return pos;
  }

  stop(): void {
    this._stopSource();
    this._rateHistory = [];
  }

  // Track position in ms, accounting for playbackRate changes over time
  currentPositionMs(): number {
    if (!this._ctx || this._rateHistory.length === 0) return 0;
    const last = this._rateHistory[this._rateHistory.length - 1];
    const elapsed = this._ctx.currentTime - last.ctxTime;
    if (elapsed < 0) return last.posSec * 1000;  // not started yet
    return (last.posSec + elapsed * last.rate) * 1000;
  }

  // True once the scheduled source has actually started producing audio
  isActive(): boolean {
    if (!this._source || !this._ctx || this._rateHistory.length === 0) return false;
    return this._ctx.currentTime >= this._rateHistory[0].ctxTime;
  }

  // Positive = we're behind server, negative = we're ahead
  drift(expectedMs: number): number {
    return (expectedMs - this.currentPositionMs()) / 1000;
  }

  // Apply soft (rate) or hard (reschedule) correction depending on drift magnitude
  correctDrift(
    driftSec: number,
    trackId: string,
    targetPositionMs: number,   // position at targetServerTime
    targetServerTime: number,   // future server time to schedule from
    serverNow: () => number,
    onEnded?: () => void,
  ): void {
    const abs = Math.abs(driftSec);
    if (abs <= SOFT_THRESHOLD_SEC) {
      this._setRate(1.0);
    } else if (abs > HARD_THRESHOLD_SEC) {
      this.schedulePlay(trackId, targetPositionMs, targetServerTime, serverNow, onEnded);
    } else {
      this._setRate(driftSec > 0 ? 1 + RATE_CORRECTION : 1 - RATE_CORRECTION);
    }
  }

  set volume(v: number) {
    this._volume = v;
    if (this._gain) this._gain.gain.value = v;
  }
  get volume(): number { return this._volume; }

  private _setRate(rate: number): void {
    if (!this._source || !this._ctx) return;
    if (Math.abs(this._source.playbackRate.value - rate) < 0.001) return;
    const pos = this.currentPositionMs() / 1000;
    this._rateHistory.push({ ctxTime: this._ctx.currentTime, posSec: pos, rate });
    this._source.playbackRate.value = rate;
  }

  private _stopSource(): void {
    if (this._source) {
      // Clear onended BEFORE stop(0) so the async fire from stop doesn't trigger
      // the natural-end callback (which would falsely send SKIP_COMMAND).
      this._source.onended = null;
      try { this._source.stop(0); } catch {}
      this._source.disconnect();
      this._source = null;
    }
  }

  private _addToCache(trackId: string, buffer: AudioBuffer): void {
    if (this._cacheOrder.length >= MAX_CACHE) {
      this._cache.delete(this._cacheOrder.shift()!);
    }
    this._cache.set(trackId, buffer);
    this._cacheOrder.push(trackId);
  }
}
