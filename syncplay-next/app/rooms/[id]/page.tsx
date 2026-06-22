'use client';
import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRoomSession } from '@/lib/roomSession';
import { Icon, Cover, fmt } from '@/components/Icons';
import MobileRoom from '@/components/mobile/MobileRoom';
import { useIsMobile } from '@/components/mobile/useIsMobile';
import VoteSkipBar from '@/components/VoteSkipBar';
import DriftMetricsBar from '@/components/DriftIndicator';
import ReactionLayer from '@/components/ReactionLayer';
import ReactionPicker from '@/components/ReactionPicker';
import HostsManagerModal from '@/components/HostsManagerModal';

interface Props { params: Promise<{ id: string }>; }

export default function RoomPage({ params }: Props) {
  const { id: roomId } = use(params);
  const router = useRouter();
  const s = useRoomSession();
  const [authed, setAuthed] = useState(false);
  const [chatInput, setChatInput] = useState('');

  useEffect(() => {
    (async () => {
      try {
        await api('GET', '/auth/me');
        setAuthed(true);
        await s.joinRoom(roomId);
      } catch {
        router.replace('/login');
      }
    })();
    // The session lives in the layout-level provider; we do not leave the room
    // on unmount so audio keeps playing while user navigates other pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function leave() {
    await s.leaveRoom();
    router.push('/');
  }

  function onSendChat() {
    if (!chatInput.trim()) return;
    s.sendChat(chatInput);
    setChatInput('');
  }

  function seekBar(e: React.MouseEvent) {
    if (!s.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    s.seekFraction((e.clientX - r.left) / r.width);
  }

  if (!authed) return null;

  return (
    <RoomShell
      roomId={roomId}
      session={s}
      chatInput={chatInput}
      setChatInput={setChatInput}
      onSendChat={onSendChat}
      onLeave={leave}
      onSeekBar={seekBar}
    />
  );
}

function RoomShell({ roomId, session, chatInput, setChatInput, onSendChat, onLeave, onSeekBar }: any) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <MobileRoom
        roomId={roomId}
        connected={session.connected}
        closeReason={session.closeReason}
        loading={false}
        isHost={session.isHost}
        nowTrack={session.nowTrack}
        playing={session.playing}
        progressSec={session.progress}
        durationSec={session.duration}
        queue={session.queue}
        tracks={session.tracks}
        chat={session.chat}
        chatInput={chatInput}
        needsTap={session.needsTap}
        metrics={session.metrics}
        skipVote={session.skipVote}
        setChatInput={setChatInput}
        cmd={session.cmd}
        onAddToQueue={session.addToQueue}
        onVote={session.voteOnQueue}
        onVoteSkip={session.voteSkip}
        onTapToPlay={session.tapToPlay}
        onSendChat={onSendChat}
        onLeave={onLeave}
      />
    );
  }
  return (
    <DesktopRoom
      session={session}
      chatInput={chatInput}
      setChatInput={setChatInput}
      onSendChat={onSendChat}
      onLeave={onLeave}
      onSeekBar={onSeekBar}
    />
  );
}

function DesktopRoom({ session: s, chatInput, setChatInput, onSendChat, onLeave, onSeekBar }: any) {
  const [hostsOpen, setHostsOpen] = useState(false);
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
            background: s.connected ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
            fontSize: 11,
            color: s.connected ? 'oklch(0.85 0.15 140)' : 'oklch(0.75 0.2 30)',
            border: `1px solid ${s.connected ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: s.connected ? 'oklch(0.75 0.18 140)' : 'oklch(0.65 0.2 30)',
            }} />
            {s.connected ? 'Подключено' : s.closeReason ? `Ошибка: ${s.closeReason}` : 'Подключаемся…'}
          </div>

          {s.isPrimaryHost && (
            <button onClick={() => setHostsOpen(true)} className="pill" title="Управление хостами">
              Хосты ({s.hostIds.length})
            </button>
          )}
          <button onClick={onLeave} className="pill" style={{ color: 'oklch(0.85 0.2 30)' }}>Покинуть</button>
        </div>

        <HostsManagerModal open={hostsOpen} onClose={() => setHostsOpen(false)} />

        <DriftMetricsBar metrics={s.metrics} />

        {s.nowTrack && (
          <div style={{ marginBottom: 16 }}>
            <VoteSkipBar state={s.skipVote} onVote={s.voteSkip} />
          </div>
        )}

        <div className="glass" style={{ position: 'relative', padding: 28, marginBottom: 16, borderRadius: 16, textAlign: 'center' }}>
          <ReactionLayer reactions={s.reactions} />
          {s.nowTrack
            ? <Cover trackId={s.nowTrack.id} coverKey={s.nowTrack.coverKey} size={120} className="mx-auto mb-3.5" />
            : <div style={{ width: 120, height: 120, margin: '0 auto 14px', borderRadius: 14, background: 'var(--glass)' }} />}
          <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>{s.nowTrack?.title || '—'}</div>
          <div style={{ fontSize: 14, color: 'var(--ink-dim)', marginBottom: 18 }}>{s.nowTrack?.artist || ''}</div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, alignItems: 'center', marginBottom: 14, opacity: s.isHost ? 1 : 0.4 }}>
            <button onClick={() => s.cmd('SKIP_COMMAND')} className="icon-btn" disabled={!s.isHost}><Icon.Prev /></button>
            <button
              onClick={() => s.cmd(s.playing ? 'PAUSE_COMMAND' : 'PLAY_COMMAND')}
              className="play-btn" disabled={!s.isHost}>
              {s.playing ? <Icon.Pause size={20} /> : <Icon.Play size={20} />}
            </button>
            <button onClick={() => s.cmd('SKIP_COMMAND')} className="icon-btn" disabled={!s.isHost}><Icon.Next /></button>
          </div>

          {!s.isHost && <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10 }}>Управление доступно только хосту</div>}

          <div onClick={s.isHost ? onSeekBar : undefined} className="progress" style={{ marginBottom: 6, cursor: s.isHost ? 'pointer' : 'default' }}>
            <div className="progress-fill" style={{ width: `${s.duration ? (s.progress / s.duration * 100) : 0}%` }}>
              <div className="progress-thumb" />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-faint)' }}>
            <span>{fmt(s.progress)}</span><span>{fmt(s.duration)}</span>
          </div>

          {s.needsTap && (
            <button onClick={s.tapToPlay} style={{
              marginTop: 14, width: '100%', padding: '12px 0',
              background: 'oklch(0.55 0.2 265)', color: '#fff',
              border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>Нажмите для воспроизведения</button>
          )}

          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
            <ReactionPicker onSend={s.sendReaction} disabled={!s.nowTrack} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }} className="room-grid">
          <div className="glass" style={{ padding: 16, borderRadius: 16 }}>
            <h3 style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Очередь</h3>
            {s.queue.length === 0
              ? <div style={{ padding: 12, color: 'var(--ink-faint)', fontSize: 12, textAlign: 'center' }}>Пусто</div>
              : s.queue.map((q: any, i: number) => (
                <div key={q.id || i} style={{ padding: '6px 8px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ width: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>{i + 1}</span>
                  <Cover trackId={q.trackId} coverKey={q.coverKey} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.title || 'Трек'}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{q.artist || ''}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); s.voteOnQueue(q.id); }}
                    aria-label={q.hasMyVote ? 'Убрать голос' : 'Проголосовать'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px', borderRadius: 999,
                      border: '1px solid var(--glass-border)',
                      background: q.hasMyVote ? 'oklch(0.78 0.11 var(--accent-h) / 0.18)' : 'transparent',
                      color: q.hasMyVote ? 'var(--accent)' : 'var(--ink-dim)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    <Icon.Heart size={11} filled={q.hasMyVote} />
                    {q.votes > 0 && <span>{q.votes}</span>}
                  </button>
                </div>
              ))}
          </div>

          <div className="glass" style={{ padding: 16, borderRadius: 16, maxHeight: 350, overflow: 'auto' }}>
            <h3 style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1, position: 'sticky', top: 0, background: 'rgba(0,0,0,0.3)', padding: '4px 0' }}>Добавить в очередь</h3>
            {s.tracks.map((t: any) => (
              <div key={t.id} onClick={() => s.addToQueue(t.id)} style={{ padding: '6px 8px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', borderRadius: 6 }}>
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
            {s.chat.map((m: any, i: number) => (
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
              onKeyDown={e => e.key === 'Enter' && onSendChat()}
              placeholder="Сообщение..."
              style={{ flex: 1, padding: '10px 16px', borderRadius: 999, background: 'var(--glass)', border: '1px solid var(--glass-border)', color: 'var(--ink)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={onSendChat} className="play-btn" style={{ padding: '8px 16px', borderRadius: 999, width: 'auto', height: 'auto', background: 'var(--accent)', color: '#1a0030', fontWeight: 500, fontSize: 12 }}>↑</button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 700px) {
          :global(.room-grid) { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
