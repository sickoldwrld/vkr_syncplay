'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, Cover, coverStyle, fmt } from '@/components/Icons';

type RoomTab = 'player' | 'queue' | 'chat';

interface Track {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  coverKey?: string | null;
}
interface QueueItem {
  id: string;
  trackId: string;
  title?: string;
  artist?: string;
  coverKey?: string | null;
}
interface ChatMessage { user: string; text: string }

interface Metrics { rtt: number; avg: number; jitter: number; offset: number }

interface Props {
  roomId: string;
  connected: boolean;
  closeReason?: string | null;
  loading: boolean;
  isHost: boolean;
  nowTrack: Track | null;
  playing: boolean;
  progressSec: number;
  durationSec: number;
  queue: QueueItem[];
  tracks: Track[];
  chat: ChatMessage[];
  chatInput: string;
  needsTap: boolean;
  metrics: Metrics;
  setChatInput: (s: string) => void;
  cmd: (type: string, extra?: Record<string, unknown>) => void;
  onAddToQueue: (trackId: string) => Promise<void> | void;
  onTapToPlay: () => Promise<void> | void;
  onSendChat: () => void;
  onLeave: () => Promise<void> | void;
}

const Eq = () => <span className="sp-eq"><span /><span /><span /><span /></span>;

export default function MobileRoom({
  roomId, connected, closeReason, loading, isHost,
  nowTrack, playing, progressSec, durationSec,
  queue, tracks, chat, chatInput, needsTap, metrics,
  setChatInput, cmd, onAddToQueue, onTapToPlay, onSendChat, onLeave,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<RoomTab>('player');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (tab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chat.length, tab]);

  function handleSeek(e: React.MouseEvent) {
    if (!durationSec) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    cmd('SEEK_COMMAND', { positionMs: Math.round(pct * durationSec * 1000) });
  }

  const remaining = Math.max(0, durationSec - progressSec);

  return (
    <div className="sp-mobile">
      {/* HEADER */}
      <div className="sp-hdr" style={{ paddingTop: 8 }}>
        <button
          className="sp-icon-btn"
          onClick={() => router.push('/')}
          aria-label="Назад"
        >
          <Icon.ChevronLeft size={18} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div className="sp-hdr-sub">{isHost ? 'You are host' : 'Listening room'}</div>
          <button
            onClick={() => closeReason && router.push('/login')}
            disabled={!closeReason}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 999,
              background: connected
                ? 'rgba(74,222,128,0.12)'
                : closeReason ? 'rgba(248,113,113,0.18)' : 'rgba(248,113,113,0.12)',
              fontSize: 11,
              color: connected ? 'oklch(0.85 0.15 140)' : 'oklch(0.75 0.2 30)',
              border: `1px solid ${connected ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.35)'}`,
              marginTop: 4,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 500,
              cursor: closeReason ? 'pointer' : 'default',
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: connected ? 'oklch(0.75 0.18 140)' : 'oklch(0.65 0.2 30)',
            }} />
            {connected
              ? 'Подключено'
              : closeReason
                ? `${closeReason} · войти заново →`
                : 'Подключаемся…'}
          </button>
        </div>
        <button
          className="sp-icon-btn"
          onClick={onLeave}
          aria-label="Покинуть"
          style={{ color: 'oklch(0.85 0.2 30)' }}
        >
          <Icon.Logout size={16} />
        </button>
      </div>

      {/* CONTENT */}
      {tab === 'player' && (
        <NowTab
          nowTrack={nowTrack}
          playing={playing}
          progressSec={progressSec}
          durationSec={durationSec}
          remaining={remaining}
          isHost={isHost}
          needsTap={needsTap}
          loading={loading}
          metrics={metrics}
          onSeek={handleSeek}
          onTapToPlay={onTapToPlay}
          cmd={cmd}
        />
      )}

      {tab === 'queue' && (
        <QueueTab
          queue={queue}
          tracks={tracks}
          isHost={isHost}
          onAddToQueue={onAddToQueue}
          cmd={cmd}
        />
      )}

      {tab === 'chat' && (
        <ChatTab
          chat={chat}
          chatInput={chatInput}
          setChatInput={setChatInput}
          onSendChat={onSendChat}
          scrollRef={chatScrollRef}
        />
      )}

      {/* Mini player — visible on Queue/Chat tabs, hidden on Player tab */}
      {tab !== 'player' && nowTrack && (
        <div className="sp-mini" onClick={() => setTab('player')}>
          <div className="sp-mini-cov" style={coverStyle(nowTrack.id)} />
          <div className="sp-mini-meta">
            <div className="sp-mini-title">{nowTrack.title}</div>
            <div className="sp-mini-artist">{nowTrack.artist || '—'}</div>
          </div>
          {playing && <Eq />}
          <button
            className="sp-mini-play"
            onClick={e => {
              e.stopPropagation();
              if (isHost) cmd(playing ? 'PAUSE_COMMAND' : 'PLAY_COMMAND');
            }}
            disabled={!isHost}
            style={!isHost ? { opacity: 0.4 } : undefined}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Icon.Pause size={16} /> : <Icon.Play size={16} />}
          </button>
          <div
            className="sp-mini-prog"
            style={{ ['--prog' as any]: durationSec > 0 ? `${Math.min(100, (progressSec / durationSec) * 100)}%` : '0%' }}
          />
        </div>
      )}

      {/* Bottom TabBar */}
      <div className="sp-tabs">
        <button
          className={'sp-tab ' + (tab === 'player' ? 'active' : '')}
          onClick={() => setTab('player')}
        >
          <span className="sp-tab-icon"><Icon.Play size={20} /></span>
          <span className="sp-tab-label">Player</span>
        </button>
        <button
          className={'sp-tab ' + (tab === 'queue' ? 'active' : '')}
          onClick={() => setTab('queue')}
        >
          <span className="sp-tab-icon" style={{ position: 'relative' }}>
            <Icon.Queue size={20} />
            {queue.length > 0 && <CountBadge n={queue.length} />}
          </span>
          <span className="sp-tab-label">Queue</span>
        </button>
        <button
          className={'sp-tab ' + (tab === 'chat' ? 'active' : '')}
          onClick={() => setTab('chat')}
        >
          <span className="sp-tab-icon" style={{ position: 'relative' }}>
            <Icon.Chat size={20} />
            {chat.length > 0 && <CountBadge n={chat.length} />}
          </span>
          <span className="sp-tab-label">Chat</span>
        </button>
      </div>
    </div>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span style={{
      position: 'absolute',
      top: -4, right: -8,
      minWidth: 16, height: 16, borderRadius: 999,
      background: 'var(--accent)',
      color: '#1a0f2e',
      fontSize: 10, fontWeight: 700,
      fontFamily: "'Space Grotesk', sans-serif",
      padding: '0 4px',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1,
      border: '2px solid oklch(0.1 0.04 280)',
      boxSizing: 'border-box',
    }}>{n > 99 ? '99+' : n}</span>
  );
}

/* ─── NOW PLAYING TAB ─── */
function NowTab({
  nowTrack, playing, progressSec, durationSec, remaining,
  isHost, needsTap, loading, metrics,
  onSeek, onTapToPlay, cmd,
}: {
  nowTrack: Track | null;
  playing: boolean;
  progressSec: number;
  durationSec: number;
  remaining: number;
  isHost: boolean;
  needsTap: boolean;
  loading: boolean;
  metrics: Metrics;
  onSeek: (e: React.MouseEvent) => void;
  onTapToPlay: () => Promise<void> | void;
  cmd: (type: string, extra?: Record<string, unknown>) => void;
}) {
  return (
    <div className="sp-scroll" style={{ paddingTop: 4 }}>
      {/* Cover */}
      <div
        className="sp-np-cov-wrap"
        style={nowTrack ? coverStyle(nowTrack.id) : { background: 'var(--glass)' }}
      />

      {/* Title + artist */}
      <div className="sp-np-title-row" style={{ marginTop: 4 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sp-np-title">{nowTrack?.title || '—'}</div>
          <div className="sp-np-artist">{nowTrack?.artist || (nowTrack ? '' : 'В очереди ничего нет')}</div>
        </div>
      </div>

      {/* Progress */}
      <div className="sp-np-prog">
        <div className="sp-np-bar" onClick={onSeek} style={{ cursor: isHost && durationSec > 0 ? 'pointer' : 'default' }}>
          <div
            className="sp-np-fill"
            style={{ width: durationSec > 0 ? `${(progressSec / durationSec) * 100}%` : '0%' }}
          >
            <div className="sp-np-thumb" />
          </div>
        </div>
        <div className="sp-np-times">
          <span>{fmt(progressSec)}</span>
          <span>-{fmt(remaining)}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="sp-np-transport" style={{ opacity: isHost ? 1 : 0.4 }}>
        <button
          className="sp-np-tbtn muted"
          onClick={() => cmd('SKIP_COMMAND')}
          disabled={!isHost}
          aria-label="Previous"
        >
          <Icon.Prev size={28} />
        </button>
        <button
          className="sp-np-play"
          onClick={() => cmd(playing ? 'PAUSE_COMMAND' : 'PLAY_COMMAND')}
          disabled={!isHost}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Icon.Pause size={26} /> : <Icon.Play size={26} />}
        </button>
        <button
          className="sp-np-tbtn muted"
          onClick={() => cmd('SKIP_COMMAND')}
          disabled={!isHost}
          aria-label="Next"
        >
          <Icon.Next size={28} />
        </button>
      </div>

      {!isHost && (
        <div style={{
          textAlign: 'center', marginTop: 14,
          fontSize: 11, color: 'var(--ink-faint)',
          fontFamily: "'Space Grotesk', sans-serif",
        }}>
          Управление доступно только хосту
        </div>
      )}

      {needsTap && (
        <button
          onClick={onTapToPlay}
          style={{
            marginTop: 18, width: '100%', padding: '14px 0',
            background: 'var(--accent-soft)', color: '#1a0f2e',
            border: 'none', borderRadius: 16, fontSize: 15, fontWeight: 700,
            fontFamily: "'Space Grotesk', sans-serif",
            cursor: 'pointer',
            boxShadow: '0 8px 24px -6px var(--accent)',
          }}
        >
          ▶ Нажми для воспроизведения
        </button>
      )}

      {/* Metrics (compact, secondary) */}
      <div style={{
        marginTop: 18,
        padding: '8px 12px',
        borderRadius: 12,
        background: 'var(--glass)',
        border: '1px solid var(--glass-border)',
        fontSize: 10.5,
        color: 'var(--ink-faint)',
        fontFamily: "'Space Grotesk', sans-serif",
        display: 'flex', justifyContent: 'space-between', gap: 8,
        flexWrap: 'wrap',
      }}>
        <span>RTT <strong style={{ color: 'oklch(0.85 0.15 140)', fontWeight: 600 }}>{metrics.rtt}ms</strong></span>
        <span>Avg {metrics.avg}ms</span>
        <span style={{ color: metrics.jitter > 40 ? 'oklch(0.7 0.2 30)' : 'inherit' }}>
          IQR {metrics.jitter}ms
        </span>
        <span>Δ {metrics.offset}ms</span>
        {loading && <span style={{ color: 'var(--ink-dim)' }}>load…</span>}
      </div>
    </div>
  );
}

/* ─── QUEUE TAB ─── */
function QueueTab({
  queue, tracks, isHost, onAddToQueue, cmd,
}: {
  queue: QueueItem[];
  tracks: Track[];
  isHost: boolean;
  onAddToQueue: (trackId: string) => Promise<void> | void;
  cmd: (type: string, extra?: Record<string, unknown>) => void;
}) {
  const [filter, setFilter] = useState('');
  const filtered = filter.trim()
    ? tracks.filter(t => ((t.title || '') + (t.artist || '')).toLowerCase().includes(filter.toLowerCase()))
    : tracks;

  return (
    <div className="sp-scroll" style={{ paddingTop: 4 }}>
      <div className="sp-sec-title">
        <h3>В очереди</h3>
        {isHost && queue.length > 0 && (
          <button
            className="sp-see"
            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--ink-faint)' }}
            onClick={() => cmd('SKIP_COMMAND')}
          >Skip current →</button>
        )}
      </div>
      {queue.length === 0 ? (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: 'var(--ink-faint)',
          fontSize: 13,
          borderRadius: 16,
          background: 'var(--glass)',
          border: '1px dashed var(--glass-border)',
        }}>
          Очередь пуста — добавь треки ниже
        </div>
      ) : (
        queue.map((q, i) => (
          <div key={q.id || i} className="sp-friend" style={{ padding: 10, marginBottom: 8 }}>
            <div className="sp-f-track" style={{ padding: 0, background: 'transparent' }}>
              <div style={{
                width: 20, textAlign: 'center', flexShrink: 0,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 12, color: 'var(--ink-faint)',
              }}>{i + 1}</div>
              <Cover trackId={q.trackId} coverKey={q.coverKey} size={40} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sp-f-title">{q.title || 'Трек'}</div>
                <div className="sp-f-artist">{q.artist || '—'}</div>
              </div>
            </div>
          </div>
        ))
      )}

      <div className="sp-sec-title">
        <h3>Добавить трек</h3>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--glass)', border: '1px solid var(--glass-border)',
          padding: '10px 14px', borderRadius: 999,
        }}>
          <Icon.Search size={14} />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Найти трек…"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--ink)', fontSize: 13, flex: 1, fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {filtered.slice(0, 40).map(t => (
        <div
          key={t.id}
          onClick={() => onAddToQueue(t.id)}
          className="sp-friend"
          style={{ padding: 10, marginBottom: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <Cover trackId={t.id} coverKey={t.coverKey} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sp-f-title">{t.title}</div>
            <div className="sp-f-artist">{t.artist || '—'}</div>
          </div>
          <div style={{
            width: 32, height: 32, borderRadius: 12,
            background: 'var(--glass-strong)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)', flexShrink: 0,
          }}>
            <Icon.Plus size={16} />
          </div>
        </div>
      ))}
      {filtered.length === 0 && filter.trim() && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 20, fontSize: 13 }}>
          Ничего не найдено
        </div>
      )}
    </div>
  );
}

/* ─── CHAT TAB ─── */
function ChatTab({
  chat, chatInput, setChatInput, onSendChat, scrollRef,
}: {
  chat: ChatMessage[];
  chatInput: string;
  setChatInput: (s: string) => void;
  onSendChat: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 18px' }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0 12px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}
      >
        {chat.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'var(--ink-faint)',
            fontSize: 13,
            padding: 40,
          }}>
            Здесь будут сообщения. Напиши первым 👋
          </div>
        ) : chat.map((m, i) => (
          <div key={i} style={{
            padding: '8px 12px',
            borderRadius: 12,
            background: 'var(--glass)',
            border: '1px solid var(--glass-border)',
            fontSize: 13,
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            alignSelf: 'flex-start',
            maxWidth: '85%',
          }}>
            <div style={{
              fontSize: 10.5,
              color: 'var(--accent)',
              fontWeight: 600,
              fontFamily: "'Space Grotesk', sans-serif",
              marginBottom: 2,
              letterSpacing: '0.02em',
            }}>{m.user}</div>
            <div>{m.text}</div>
          </div>
        ))}
      </div>

      {/* Input pinned above the TabBar (~90px) + safe area */}
      <div style={{
        padding: '10px 0 calc(100px + env(safe-area-inset-bottom))',
        display: 'flex',
        gap: 8,
        background: 'transparent',
      }}>
        <input
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSendChat()}
          placeholder="Сообщение…"
          style={{
            flex: 1, padding: '12px 16px', borderRadius: 999,
            background: 'var(--glass)', border: '1px solid var(--glass-border)',
            color: 'var(--ink)', fontSize: 14, outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={onSendChat}
          disabled={!chatInput.trim()}
          style={{
            width: 44, height: 44, borderRadius: 999,
            background: chatInput.trim() ? 'var(--accent-soft)' : 'var(--glass)',
            color: '#1a0f2e',
            border: 'none', cursor: chatInput.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 16,
            flexShrink: 0,
          }}
          aria-label="Отправить"
        >↑</button>
      </div>
    </div>
  );
}
