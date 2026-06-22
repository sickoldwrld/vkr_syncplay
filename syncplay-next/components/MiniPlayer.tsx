'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRoomSession } from '@/lib/roomSession';
import { Cover, Icon } from './Icons';

/**
 * Persistent mini-player rendered at the bottom of the viewport while a room
 * session is active and the user is NOT on the room page itself. Lets the user
 * roam other pages (catalog, upload, friends) without dropping the room WS or
 * audio stream.
 */
export default function MiniPlayer() {
  const s = useRoomSession();
  const pathname = usePathname() || '';

  if (!s.roomId || !s.nowTrack) return null;
  if (pathname.startsWith(`/rooms/${s.roomId}`)) return null;

  const pct = s.duration ? Math.min(100, (s.progress / s.duration) * 100) : 0;

  return (
    <div
      role="region"
      aria-label="Mini-плеер активной комнаты"
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 60,
        maxWidth: 720, marginInline: 'auto',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'rgba(15, 12, 30, 0.72)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        border: '1px solid var(--glass-border)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
        color: 'var(--ink)',
      }}
    >
      <Cover trackId={s.nowTrack.id} coverKey={s.nowTrack.coverKey} size={44} />

      <Link
        href={`/rooms/${s.roomId}`}
        style={{
          flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}
      >
        <div style={{
          fontSize: 13, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {s.nowTrack.title || 'Без названия'}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--ink-faint)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {s.nowTrack.artist || ''}
        </div>
        <div style={{
          marginTop: 4, height: 2, borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: 'var(--accent)', transition: 'width 0.5s linear',
          }} />
        </div>
      </Link>

      <button
        onClick={() => s.cmd(s.playing ? 'PAUSE_COMMAND' : 'PLAY_COMMAND')}
        disabled={!s.isHost}
        aria-label={s.playing ? 'Пауза' : 'Воспроизвести'}
        title={s.isHost ? '' : 'Управление доступно только хосту'}
        style={{
          width: 38, height: 38, borderRadius: 999,
          background: s.isHost ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
          color: s.isHost ? '#1a0030' : 'var(--ink-faint)',
          border: 'none', cursor: s.isHost ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {s.playing ? <Icon.Pause size={16} /> : <Icon.Play size={16} />}
      </button>

      <Link
        href={`/rooms/${s.roomId}`}
        aria-label="Открыть комнату"
        style={{
          width: 36, height: 36, borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.06)',
          color: 'var(--ink-dim)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          textDecoration: 'none', flexShrink: 0,
        }}
      >
        <Icon.ChevronRight size={18} />
      </Link>
    </div>
  );
}
