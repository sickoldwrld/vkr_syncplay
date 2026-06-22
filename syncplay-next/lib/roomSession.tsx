'use client';
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { api, streamUrl, voteQueueItem } from './api';
import { startSpareWatchdog } from './audioWatchdog';

/* ─── Public types ────────────────────────────────────────── */

export interface TrackInfo {
  id: string; title: string; artist: string;
  durationMs: number; coverKey?: string | null;
}
export interface QueueItem {
  id: string; trackId: string;
  title?: string; artist?: string;
  durationMs?: number; coverKey?: string | null;
  votes?: number; hasMyVote?: boolean; position?: number;
}
export interface ChatMessage { user: string; text: string }
export interface Metrics { rtt: number; avg: number; jitter: number; offset: number; drift: number }
export interface SkipVote { votes: number; required: number; listeners: number; voted: boolean }
export interface FloatingReaction { id: string; emoji: string; userId: string; offsetPx: number }
export const REACTION_EMOJIS: readonly string[] = ['❤️', '🔥', '👏', '😂', '🎵', '🥳'];

export interface Participant {
  userId: string;
  username?: string;
  role: 'HOST' | 'LISTENER';
  primary: boolean;
}

interface RoomSessionAPI {
  roomId: string | null;
  connected: boolean;
  closeReason: string | null;
  isHost: boolean;
  isPrimaryHost: boolean;
  primaryHostId: string | null;
  hostIds: string[];
  nowTrack: TrackInfo | null;
  playing: boolean;
  progress: number;
  duration: number;
  queue: QueueItem[];
  tracks: any[];
  chat: ChatMessage[];
  needsTap: boolean;
  metrics: Metrics;
  skipVote: SkipVote;
  reactions: FloatingReaction[];

  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  cmd: (type: string, extra?: Record<string, unknown>) => void;
  addToQueue: (trackId: string) => Promise<void>;
  voteOnQueue: (queueId: string) => Promise<void>;
  voteSkip: () => void;
  tapToPlay: () => Promise<void>;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  reloadQueue: () => Promise<void>;
  reloadTracks: () => Promise<void>;
  seekFraction: (pct: number) => void;
  loadParticipants: () => Promise<Participant[]>;
  promoteToHost: (userId: string) => Promise<void>;
  demoteHost: (userId: string) => Promise<void>;
  kickParticipant: (userId: string) => Promise<void>;
  refineMetadata: (trackId: string) => Promise<MusicBrainzRefineResult>;
}

export interface MusicBrainzRefineResult {
  matched: boolean;
  changed: string[];
  artist?: string;
  album?: string;
  year?: number | null;
  coverKey?: string | null;
  candidates?: { artist: string; title: string; album?: string; year?: number; score: number }[];
}

const REACTION_LIFETIME_MS = 2800;

const Ctx = createContext<RoomSessionAPI | null>(null);

/* ─── Tunables ────────────────────────────────────────────── */

const HARD_SEEK_SEC = 1.5;
// Below 50ms the rate tweak is inaudible AND below the noise floor of typical
// browser audio scheduling — keep playbackRate at 1.0 so the audio doesn't
// warble. Above 50ms apply adaptive rate correction.
const SOFT_RATE_SEC = 0.05;
// Soft-rate adjustment scales with the drift magnitude up to RATE_DELTA_MAX.
// Old code used a flat 0.02 (2%) and triggered only above 600ms — which left
// every drift in the 50–600ms band uncorrected and frozen in place.
const RATE_DELTA_MAX = 0.05;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const RECONNECT_MAX_ATTEMPTS = 8;

const IS_IOS = typeof navigator !== 'undefined'
  && /iPad|iPhone|iPod/.test(navigator.userAgent);

const EMPTY_SKIP: SkipVote = { votes: 0, required: 1, listeners: 1, voted: false };
const EMPTY_METRICS: Metrics = { rtt: 0, avg: 0, jitter: 0, offset: 0, drift: 0 };

/* ─── Provider ────────────────────────────────────────────── */

export function RoomSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isPrimaryHost, setIsPrimaryHost] = useState(false);
  const [primaryHostId, setPrimaryHostId] = useState<string | null>(null);
  const [hostIds, setHostIds] = useState<string[]>([]);
  const [nowTrack, setNowTrack] = useState<TrackInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [needsTap, setNeedsTap] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [skipVote, setSkipVote] = useState<SkipVote>(EMPTY_SKIP);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const reactionCounter = useRef(0);

  // Dual audio elements for gapless playback: one plays, the other prebuffers queue[0].
  // activeIsARef points at whichever is currently the playback element; the other one
  // holds the prebuffered next track and may swap roles on track change.
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeIsARef = useRef(true);
  const preloadedTrackIdRef = useRef<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const roomIdRef = useRef<string | null>(null);
  const meIdRef = useRef<string | null>(null);
  const serverOffsetRef = useRef(0);
  const rttHistoryRef = useRef<number[]>([]);
  // Spike-filtered offset samples; median of these is what serverOffsetRef holds.
  const offsetSamplesRef = useRef<number[]>([]);
  const currentTrackIdRef = useRef<string | null>(null);
  // Wall-clock ms when the current track was first loaded into the audio
  // element. driftCorrect uses this to allow a tighter hard-seek window
  // for ~3s after every track change, while decode/play startup settles.
  const trackChangeAtRef = useRef<number>(0);
  const isHostRef = useRef(false);
  const hostIdsRef = useRef<Set<string>>(new Set());

  // Playback anchor — mirrors RoomPlayback on syncplay-sync. Used to derive the
  // server-expected position at any moment without waiting for a WS message,
  // which makes `metrics.drift` a live signal instead of a stale snapshot.
  const playbackAnchorRef = useRef<{
    isPlaying: boolean;
    startAtServerTime: number; // server-time ms when playback "began" (may be future right after PLAY)
    startedPosition: number;   // track position (ms) at startAtServerTime
    pausedPosition: number;    // track position (ms) at the moment of pause
  }>({ isPlaying: false, startAtServerTime: 0, startedPosition: 0, pausedPosition: 0 });

  const applyHosts = useCallback((primary: string | null, ids: string[]) => {
    const set = new Set<string>(ids);
    if (primary) set.add(primary);
    hostIdsRef.current = set;
    setHostIds(Array.from(set));
    setPrimaryHostId(primary);
    const me = meIdRef.current;
    const host = me ? set.has(me) : false;
    isHostRef.current = host;
    setIsHost(host);
    setIsPrimaryHost(me !== null && me === primary);
  }, []);

  const activeAudio = useCallback((): HTMLAudioElement | null =>
    (activeIsARef.current ? audioARef.current : audioBRef.current),
  []);
  const inactiveAudio = useCallback((): HTMLAudioElement | null =>
    (activeIsARef.current ? audioBRef.current : audioARef.current),
  []);

  /* ─── Helpers ──────────────────────────────────────────── */

  const send = useCallback((obj: any) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(obj));
  }, []);

  const ping = useCallback(() => {
    send({ type: 'PING', clientTimestamp: Date.now() });
  }, [send]);

  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, []);

  const cmd = useCallback((type: string, extra?: Record<string, unknown>) => {
    send({ type, ...extra });
  }, [send]);

  const reloadQueue = useCallback(async () => {
    const id = roomIdRef.current;
    if (!id) return;
    try { setQueue(await api('GET', `/rooms/${id}/queue`)); } catch {}
  }, []);

  const reloadTracks = useCallback(async () => {
    try { setTracks(await api('GET', '/tracks')); } catch {}
  }, []);

  /* ─── Drift correction ─────────────────────────────────── */

  const driftCorrect = useCallback((expectedSec: number) => {
    const a = activeAudio(); if (!a) return;
    // Refuse to act on a clearly bogus target — comes from a partially
    // converged clockOffset or from a stale anchor.
    if (!isFinite(expectedSec) || expectedSec < 0) return;
    // Never seek a paused element; the user's perceived position must equal
    // what's on the progress bar when they next tap Play.
    if (a.paused) return;
    const driftSec = a.currentTime - expectedSec;
    const abs = Math.abs(driftSec);
    // Aggressive seek window right after a track change: the decode delay on
    // slow devices can leave audio behind by 500-1500ms. Use a tighter
    // threshold for ~3 seconds after the new src landed so we seek-close
    // instead of waiting for the slow rate correction to claw it back.
    const sinceTrackChange = Date.now() - trackChangeAtRef.current;
    const seekThreshold = sinceTrackChange < 3000 ? 0.3 : HARD_SEEK_SEC;
    if (abs > seekThreshold) {
      a.currentTime = expectedSec;
      a.playbackRate = 1.0;
      return;
    }
    // iOS Safari < 13 ignored playbackRate outside ~[0.95, 1.05]; modern
    // iOS (14+) honours up to 2× / 0.5×. Try the rate tweak unconditionally
    // — if iOS silently no-ops, the hard-seek branch above will still
    // catch a runaway drift. Without this, iOS audio just sat at the
    // post-seek position forever with a steady-state offset.
    if (abs > SOFT_RATE_SEC) {
      // Adaptive: bigger drift → bigger rate correction, capped at RATE_DELTA_MAX.
      // 50ms→1%, 200ms→2.5%, 600ms→5% (cap).
      const mag = Math.min(RATE_DELTA_MAX, 0.005 + (abs - SOFT_RATE_SEC) * 0.08);
      a.playbackRate = driftSec < 0 ? 1 + mag : 1 - mag;
    } else if (a.playbackRate !== 1.0) {
      // Drift back inside the dead zone — release the rate tweak now rather
      // than via a setTimeout (the old 1500ms snap-back interacted badly with
      // periodic calls and left the rate tweaked when drift was already fine).
      a.playbackRate = 1.0;
    }
  }, [activeAudio]);

  /* ─── WS message handler ───────────────────────────────────
   * Protocol: syncplay-sync (port 3002).
   *   SNAPSHOT — initial state on connect (also late-join schedule)
   *   PLAY     — scheduled start (startAtServerTime is in the near future)
   *   PAUSE    — pause at a known position
   *   SEEK     — jump to position (may keep playing)
   *   STOP     — queue exhausted
   *   QUEUE_UPDATE / CHAT / VOTE_SKIP_UPDATE / PONG / ERROR — control plane
   *
   * All PLAY-shaped messages carry { position, startAtServerTime }. We adapt them
   * to a unified PLAYBACK_UPDATE shape so the same audio-control routine handles
   * track-change, drift-correction and play/pause regardless of source message.
   */

  const applyAudio = useCallback((p: {
    state: 'PLAYING' | 'PAUSED' | 'STOPPED';
    trackId?: string | null;
    title?: string; artist?: string; durationMs?: number; coverKey?: string | null;
    hostId?: string | null;
    positionMs: number;
    timestamp: number; // server-time anchor (may be future for scheduled PLAY)
  }) => {
    let a = activeAudio(); if (!a) return;

    // Per-frame host info travels with PLAY/SNAPSHOT only as a fallback; the
    // canonical update comes from SNAPSHOT.hostIds (initial) and HOSTS_UPDATE.
    if (p.hostId && meIdRef.current && hostIdsRef.current.size === 0) {
      applyHosts(p.hostId, [p.hostId]);
    }

    if (p.state === 'STOPPED' || !p.trackId) {
      if (!a.paused) a.pause();
      a.removeAttribute('src');
      a.load();
      const other = inactiveAudio();
      if (other) {
        try { other.pause(); other.removeAttribute('src'); other.load(); } catch {}
      }
      preloadedTrackIdRef.current = null;
      currentTrackIdRef.current = null;
      playbackAnchorRef.current = { isPlaying: false, startAtServerTime: 0, startedPosition: 0, pausedPosition: 0 };
      setNowTrack(null);
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      setMetrics(pm => ({ ...pm, drift: 0 }));
      return;
    }

    const hasMeta = p.title !== undefined || p.artist !== undefined || p.durationMs !== undefined;
    if (hasMeta) {
      setNowTrack({
        id: p.trackId,
        title: p.title ?? '',
        artist: p.artist ?? '',
        durationMs: p.durationMs ?? 0,
        coverKey: p.coverKey ?? null,
      });
    }

    // Expected position: if anchor (startAtServerTime) is in the future, elapsed is 0
    // (audio should wait there); if past, extrapolate.
    const now = serverNow();
    const elapsed = p.state === 'PLAYING' ? Math.max(0, now - p.timestamp) : 0;
    const expectedSec = Math.max(0, (p.positionMs + elapsed) / 1000);

    if (p.trackId !== currentTrackIdRef.current) {
      // Gapless path: the inactive element has already buffered this track from queue[0].
      // Swap roles instead of re-fetching/re-decoding on the active element.
      const other = inactiveAudio();
      const gaplessHit =
        other !== null &&
        preloadedTrackIdRef.current === p.trackId &&
        other.readyState >= 3; // HAVE_FUTURE_DATA

      if (gaplessHit && other) {
        try { a.pause(); a.removeAttribute('src'); a.load(); } catch {}
        activeIsARef.current = !activeIsARef.current;
        preloadedTrackIdRef.current = null;
        a = other;
        try { a.currentTime = expectedSec; } catch {}
      } else {
        a.src = streamUrl(p.trackId);
        const setPos = () => {
          const cur = activeAudio();
          if (!cur) return;
          try { cur.currentTime = expectedSec; } catch {}
          cur.removeEventListener('loadedmetadata', setPos);
        };
        a.addEventListener('loadedmetadata', setPos);
      }
      currentTrackIdRef.current = p.trackId;
      trackChangeAtRef.current = Date.now();
    } else if (a.readyState >= 2) {
      driftCorrect(expectedSec);
    }

    if (p.state === 'PLAYING') {
      if (a.paused) a.play().catch((e) => { if (e?.name === 'NotAllowedError') setNeedsTap(true); });
      setPlaying(true);
      // Anchor: server's "logical" start of this segment. After this point,
      // serverExpectedMs(now) = startedPosition + (now - startAtServerTime).
      playbackAnchorRef.current = {
        isPlaying: true,
        startAtServerTime: p.timestamp,
        startedPosition: p.positionMs,
        pausedPosition: p.positionMs,
      };
    } else if (p.state === 'PAUSED') {
      if (!a.paused) a.pause();
      setPlaying(false);
      playbackAnchorRef.current = {
        ...playbackAnchorRef.current,
        isPlaying: false,
        pausedPosition: p.positionMs,
      };
    }
  }, [activeAudio, inactiveAudio, driftCorrect, serverNow, applyHosts]);

  const handleMessage = useCallback((m: any) => {
    switch (m.type) {
      case 'PONG': {
        const now = Date.now();
        const rtt = now - (m.clientTimestamp ?? now);
        if (rtt < 0 || rtt > 10000) return;
        const offset = m.serverTimestamp - (m.clientTimestamp + rtt / 2);
        rttHistoryRef.current.push(rtt);
        if (rttHistoryRef.current.length > 30) rttHistoryRef.current.shift();
        // Spike filter: a PONG with RTT much worse than the floor poisons the
        // offset estimate (offset error ≈ (rtt − rttMin) / 2). Drop those before
        // they enter the median buffer.
        const rttMin = Math.min(...rttHistoryRef.current);
        if (rtt <= rttMin * 1.5 + 50) {
          offsetSamplesRef.current.push(offset);
          if (offsetSamplesRef.current.length > 30) offsetSamplesRef.current.shift();
        }
        // Median over surviving samples is robust to the few that slip past
        // the spike filter (e.g. server-side GC pause, Wi-Fi PSM).
        if (offsetSamplesRef.current.length > 0) {
          const sorted = [...offsetSamplesRef.current].sort((a, b) => a - b);
          serverOffsetRef.current = sorted[Math.floor(sorted.length / 2)];
        } else {
          serverOffsetRef.current = offset;
        }
        const h = rttHistoryRef.current;
        const avg = Math.round(h.reduce((acc, b) => acc + b, 0) / h.length);
        const jitter = Math.max(...h) - Math.min(...h);
        setMetrics(p => ({ ...p, rtt: Math.round(rtt), avg, jitter, offset: Math.round(serverOffsetRef.current) }));
        return;
      }
      case 'QUEUE_UPDATE':
        reloadQueue();
        return;
      case 'CHAT':
        setChat(c => [...c.slice(-99), {
          user: String(m.userId ?? '?').substring(0, 6),
          text: String(m.content ?? ''),
        }]);
        return;
      case 'VOTE_SKIP_UPDATE':
        setSkipVote(prev => {
          const next: SkipVote = {
            votes: Number(m.votes ?? 0),
            required: Math.max(1, Number(m.required ?? 1)),
            listeners: Math.max(1, Number(m.listeners ?? 1)),
            voted: prev.voted,
          };
          if (m.voterId && meIdRef.current && m.voterId === meIdRef.current && typeof m.voted === 'boolean') {
            next.voted = m.voted;
          }
          if (!m.voterId && typeof m.voted === 'boolean') next.voted = m.voted;
          return next;
        });
        return;
      case 'ERROR':
        console.warn('[ws] server error:', m.message);
        return;
      case 'REACTION': {
        const emoji = String(m.emoji ?? '');
        if (!emoji) return;
        const id = `r${++reactionCounter.current}`;
        // Random horizontal offset so multiple reactions don't stack in a single column.
        const offsetPx = Math.round((Math.random() - 0.5) * 120);
        setReactions(rs => [...rs, { id, emoji, userId: String(m.userId ?? ''), offsetPx }]);
        setTimeout(() => {
          setReactions(rs => rs.filter(r => r.id !== id));
        }, REACTION_LIFETIME_MS);
        return;
      }

      case 'SNAPSHOT': {
        // The initial snapshot carries the authoritative host set (primary +
        // co-hosts). Apply it before applyAudio so per-track hostId fallback
        // does not overwrite a richer hostIds array.
        const primary = (m.primaryHostId ?? m.hostId ?? null) as string | null;
        const ids = Array.isArray(m.hostIds) && m.hostIds.length > 0
          ? (m.hostIds as string[])
          : (primary ? [primary] : []);
        if (primary || ids.length > 0) applyHosts(primary, ids);

        if (m.state === 'STOPPED' || !m.trackId) {
          applyAudio({ state: 'STOPPED', hostId: m.hostId, positionMs: 0, timestamp: serverNow() });
          return;
        }
        // SNAPSHOT.position carries a LATE_JOIN_AHEAD_MS (3s) forward-projection so
        // that late-joining clients have time to preload+decode before playback
        // catches up. For a client that is already playing this track (typical on
        // WebSocket reconnect after a brief network blip), the projection is not
        // applicable — honoring it would hard-seek us forward by ~3s and produce
        // the "hangs and resumes from another moment" symptom. Substitute our own
        // current audio position so drift ≈ 0 and the snapshot only refreshes
        // metadata and play/pause state.
        if (currentTrackIdRef.current === m.trackId) {
          const cur = activeAudio();
          applyAudio({
            state: m.state,
            trackId: m.trackId,
            title: m.title, artist: m.artist, durationMs: m.durationMs, coverKey: m.coverKey,
            hostId: m.hostId,
            positionMs: cur ? Math.round(cur.currentTime * 1000) : 0,
            timestamp: serverNow(),
          });
          return;
        }
        applyAudio({
          state: m.state,
          trackId: m.trackId,
          title: m.title, artist: m.artist, durationMs: m.durationMs, coverKey: m.coverKey,
          hostId: m.hostId,
          positionMs: m.position ?? 0,
          timestamp: m.startAtServerTime ?? serverNow(),
        });
        return;
      }
      case 'HOSTS_UPDATE': {
        const primary = (m.primaryHostId ?? null) as string | null;
        const ids = Array.isArray(m.hostIds) ? (m.hostIds as string[]) : [];
        applyHosts(primary, ids);
        return;
      }
      case 'PLAY':
        applyAudio({
          state: 'PLAYING',
          trackId: m.trackId,
          title: m.title, artist: m.artist, durationMs: m.durationMs, coverKey: m.coverKey,
          hostId: m.hostId,
          positionMs: m.position ?? 0,
          timestamp: m.startAtServerTime ?? serverNow(),
        });
        return;
      case 'PAUSE':
        applyAudio({
          state: 'PAUSED',
          trackId: currentTrackIdRef.current,
          positionMs: m.position ?? 0,
          timestamp: serverNow(),
        });
        return;
      case 'SEEK':
        applyAudio({
          state: m.isPlaying === false ? 'PAUSED' : 'PLAYING',
          trackId: currentTrackIdRef.current,
          positionMs: m.position ?? 0,
          timestamp: m.startAtServerTime ?? serverNow(),
        });
        return;
      case 'STOP':
        applyAudio({ state: 'STOPPED', positionMs: 0, timestamp: serverNow() });
        return;
      case 'KICKED':
        // Server already fires close(4001) right after this message; we just
        // record the reason so the close-handler doesn't show a generic error.
        setCloseReason(typeof m.reason === 'string' ? m.reason : 'Вас удалили из комнаты');
        return;
    }
  }, [applyAudio, reloadQueue, serverNow, applyHosts]);

  /* ─── Connect / Reconnect ──────────────────────────────── */

  const connect = useCallback(async (targetRoomId: string) => {
    let token: string;
    try {
      const r = await api<{ token: string }>('GET', '/auth/ws-token');
      token = r.token;
    } catch (err) {
      console.error('[ws] failed to obtain ws-token:', err);
      setCloseReason('Не удалось получить токен (auth)');
      return;
    }
    if (roomIdRef.current !== targetRoomId) return;

    // Base URL resolution. By default we connect to syncplay-sync on port 3002
    // of the same host. This breaks in two common cases:
    //   1) The page is served over HTTPS but the sync container speaks plain ws://
    //      — iOS Safari (and others) refuse mixed-content WebSocket upgrades.
    //   2) Direct port 3002 is unreachable from the client (firewall on macOS dev
    //      host, mobile carrier blocking non-standard ports, hosting platform
    //      that only exposes 80/443).
    // To cover both, NEXT_PUBLIC_SYNC_WS_URL can point at any absolute WS endpoint
    // (e.g. wss://example.com/sync). When set, the room path and token are
    // appended to it; otherwise we fall back to the legacy ws://host:3002 form.
    const baseFromEnv = process.env.NEXT_PUBLIC_SYNC_WS_URL?.trim();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = baseFromEnv && baseFromEnv.length > 0
      ? baseFromEnv.replace(/\/+$/, '')
      : `${proto}//${location.hostname}:3002`;
    const url = `${base}/ws/room/${targetRoomId}?token=${token}`;
    console.log('[ws] connecting to', url.replace(/token=[^&]+/, 'token=…'));
    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch (err) {
      console.error('[ws] constructor threw:', err);
      setCloseReason('WS constructor failed');
      return;
    }
    wsRef.current = ws;
    // Tracks whether onopen ever fired. If the socket closes before opening, it
    // almost always means the URL is unreachable (mixed-content blocked on iOS,
    // wrong port, firewall, no DNS). In that case we surface a specific message
    // instead of silently retrying.
    let didOpen = false;

    ws.onopen = () => {
      didOpen = true;
      if (roomIdRef.current !== targetRoomId) { ws.close(); return; }
      setConnected(true);
      setCloseReason(null);
      reconnectAttemptsRef.current = 0;
      ping();
      // 800ms steady-state cadence + a 3-second burst at 100ms on connect.
      // The burst fills the median buffer (30 samples) before the user can
      // press Play, so the first PLAY does not land on a half-baked offset.
      // The steady cadence after that keeps the median fresh against
      // background clock drift.
      let burstCount = 0;
      const burstId = window.setInterval(() => {
        ping();
        burstCount++;
        if (burstCount >= 30) window.clearInterval(burstId);
      }, 100);
      const pingId = window.setInterval(ping, 800);
      (ws as any)._pingId = pingId;
    };

    ws.onmessage = (ev) => {
      try { handleMessage(JSON.parse(ev.data)); } catch {}
    };

    ws.onclose = (ev) => {
      setConnected(false);
      const pingId = (ws as any)._pingId;
      if (pingId) clearInterval(pingId);
      const r = (ev.reason || '').toLowerCase();
      const isAuthClose =
        r.includes('no auth') || r.includes('unauth') ||
        r.includes('session') || r.includes('expired');
      if (isAuthClose) { router.replace('/login'); return; }
      if (ev.code === 1008) { setCloseReason(ev.reason || 'Closed'); return; }
      // Code 4001 = kicked by host. Suppress reconnect, surface a clear UI
      // reason, and bounce the user back to the rooms list.
      if (ev.code === 4001) {
        setCloseReason('Вас удалили из комнаты');
        roomIdRef.current = null;
        router.replace('/rooms');
        return;
      }
      if (roomIdRef.current !== targetRoomId) return; // user navigated away
      // Diagnostic: socket never opened. On iOS Safari this is the symptom of
      // mixed-content blocking (https page → ws://) or unreachable :3002.
      if (!didOpen) {
        const isHttps = location.protocol === 'https:';
        const usingPlainWs = url.startsWith('ws://');
        if (isHttps && usingPlainWs) {
          setCloseReason('Соединение заблокировано браузером: страница на HTTPS, sync на ws://. Задайте NEXT_PUBLIC_SYNC_WS_URL=wss://...');
          console.error('[ws] mixed-content: page is https but sync url is', url);
          return;
        }
        console.warn('[ws] closed before open — sync host probably unreachable:', { url, code: ev.code, reason: ev.reason });
      }
      const attempt = reconnectAttemptsRef.current;
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        setCloseReason(`Не удалось подключиться (${attempt} попыток). Обнови страницу.`);
        return;
      }
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
      reconnectAttemptsRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => connect(targetRoomId), delay);
    };

    ws.onerror = (ev) => {
      // The browser does not expose details on WebSocket errors (intentionally,
      // to prevent network fingerprinting). Log the URL we attempted so the user
      // can verify reachability and protocol.
      console.error('[ws] error event on', url.replace(/token=[^&]+/, 'token=…'), ev);
      setConnected(false);
    };
  }, [handleMessage, ping, router]);

  /* ─── joinRoom / leaveRoom ─────────────────────────────── */

  const closeCurrent = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      const pingId = (ws as any)._pingId;
      if (pingId) clearInterval(pingId);
      try { ws.close(); } catch {}
      wsRef.current = null;
    }
    for (const a of [audioARef.current, audioBRef.current]) {
      if (a) {
        try { a.pause(); a.removeAttribute('src'); a.load(); } catch {}
      }
    }
    activeIsARef.current = true;
    preloadedTrackIdRef.current = null;
    currentTrackIdRef.current = null;
    setConnected(false);
    setNowTrack(null);
    setPlaying(false);
    setProgress(0);
    setDuration(0);
    setQueue([]);
    setChat([]);
    setSkipVote(EMPTY_SKIP);
    setMetrics(EMPTY_METRICS);
    setReactions([]);
    setIsHost(false);
    setIsPrimaryHost(false);
    setPrimaryHostId(null);
    setHostIds([]);
    isHostRef.current = false;
    hostIdsRef.current = new Set();
  }, []);

  const joinRoom = useCallback(async (targetRoomId: string) => {
    if (roomIdRef.current === targetRoomId && wsRef.current) return;
    closeCurrent();
    try {
      const me = await api<{ id: string; username: string }>('GET', '/auth/me');
      meIdRef.current = me.id;
    } catch {
      router.replace('/login');
      return;
    }
    roomIdRef.current = targetRoomId;
    setRoomId(targetRoomId);
    setCloseReason(null);
    reconnectAttemptsRef.current = 0;
    await Promise.all([reloadTracks(), reloadQueue()]);
    connect(targetRoomId);
  }, [closeCurrent, connect, reloadQueue, reloadTracks, router]);

  const leaveRoom = useCallback(async () => {
    const id = roomIdRef.current;
    closeCurrent();
    roomIdRef.current = null;
    setRoomId(null);
    if (id) {
      try { await api('POST', `/rooms/${id}/leave`); } catch {}
    }
  }, [closeCurrent]);

  /* ─── Public actions ───────────────────────────────────── */

  const addToQueue = useCallback(async (trackId: string) => {
    const id = roomIdRef.current;
    if (!id) return;
    await api('POST', `/rooms/${id}/queue/${trackId}`);
    reloadQueue();
  }, [reloadQueue]);

  const voteOnQueue = useCallback(async (queueId: string) => {
    const id = roomIdRef.current;
    if (!id) return;
    try { await voteQueueItem(id, queueId); reloadQueue(); }
    catch (e) { console.warn('[vote] failed', e); }
  }, [reloadQueue]);

  const voteSkip = useCallback(() => {
    if (!nowTrack) return;
    setSkipVote(s => ({ ...s, voted: !s.voted }));
    send({ type: 'VOTE_SKIP' });
  }, [nowTrack, send]);

  const tapToPlay = useCallback(async () => {
    const a = activeAudio(); if (!a) return;
    try { await a.play(); setNeedsTap(false); } catch {}
  }, [activeAudio]);

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    send({ type: 'CHAT_MESSAGE', content: trimmed });
  }, [send]);

  const sendReaction = useCallback((emoji: string) => {
    if (!REACTION_EMOJIS.includes(emoji)) return;
    send({ type: 'REACTION', emoji });
  }, [send]);

  const loadParticipants = useCallback(async (): Promise<Participant[]> => {
    const id = roomIdRef.current;
    if (!id) return [];
    try { return await api<Participant[]>('GET', `/rooms/${id}/participants`); }
    catch { return []; }
  }, []);

  const promoteToHost = useCallback(async (userId: string) => {
    const id = roomIdRef.current;
    if (!id) return;
    await api('POST', `/rooms/${id}/cohosts/${userId}`);
    // Spring also broadcasts HOSTS_UPDATE through sync, but apply optimistically
    // so the modal UI updates instantly even when the WS broadcast is delayed.
    const next = Array.from(new Set([...hostIdsRef.current, userId]));
    applyHosts(primaryHostId, next);
  }, [applyHosts, primaryHostId]);

  const demoteHost = useCallback(async (userId: string) => {
    const id = roomIdRef.current;
    if (!id) return;
    await api('DELETE', `/rooms/${id}/cohosts/${userId}`);
    const next = Array.from(hostIdsRef.current).filter(x => x !== userId);
    applyHosts(primaryHostId, next);
  }, [applyHosts, primaryHostId]);

  const kickParticipant = useCallback(async (userId: string) => {
    const id = roomIdRef.current;
    if (!id) return;
    await api('DELETE', `/rooms/${id}/participants/${userId}`);
    // Spring fires the actual WS close via sync; the UI just optimistically
    // drops them from the cached host list (if they were a co-host) so the
    // modal feels responsive.
    if (hostIdsRef.current.has(userId)) {
      const next = Array.from(hostIdsRef.current).filter(x => x !== userId);
      applyHosts(primaryHostId, next);
    }
  }, [applyHosts, primaryHostId]);

  const refineMetadata = useCallback(async (trackId: string): Promise<MusicBrainzRefineResult> => {
    return await api<MusicBrainzRefineResult>('POST', `/tracks/${trackId}/refine-metadata`);
  }, []);

  const seekFraction = useCallback((pct: number) => {
    if (!duration) return;
    const clamped = Math.max(0, Math.min(1, pct));
    cmd('SEEK_COMMAND', { positionMs: Math.round(clamped * duration * 1000) });
  }, [cmd, duration]);

  /* ─── Audio progress ticker ────────────────────────────── */

  useEffect(() => {
    // Listeners must be attached to both elements but only update state when the
    // event fires on the currently-active one — otherwise the prebuffer element's
    // metadata/timeupdate would clobber the progress bar.
    const elems = [audioARef.current, audioBRef.current].filter((x): x is HTMLAudioElement => x !== null);
    const onTime = (e: Event) => {
      if (e.currentTarget !== activeAudio()) return;
      const a = e.currentTarget as HTMLAudioElement;
      // Progress is independent of duration availability — update unconditionally so
      // the bar advances even if a.duration is Infinity/NaN (which happens on MP3s
      // streamed without Content-Length).
      setProgress(a.currentTime);
      // Only adopt a.duration when it is a real finite positive number. Otherwise
      // we keep whatever duration was set from the track metadata (see effect below),
      // because setDuration(Infinity) freezes the bar at 0% (progress / Infinity).
      if (isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration);
      }
    };
    for (const el of elems) {
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('loadedmetadata', onTime);
    }
    return () => {
      for (const el of elems) {
        el.removeEventListener('timeupdate', onTime);
        el.removeEventListener('loadedmetadata', onTime);
      }
    };
  }, [activeAudio]);

  // Continuous drift monitor. Independent of WS message arrival — recomputes
  // the difference between audio.currentTime and the server's expected position
  // (same formula as syncplay-sync/clock.ts:getExpectedPosition) on a fixed
  // tick. Previously `metrics.drift` froze at the value captured at the last
  // PAUSE/SEEK/SNAPSHOT, which produced misleading readings (e.g. ±3000ms from
  // a stale snapshot projection, ±18000ms after a host SEEK).
  useEffect(() => {
    const id = window.setInterval(() => {
      const a = activeAudio();
      const anchor = playbackAnchorRef.current;
      if (!a || !currentTrackIdRef.current) {
        setMetrics(p => p.drift === 0 ? p : { ...p, drift: 0 });
        return;
      }
      if (a.readyState < 2) return; // ignore while still buffering
      let expectedMs: number;
      if (!anchor.isPlaying) {
        expectedMs = anchor.pausedPosition;
      } else {
        const now = serverNow();
        expectedMs = now < anchor.startAtServerTime
          ? anchor.startedPosition
          : anchor.startedPosition + (now - anchor.startAtServerTime);
      }
      // Guard against garbage values (negative offsets from a still-converging
      // clockOffset) — never seek to before-zero.
      if (expectedMs < 0) expectedMs = 0;
      const driftMs = Math.round(a.currentTime * 1000 - expectedMs);
      setMetrics(p => p.drift === driftMs ? p : { ...p, drift: driftMs });
      // Don't correct while audio is paused — autoplay-block on room entry
      // can hold us at the loaded position while expectedMs advances; if we
      // seek here, the position we present when the user finally taps Play
      // is the projected one, not the one they saw on the progress bar.
      if (a.paused) return;
      driftCorrect(expectedMs / 1000);
    }, 500);
    return () => clearInterval(id);
  }, [activeAudio, serverNow, driftCorrect]);

  // Stream-stall watchdog. The HTTP audio stream silently breaks mid-track
  // (Wi-Fi switch, proxy idle timeout, MinIO connection drop) — `<audio>`
  // freezes `currentTime` forever without firing `error`. Recovery uses the
  // inactive (B) element as warm spare: it mirrors the active stream over an
  // independent HTTP connection, and on freeze we atomic-swap A↔B with no
  // audible gap.
  useEffect(() => startSpareWatchdog({
    getActive: activeAudio,
    getSpare: inactiveAudio,
    onSwap: () => { activeIsARef.current = !activeIsARef.current; },
    // Don't clobber gapless next-track preload — skip mirror when that runs.
    isSpareBusy: () => preloadedTrackIdRef.current !== null,
  }), [activeAudio, inactiveAudio]);

  // Track metadata is the authoritative source of duration — it comes from the
  // server (jaudiotagger / Tika) at upload time and is reliable regardless of
  // how the browser sees the stream. Seed `duration` from it on every track
  // change so the bar works even before HTMLMediaElement reports a finite value.
  useEffect(() => {
    if (nowTrack?.durationMs && nowTrack.durationMs > 0) {
      setDuration(nowTrack.durationMs / 1000);
    }
  }, [nowTrack?.id, nowTrack?.durationMs]);

  /* ─── Prebuffer next track ─────────────────────────────────
   * When the current track has <= PREBUFFER_LEAD_SEC remaining, point the
   * inactive audio element at queue[0]'s stream URL so the browser warms it up.
   * applyAudio() can then swap roles for gapless playback on the next PLAY.
   */
  const PREBUFFER_LEAD_SEC = 15;
  useEffect(() => {
    if (!nowTrack || !duration) return;
    const remaining = duration - progress;
    if (remaining > PREBUFFER_LEAD_SEC || remaining < 0) return;

    const nextTrackId = queue[0]?.trackId;
    if (!nextTrackId) return;
    if (nextTrackId === currentTrackIdRef.current) return;
    if (preloadedTrackIdRef.current === nextTrackId) return;

    const other = inactiveAudio();
    if (!other) return;
    try {
      other.src = streamUrl(nextTrackId);
      other.load();
      preloadedTrackIdRef.current = nextTrackId;
    } catch {}
  }, [nowTrack, duration, progress, queue, inactiveAudio]);

  /* ─── Media Session API ───────────────────────────────────
   * Persisted at provider level → survives navigation between
   * pages. Now Playing on iOS lock screen / macOS Now Playing /
   * Bluetooth headphone buttons all work as long as the room
   * session is alive. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!nowTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  nowTrack.title || 'Без названия',
      artist: nowTrack.artist || '',
      album:  'SyncPlay',
      artwork: nowTrack.coverKey
        ? [
            { src: `/api/stream/${nowTrack.id}/cover`, sizes: '256x256', type: 'image/jpeg' },
            { src: `/api/stream/${nowTrack.id}/cover`, sizes: '512x512', type: 'image/jpeg' },
          ]
        : undefined,
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [nowTrack, playing]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const guardHost = (fn: () => void) => () => { if (isHostRef.current) fn(); };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play',          guardHost(() => send({ type: 'PLAY_COMMAND'  }))],
      ['pause',         guardHost(() => send({ type: 'PAUSE_COMMAND' }))],
      ['previoustrack', guardHost(() => send({ type: 'SKIP_COMMAND'  }))],
      ['nexttrack',     guardHost(() => send({ type: 'SKIP_COMMAND'  }))],
      ['seekto', (details) => {
        if (!isHostRef.current || typeof details.seekTime !== 'number') return;
        send({ type: 'SEEK_COMMAND', positionMs: Math.round(details.seekTime * 1000) });
      }],
    ];
    for (const [action, h] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, h); } catch {}
    }
    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
      }
    };
  }, [send]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!nowTrack || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1.0,
        position: Math.min(progress, duration),
      });
    } catch {}
  }, [nowTrack, duration, progress]);

  /* ─── Cleanup on unmount (Provider lifetime = app lifetime) ─── */

  useEffect(() => {
    return () => { closeCurrent(); };
  }, [closeCurrent]);

  const value: RoomSessionAPI = {
    roomId, connected, closeReason,
    isHost, isPrimaryHost, primaryHostId, hostIds,
    nowTrack, playing, progress, duration,
    queue, tracks, chat, needsTap, metrics, skipVote, reactions,
    joinRoom, leaveRoom, cmd, addToQueue, voteOnQueue, voteSkip,
    tapToPlay, sendChat, sendReaction, reloadQueue, reloadTracks, seekFraction,
    loadParticipants, promoteToHost, demoteHost, kickParticipant, refineMetadata,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio
        ref={audioARef}
        preload="auto"
        style={{ position: 'fixed', left: -9999, top: -9999, width: 1, height: 1 }}
      />
      <audio
        ref={audioBRef}
        preload="auto"
        style={{ position: 'fixed', left: -9999, top: -9999, width: 1, height: 1 }}
      />
    </Ctx.Provider>
  );
}

export function useRoomSession(): RoomSessionAPI {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoomSession must be used inside RoomSessionProvider');
  return v;
}
