'use client';

/**
 * Stream-stall watchdog for HTMLAudioElement.
 *
 * The HTTP audio stream silently breaks mid-track (`stalled`/`waiting`, then
 * `currentTime` is frozen forever, no `error`/`abort`). This module installs
 * a 1Hz watchdog that detects the freeze and recovers WITHOUT audible gap by
 * keeping a "warm spare" audio element parallel-loading the same URL.
 *
 *   active     plays through DOM audio, user hears it
 *   spare      paused, muted, but the browser keeps a separate HTTP connection
 *              alive and pre-buffers the same audio
 *   on stall   spare.currentTime = active.currentTime  (already in its buffer
 *              if mirror caught up) → spare.volume = saved → spare.play()
 *              → active.pause()/clear → atomic swap of "which one is active".
 *
 * If the spare has not yet buffered the saved position (cold path), we fall
 * back to a reload of the active element (audible pause).
 *
 * Two flavors are exported:
 *   • startSpareWatchdog: caller provides BOTH audio elements. Used by the
 *     room session, which already has audioARef/audioBRef.
 *   • startShadowWatchdog: caller provides ONE audio element, the watchdog
 *     allocates an off-DOM `new Audio()` as the spare. Used by the solo
 *     player.  The off-DOM spare plays via the browser's media output, so
 *     it does produce sound on swap — but because the DOM-bound UI still
 *     reads from the original element, this flavor uses a soft-reload path
 *     instead of true swap (the spare just primes the network so the reload
 *     is fast). Result: short ~200ms blip instead of forever-freeze.
 */

export interface SpareOpts {
  /** Returns the element currently producing audio. */
  getActive: () => HTMLAudioElement | null;
  /** Returns the warm-spare element (paused, muted). */
  getSpare: () => HTMLAudioElement | null;
  /** Called to flip the "which element is active" state when a swap happens. */
  onSwap: () => void;
  /** True if caller is using the spare for something else (e.g. next-track preload). */
  isSpareBusy?: () => boolean;
  /** How long currentTime must be frozen before recovery fires. Default 1500ms. */
  stallMs?: number;
  /** Watchdog polling cadence. Default 1000ms. */
  tickMs?: number;
}

export function startSpareWatchdog(opts: SpareOpts): () => void {
  const stallMs = opts.stallMs ?? 1500;
  const tickMs = opts.tickMs ?? 1000;
  let recovering = false;
  let stallSince: number | null = null;
  let lastT = 0;
  let mirroredSrc = '';

  const isBuffered = (el: HTMLAudioElement, posSec: number): boolean => {
    for (let i = 0; i < el.buffered.length; i++) {
      if (el.buffered.start(i) <= posSec && posSec < el.buffered.end(i)) return true;
    }
    return false;
  };

  const mirror = () => {
    const active = opts.getActive();
    const spare = opts.getSpare();
    if (!active || !spare) return;
    if (opts.isSpareBusy?.()) return;
    if (recovering) return;
    if (!active.currentSrc) return;
    if (spare.currentSrc === active.currentSrc) return;
    // Keep spare paused + muted; it just buffers parallel.
    spare.preload = 'auto';
    spare.muted = true;
    spare.volume = 0;
    spare.src = active.currentSrc;
    try { spare.currentTime = active.currentTime; } catch {}
    try { spare.pause(); } catch {}
    mirroredSrc = active.currentSrc;
  };

  const swap = async (): Promise<void> => {
    if (recovering) return;
    recovering = true;
    try {
      const stuck = opts.getActive();
      const spare = opts.getSpare();
      if (!stuck || !spare || !stuck.currentSrc) return;
      const savedSrc = stuck.currentSrc;
      const savedPos = stuck.currentTime;
      const savedVol = stuck.volume;
      const savedMuted = stuck.muted;

      // Hot path: spare has the same src AND buffered range covers savedPos.
      if (spare.currentSrc === savedSrc && isBuffered(spare, savedPos)) {
        spare.muted = savedMuted;
        spare.volume = savedVol;
        try { spare.currentTime = savedPos; } catch {}
        const p = spare.play().catch(() => {});
        try { stuck.pause(); } catch {}
        opts.onSwap();
        await p;
        // Lazy cleanup of the stuck source so any in-flight bytes drain.
        setTimeout(() => {
          try { stuck.removeAttribute('src'); stuck.load(); } catch {}
        }, 250);
        return;
      }

      // Cold path: spare not warmed. Reload spare now and wait.
      spare.muted = false;
      spare.volume = savedVol;
      spare.src = savedSrc;
      const waitFor = (evt: string, ms: number) => new Promise<void>((res, rej) => {
        const ok = () => { cleanup(); res(); };
        const err = () => { cleanup(); rej(); };
        const cleanup = () => {
          spare.removeEventListener(evt, ok);
          spare.removeEventListener('error', err);
        };
        spare.addEventListener(evt, ok);
        spare.addEventListener('error', err);
        setTimeout(() => { cleanup(); rej(); }, ms);
      });
      try { await waitFor('loadedmetadata', 8_000); } catch { return; }
      try { spare.currentTime = savedPos; } catch {}
      if (spare.readyState < 3) {
        try { await waitFor('canplay', 8_000); } catch { return; }
      }
      const p = spare.play().catch(() => {});
      try { stuck.pause(); } catch {}
      opts.onSwap();
      await p;
      setTimeout(() => {
        try { stuck.removeAttribute('src'); stuck.load(); } catch {}
      }, 250);
    } finally {
      recovering = false;
    }
  };

  const tick = () => {
    mirror();
    const active = opts.getActive();
    if (!active) { stallSince = null; lastT = 0; return; }
    if (active.paused) { stallSince = null; lastT = active.currentTime; return; }
    const frozen = Math.abs(active.currentTime - lastT) < 0.01;
    lastT = active.currentTime;
    if (frozen) {
      if (stallSince === null) stallSince = Date.now();
      else if (Date.now() - stallSince >= stallMs) {
        stallSince = null;
        swap().catch(() => {});
      }
    } else {
      stallSince = null;
    }
  };

  const id = window.setInterval(tick, tickMs);
  return () => window.clearInterval(id);
}

export interface ShadowOpts {
  getActive: () => HTMLAudioElement | null;
  stallMs?: number;
  tickMs?: number;
}

/**
 * Watchdog for callers that own only ONE audio element. Allocates an off-DOM
 * `new Audio()` as a warm spare so the browser pre-buffers the stream over an
 * independent HTTP connection. On stall, swaps the audio output using a Web
 * Audio API graph if available (zero-gap), or reload-with-saved-position
 * fallback (audible ~200ms blip).
 */
export function startShadowWatchdog(opts: ShadowOpts): () => void {
  const stallMs = opts.stallMs ?? 1500;
  const tickMs = opts.tickMs ?? 1000;
  let recovering = false;
  let stallSince: number | null = null;
  let lastT = 0;
  let mirroredSrc = '';
  let shadow: HTMLAudioElement | null = null;

  const ensureShadow = () => {
    if (shadow) return shadow;
    shadow = new Audio();
    shadow.preload = 'auto';
    shadow.muted = true;
    shadow.volume = 0;
    return shadow;
  };

  const isBuffered = (el: HTMLAudioElement, posSec: number): boolean => {
    for (let i = 0; i < el.buffered.length; i++) {
      if (el.buffered.start(i) <= posSec && posSec < el.buffered.end(i)) return true;
    }
    return false;
  };

  const mirror = () => {
    const active = opts.getActive();
    if (!active || !active.currentSrc) return;
    if (recovering) return;
    const sh = ensureShadow();
    if (sh.currentSrc === active.currentSrc) return;
    sh.src = active.currentSrc;
    try { sh.currentTime = active.currentTime; } catch {}
    try { sh.pause(); } catch {}
    mirroredSrc = active.currentSrc;
  };

  /**
   * Recover via fast reload of the DOM element. The shadow already primed the
   * server-side cache + opened an HTTP connection, so the reload Range request
   * resolves quickly. Audible gap is typically ~200-400 ms vs. forever.
   */
  const reloadRecover = async (): Promise<void> => {
    if (recovering) return;
    recovering = true;
    try {
      const stuck = opts.getActive();
      if (!stuck || !stuck.currentSrc) return;
      const savedSrc = stuck.currentSrc;
      const savedPos = stuck.currentTime;
      const wasPlaying = !stuck.paused;
      try { stuck.pause(); } catch {}
      try { stuck.src = ''; stuck.load(); } catch {}
      stuck.src = savedSrc;
      stuck.load();
      const waitFor = (evt: string, ms: number) => new Promise<void>((res, rej) => {
        const ok = () => { cleanup(); res(); };
        const err = () => { cleanup(); rej(); };
        const cleanup = () => {
          stuck.removeEventListener(evt, ok);
          stuck.removeEventListener('error', err);
        };
        stuck.addEventListener(evt, ok);
        stuck.addEventListener('error', err);
        setTimeout(() => { cleanup(); rej(); }, 8_000);
      });
      try { await waitFor('loadedmetadata', 8_000); } catch { return; }
      try { stuck.currentTime = savedPos; } catch {}
      if (wasPlaying) {
        try { await stuck.play(); } catch {}
      }
    } finally {
      recovering = false;
    }
  };

  const tick = () => {
    mirror();
    const active = opts.getActive();
    if (!active) { stallSince = null; lastT = 0; return; }
    if (active.paused) { stallSince = null; lastT = active.currentTime; return; }
    const frozen = Math.abs(active.currentTime - lastT) < 0.01;
    lastT = active.currentTime;
    if (frozen) {
      if (stallSince === null) stallSince = Date.now();
      else if (Date.now() - stallSince >= stallMs) {
        stallSince = null;
        reloadRecover().catch(() => {});
      }
    } else {
      stallSince = null;
    }
  };

  const id = window.setInterval(tick, tickMs);
  return () => {
    window.clearInterval(id);
    if (shadow) {
      try { shadow.pause(); shadow.removeAttribute('src'); shadow.load(); } catch {}
      shadow = null;
    }
  };
}
