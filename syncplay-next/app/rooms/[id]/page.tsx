'use client';
import { useEffect, useRef, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { api, streamUrl } from '@/lib/api';
import { Icon, Cover, fmt } from '@/components/Icons';
import MobileRoom from '@/components/mobile/MobileRoom';
import { useIsMobile } from '@/components/mobile/useIsMobile';
import Link from 'next/link';

interface Props { params: Promise<{ id: string }>; }

interface TrackInfo {
  id: string; title: string; artist: string;
  durationMs: number; coverKey?: string | null;
}

/**
 * Drift-correction tunables. Generous thresholds beat tight ones — humans don't
 * notice 200-500ms of audio offset, but they DO notice pitch-shift artefacts
 * from playbackRate tweaks (especially nasty on iOS Safari's plain <audio>).
 *  - HARD_SEEK_SEC: only resync this badly drifted (network gap, tab throttle)
 *  - SOFT_RATE_SEC: window where we *might* rate-adjust on non-iOS
 *  - RATE_DELTA: pitch shift amount (smaller = less audible)
 */
const HARD_SEEK_SEC = 1.5;
const SOFT_RATE_SEC = 0.6;
const RATE_DELTA = 0.02;
const RECONNECT_MS = 2000;

// iOS Safari handles playbackRate poorly — audible dropouts. Skip soft adjust there.
const IS_IOS = typeof navigator !== 'undefined'
  && /iPad|iPhone|iPod/.test(navigator.userAgent);

export default function RoomPage({ params }: Props) {
  const { id: roomId } = use(params);
  const router = useRouter();

  const [authed, setAuthed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [nowTrack, setNowTrack] = useState<TrackInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const [queue, setQueue] = useState<any[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [chat, setChat] = useState<{ user: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [metrics, setMetrics] = useState({ rtt: 0, avg: 0, jitter: 0, offset: 0 });

  const audioRef = useRef<HTMLAudioElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);
  const meIdRef = useRef<string | null>(null);
  const serverOffsetRef = useRef(0); // serverTime ≈ Date.now() + serverOffset
  const rttHistoryRef = useRef<number[]>([]);
  const currentTrackIdRef = useRef<string | null>(null);
  const lastUpdateRef = useRef<{ positionMs: number; timestamp: number; state: string } | null>(null);
  const isHostRef = useRef(false);

  // Auth + initial load + connect
  useEffect(() => {
    // Reset on each mount — Strict Mode re-runs effects and refs persist across runs,
    // so without this the second mount sees destroyedRef=true from the first cleanup
    // and connect() bails out before opening the WS.
    destroyedRef.current = false;

    (async () => {
      try {
        const me = await api<{ id: string; username: string }>('GET', '/auth/me');
        meIdRef.current = me.id;
        setAuthed(true);
        await Promise.all([loadTracks(), loadQueue()]);
        connect();
      } catch {
        router.replace('/login');
      }
    })();
    return () => {
      destroyedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Progress ticker — drives the seek bar
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const onTime = () => {
      if (!isNaN(a.duration)) {
        setProgress(a.currentTime);
        setDuration(a.duration);
      }
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onTime);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onTime);
    };
  }, []);

  async function connect() {
    if (destroyedRef.current) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    console.log('[ws] connect() start, fetching ws-token via REST');

    let token: string | null = null;
    try {
      const r = await api<{ token: string }>('GET', '/auth/ws-token');
      token = r.token;
      console.log('[ws] got token, opening WS');
    } catch (e) {
      console.warn('[ws] ws-token failed — likely auth redirect:', e);
      return;
    }
    if (destroyedRef.current) return;

    const url = `${proto}//${location.hostname}:8080/ws/room/${roomId}?token=${token}`;
    console.log('[ws] opening', url.replace(/token=[^&]+/, 'token=...'));
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[ws] WebSocket constructor threw:', err);
      setCloseReason('WS constructor failed');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (destroyedRef.current) { ws.close(); return; }
      setConnected(true);
      setCloseReason(null);
      // Send a few PINGs to bootstrap clock offset estimate
      ping();
      const pingId = window.setInterval(ping, 4000);
      (ws as any)._pingId = pingId;
    };

    ws.onmessage = (ev) => {
      try { handleMessage(JSON.parse(ev.data)); } catch {}
    };

    ws.onclose = (ev) => {
      setConnected(false);
      const pingId = (ws as any)._pingId;
      if (pingId) clearInterval(pingId);
      console.warn(`[ws] closed code=${ev.code} reason="${ev.reason}"`);
      const r = (ev.reason || '').toLowerCase();
      const isAuthClose =
        r.includes('no auth') || r.includes('unauth') ||
        r.includes('session') || r.includes('expired');
      // Auth-related close (any code): bounce to /login, do NOT reconnect
      if (isAuthClose) {
        router.replace('/login');
        return;
      }
      // Other 1008 (e.g., "Room not found"): show reason, no reconnect
      if (ev.code === 1008) {
        setCloseReason(ev.reason || 'Closed');
        return;
      }
      if (!destroyedRef.current) {
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_MS);
      }
    };

    ws.onerror = (ev) => {
      console.error('[ws] onerror', ev);
      setConnected(false);
    };
  }

  function send(obj: any) {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }

  function ping() { send({ type: 'PING', clientTimestamp: Date.now() }); }

  function cmd(type: string, extra?: Record<string, unknown>) {
    send({ type, ...extra });
  }

  function serverNow(): number { return Date.now() + serverOffsetRef.current; }

  function handleMessage(m: any) {
    switch (m.type) {
      case 'PONG': {
        const now = Date.now();
        const rtt = now - (m.clientTimestamp ?? now);
        if (rtt < 0 || rtt > 10000) return;
        // NTP-ish: server time at the midpoint of round-trip
        const offset = (m.serverTimestamp - (m.clientTimestamp + rtt / 2));
        serverOffsetRef.current = offset;
        rttHistoryRef.current.push(rtt);
        if (rttHistoryRef.current.length > 20) rttHistoryRef.current.shift();
        const h = rttHistoryRef.current;
        const avg = Math.round(h.reduce((a, b) => a + b, 0) / h.length);
        const jitter = Math.max(...h) - Math.min(...h);
        setMetrics({ rtt: Math.round(rtt), avg, jitter, offset: Math.round(offset) });
        break;
      }
      case 'PLAYBACK_UPDATE':
      case 'SERVER_TICK':
        applyPlayback(m);
        break;
      case 'QUEUE_UPDATE':
        loadQueue();
        break;
      case 'CHAT':
        setChat(c => [...c.slice(-99), {
          user: String(m.userId ?? '?').substring(0, 6),
          text: String(m.content ?? ''),
        }]);
        break;
      case 'PARTICIPANT_UPDATE':
        // ignore for now
        break;
      case 'ERROR':
        console.warn('[ws] server error:', m.message);
        break;
    }
  }

  function driftCorrect(a: HTMLAudioElement, expectedSec: number) {
    const drift = a.currentTime - expectedSec;
    const absDrift = Math.abs(drift);
    if (absDrift > HARD_SEEK_SEC) {
      // Last resort: big network gap or tab throttling — accept the audible jump
      a.currentTime = expectedSec;
      a.playbackRate = 1.0;
      return;
    }
    // iOS Safari: pitch-shift artefacts are worse than a few hundred ms of drift.
    // Just let it be — the next track change resyncs naturally.
    if (IS_IOS) return;
    if (absDrift > SOFT_RATE_SEC) {
      a.playbackRate = drift < 0 ? 1 + RATE_DELTA : 1 - RATE_DELTA;
      setTimeout(() => { if (audioRef.current) audioRef.current.playbackRate = 1.0; }, 1500);
    }
  }

  function applyPlayback(m: any) {
    const a = audioRef.current; if (!a) return;

    // Host detection on every message with hostId
    if (m.hostId && meIdRef.current) {
      const host = m.hostId === meIdRef.current;
      isHostRef.current = host;
      setIsHost(host);
    }

    // SERVER_TICK: lightweight periodic position sync — drift correction only
    if (m.type === 'SERVER_TICK') {
      if (!currentTrackIdRef.current || a.paused || a.readyState < 2) return;
      const now = serverNow();
      const elapsed = Math.max(0, now - (m.timestamp ?? now));
      const expectedSec = (m.positionMs + elapsed) / 1000;
      driftCorrect(a, expectedSec);
      return;
    }

    // PLAYBACK_UPDATE: authoritative state change (play/pause/seek/skip)
    const state = m.state;
    if (!state) return;

    // Nothing playing
    if (state === 'STOPPED' || !m.trackId) {
      if (!a.paused) a.pause();
      a.removeAttribute('src');
      a.load();
      currentTrackIdRef.current = null;
      lastUpdateRef.current = null;
      setNowTrack(null);
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      return;
    }

    // Track meta
    setNowTrack({
      id: m.trackId,
      title: m.title ?? '',
      artist: m.artist ?? '',
      durationMs: m.durationMs ?? 0,
      coverKey: m.coverKey ?? null,
    });
    lastUpdateRef.current = { positionMs: m.positionMs ?? 0, timestamp: m.timestamp ?? Date.now(), state };

    // Compute expected current position
    const now = serverNow();
    const elapsed = state === 'PLAYING' ? Math.max(0, now - (m.timestamp ?? now)) : 0;
    const expectedSec = Math.max(0, ((m.positionMs ?? 0) + elapsed) / 1000);

    // Track change: swap src, seek after metadata loads
    if (m.trackId !== currentTrackIdRef.current) {
      currentTrackIdRef.current = m.trackId;
      a.src = streamUrl(m.trackId);
      const setPos = () => {
        try { a.currentTime = expectedSec; } catch {}
        a.removeEventListener('loadedmetadata', setPos);
      };
      a.addEventListener('loadedmetadata', setPos);
    } else if (a.readyState >= 2) {
      // Same track — drift-correct
      driftCorrect(a, expectedSec);
    }

    // Play/pause
    if (state === 'PLAYING') {
      if (a.paused) {
        a.play().catch((e) => { if (e?.name === 'NotAllowedError') setNeedsTap(true); });
      }
      setPlaying(true);
    } else if (state === 'PAUSED') {
      if (!a.paused) a.pause();
      setPlaying(false);
    }
  }

  async function loadQueue() {
    try { setQueue(await api('GET', `/rooms/${roomId}/queue`)); } catch {}
  }
  async function loadTracks() {
    try { setTracks(await api('GET', '/tracks')); } catch {}
  }

  async function addToQueue(trackId: string) {
    await api('POST', `/rooms/${roomId}/queue/${trackId}`);
    loadQueue();
  }

  async function tapToPlay() {
    const a = audioRef.current; if (!a) return;
    try { await a.play(); setNeedsTap(false); } catch {}
  }

  function seekBar(e: React.MouseEvent) {
    if (!duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    cmd('SEEK_COMMAND', { positionMs: Math.round(pct * duration * 1000) });
  }

  async function leave() {
    try { await api('POST', `/rooms/${roomId}/leave`); } catch {}
    router.push('/');
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    send({ type: 'CHAT_MESSAGE', content: chatInput.trim() });
    setChatInput('');
  }

  if (!authed) return null;

  return (
    <RoomShell
      roomId={roomId}
      connected={connected}
      closeReason={closeReason}
      loading={false}
      isHost={isHost}
      nowTrack={nowTrack}
      playing={playing}
      progress={progress}
      duration={duration}
      queue={queue}
      tracks={tracks}
      chat={chat}
      chatInput={chatInput}
      needsTap={needsTap}
      metrics={metrics}
      setChatInput={setChatInput}
      cmd={cmd}
      addToQueue={addToQueue}
      tapToPlay={tapToPlay}
      sendChat={sendChat}
      leave={leave}
      seekBar={seekBar}
      audioRef={audioRef}
    />
  );
}

function RoomShell(props: any) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <>
        <MobileRoom
          roomId={props.roomId}
          connected={props.connected}
          closeReason={props.closeReason}
          loading={props.loading}
          isHost={props.isHost}
          nowTrack={props.nowTrack}
          playing={props.playing}
          progressSec={props.progress}
          durationSec={props.duration}
          queue={props.queue}
          tracks={props.tracks}
          chat={props.chat}
          chatInput={props.chatInput}
          needsTap={props.needsTap}
          metrics={props.metrics}
          setChatInput={props.setChatInput}
          cmd={props.cmd}
          onAddToQueue={props.addToQueue}
          onTapToPlay={props.tapToPlay}
          onSendChat={props.sendChat}
          onLeave={props.leave}
        />
        <audio ref={props.audioRef} preload="auto" />
      </>
    );
  }
  return <DesktopRoom {...props} />;
}

function DesktopRoom({
  roomId, connected, closeReason, loading, isHost,
  nowTrack, playing, progress, duration,
  queue, tracks, chat, chatInput, needsTap, metrics,
  setChatInput, cmd, addToQueue, tapToPlay, sendChat, leave, seekBar, audioRef,
}: any) {
  return (
    <div className="app" style={{ overflowY: 'auto' }}>
      <div style={{ position: 'relative', zIndex: 10, padding: '16px 20px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Link href="/" style={{ color: 'var(--ink-dim)', textDecoration: 'none', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon.ChevronLeft size={14} /> На главную
          </Link>

          <div style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: connected ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
            fontSize: 11,
            color: connected ? 'oklch(0.85 0.15 140)' : 'oklch(0.75 0.2 30)',
            border: `1px solid ${connected ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? 'oklch(0.75 0.18 140)' : 'oklch(0.65 0.2 30)',
            }} />
            {connected ? 'Подключено' : closeReason ? `Ошибка: ${closeReason}` : 'Подключаемся…'}
          </div>

          <button onClick={leave} className="pill" style={{ color: 'oklch(0.85 0.2 30)' }}>Покинуть</button>
        </div>

        <div className="glass metrics-bar" style={{ marginBottom: 16, borderRadius: 12, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          RTT: <span style={{ color: 'oklch(0.85 0.15 140)' }}>{metrics.rtt}ms</span>
          {' · '}Avg: {metrics.avg}ms
          {' · '}Jitter: <span style={{ color: metrics.jitter > 40 ? 'oklch(0.7 0.2 30)' : 'inherit' }}>{metrics.jitter}ms</span>
          {' · '}Offset: {metrics.offset}ms
        </div>

        <div className="glass" style={{ padding: 28, marginBottom: 16, borderRadius: 16, textAlign: 'center' }}>
          {nowTrack
            ? <Cover trackId={nowTrack.id} coverKey={nowTrack.coverKey} size={120} className="mx-auto mb-3.5" />
            : <div style={{ width: 120, height: 120, margin: '0 auto 14px', borderRadius: 14, background: 'var(--glass)' }} />}
          <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>{nowTrack?.title || '—'}</div>
          <div style={{ fontSize: 14, color: 'var(--ink-dim)', marginBottom: 18 }}>{nowTrack?.artist || ''}</div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, alignItems: 'center', marginBottom: 14, opacity: isHost ? 1 : 0.4 }}>
            <button onClick={() => cmd('SKIP_COMMAND')} className="icon-btn" disabled={!isHost}><Icon.Prev /></button>
            <button
              onClick={() => cmd(playing ? 'PAUSE_COMMAND' : 'PLAY_COMMAND')}
              className="play-btn" disabled={!isHost}>
              {playing ? <Icon.Pause size={20} /> : <Icon.Play size={20} />}
            </button>
            <button onClick={() => cmd('SKIP_COMMAND')} className="icon-btn" disabled={!isHost}><Icon.Next /></button>
          </div>

          {!isHost && <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10 }}>Управление доступно только хосту</div>}

          <div onClick={isHost ? seekBar : undefined} className="progress" style={{ marginBottom: 6, cursor: isHost ? 'pointer' : 'default' }}>
            <div className="progress-fill" style={{ width: `${duration ? (progress / duration * 100) : 0}%` }}>
              <div className="progress-thumb" />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-faint)' }}>
            <span>{fmt(progress)}</span><span>{fmt(duration)}</span>
          </div>

          {needsTap && (
            <button onClick={tapToPlay} style={{
              marginTop: 14, width: '100%', padding: '12px 0',
              background: 'oklch(0.55 0.2 265)', color: '#fff',
              border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>Нажмите для воспроизведения</button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }} className="room-grid">
          <div className="glass" style={{ padding: 16, borderRadius: 16 }}>
            <h3 style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Очередь</h3>
            {queue.length === 0
              ? <div style={{ padding: 12, color: 'var(--ink-faint)', fontSize: 12, textAlign: 'center' }}>Пусто</div>
              : queue.map((q: any, i: number) => (
                <div key={q.id || i} style={{ padding: '6px 8px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ width: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>{i + 1}</span>
                  <Cover trackId={q.trackId} coverKey={q.coverKey} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.title || 'Трек'}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{q.artist || ''}</div>
                  </div>
                </div>
              ))}
          </div>

          <div className="glass" style={{ padding: 16, borderRadius: 16, maxHeight: 350, overflow: 'auto' }}>
            <h3 style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1, position: 'sticky', top: 0, background: 'rgba(0,0,0,0.3)', padding: '4px 0' }}>Добавить в очередь</h3>
            {tracks.map((t: any) => (
              <div key={t.id} onClick={() => addToQueue(t.id)} style={{ padding: '6px 8px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', borderRadius: 6 }}>
                <span style={{ width: 20, textAlign: 'center', color: 'var(--accent)' }}>+</span>
                <Cover trackId={t.id} coverKey={t.coverKey} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t.artist || ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass" style={{ padding: 16, borderRadius: 16 }}>
          <h3 style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Чат</h3>
          <div style={{ maxHeight: 180, overflow: 'auto', marginBottom: 10 }}>
            {chat.map((m: any, i: number) => (
              <div key={i} style={{ fontSize: 13, padding: '3px 0' }}>
                <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{m.user}: </span>
                <span>{m.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="Сообщение..."
              style={{ flex: 1, padding: '10px 16px', borderRadius: 999, background: 'var(--glass)', border: '1px solid var(--glass-border)', color: 'var(--ink)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={sendChat} className="play-btn" style={{ padding: '8px 16px', borderRadius: 999, width: 'auto', height: 'auto', background: 'var(--accent)', color: '#1a0030', fontWeight: 500, fontSize: 12 }}>↑</button>
          </div>
        </div>
      </div>

      <audio ref={audioRef} preload="auto" />

      <style jsx>{`
        @media (max-width: 700px) {
          :global(.room-grid) { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
