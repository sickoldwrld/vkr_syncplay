'use client';
import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { api, voteQueueItem } from '@/lib/api';
import { useToast } from './Toast';
import { Icon } from './Icons';

/**
 * Контекстное меню для трека: правый клик (десктоп) или long-press (touch).
 * Использование:
 *
 *   <TrackContextMenu track={t} actions={[
 *     { kind: 'queue' },        // только если roomId известен
 *     { kind: 'like' },
 *     { kind: 'copy-link' },
 *     { kind: 'separator' },
 *     { kind: 'custom', label: 'Удалить', onClick: ..., danger: true },
 *   ]}>
 *     <div>...трек как обычно...</div>
 *   </TrackContextMenu>
 *
 * Меню само получает все нужные данные через props/api и сообщает результат toast'ом.
 */

interface TrackLike {
  id: string;
  title?: string;
  artist?: string;
  liked?: boolean;
  coverKey?: string | null;
}

type Action =
  | { kind: 'separator' }
  | { kind: 'like' }
  | { kind: 'copy-link' }
  | { kind: 'add-to-queue'; roomId: string }
  | { kind: 'add-to-playlist'; playlists: { id: string; name: string }[] }
  | { kind: 'play-next'; onClick: () => void }
  | { kind: 'refine-metadata' }
  | { kind: 'custom'; label: string; icon?: ReactNode; onClick: () => void; danger?: boolean };

interface Props {
  track: TrackLike;
  actions: Action[];
  onChanged?: () => void; // вызывается после like/unlike/add — родитель может перезагрузить
  children: ReactNode;
}

const LONG_PRESS_MS = 500;

export default function TrackContextMenu({ track, actions, onChanged, children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<{ x: number; y: number } | null>(null);
  const toast = useToast();

  const openAt = useCallback((x: number, y: number) => {
    // Корректируем чтобы меню не вышло за края экрана
    const w = 200, h = actions.length * 40 + 16;
    const adjX = Math.min(x, window.innerWidth - w - 8);
    const adjY = Math.min(y, window.innerHeight - h - 8);
    setPos({ x: adjX, y: adjY });
  }, [actions.length]);

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    openAt(e.clientX, e.clientY);
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startedAtRef.current = { x: t.clientX, y: t.clientY };
    longPressTimerRef.current = setTimeout(() => {
      openAt(t.clientX, t.clientY);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!longPressTimerRef.current || !startedAtRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - startedAtRef.current.x;
    const dy = t.clientY - startedAtRef.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }
  function onTouchEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  async function execLike() {
    try {
      if (track.liked) {
        await api('DELETE', `/tracks/${track.id}/like`);
        toast.info('Убрано из любимых');
      } else {
        await api('POST', `/tracks/${track.id}/like`);
        toast.success('Добавлено в любимые');
      }
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось');
    }
  }

  async function execAddToQueue(roomId: string) {
    try {
      await api('POST', `/rooms/${roomId}/queue/${track.id}`);
      toast.success('Добавлено в очередь');
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось добавить');
    }
  }

  async function execAddToPlaylist(playlistId: string, playlistName: string) {
    try {
      await api('POST', `/playlists/${playlistId}/tracks/${track.id}`);
      toast.success(`Добавлено в «${playlistName}»`);
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось');
    }
  }

  async function execCopyLink() {
    const url = `${location.origin}/?play=${track.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Ссылка скопирована');
    } catch {
      toast.error('Не удалось скопировать');
    }
  }

  async function execRefineMetadata() {
    try {
      toast.info('Уточняем теги через MusicBrainz…');
      const r = await api<{
        matched: boolean;
        changed: string[];
        bestScore?: number;
      }>('POST', `/tracks/${track.id}/refine-metadata`);
      if (!r.matched) {
        const score = typeof r.bestScore === 'number' ? ` (score ${r.bestScore})` : '';
        toast.info(`MusicBrainz: подходящего релиза не найдено${score}`);
      } else if (!r.changed?.length) {
        toast.info('MusicBrainz: теги уже корректны');
      } else {
        toast.success('Обновлено: ' + r.changed.join(', '));
      }
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось обогатить теги');
    }
  }

  function close() { setPos(null); }

  function renderItem(a: Action, i: number) {
    if (a.kind === 'separator') {
      return <div key={i} style={{ height: 1, background: 'var(--glass-border)', margin: '4px 0' }} />;
    }
    if (a.kind === 'add-to-playlist') {
      return (
        <div key={i}>
          <div style={menuLabelStyle()}>Добавить в плейлист</div>
          {a.playlists.length === 0
            ? <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--ink-faint)' }}>Нет плейлистов</div>
            : a.playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => { close(); execAddToPlaylist(p.id, p.name); }}
                style={menuItemStyle(false)}
              >{p.name}</button>
            ))}
        </div>
      );
    }
    let label: string, icon: ReactNode, onClick: () => void, danger = false;
    if (a.kind === 'like') {
      label = track.liked ? 'Убрать из любимых' : 'В любимые';
      icon = <Icon.Heart size={14} filled={track.liked} />;
      onClick = execLike;
    } else if (a.kind === 'copy-link') {
      label = 'Скопировать ссылку';
      icon = <LinkIcon />;
      onClick = execCopyLink;
    } else if (a.kind === 'add-to-queue') {
      label = 'Добавить в очередь';
      icon = <Icon.Queue size={14} />;
      const rid = a.roomId;
      onClick = () => execAddToQueue(rid);
    } else if (a.kind === 'play-next') {
      label = 'Воспроизвести следующим';
      icon = <Icon.Next size={14} />;
      onClick = a.onClick;
    } else if (a.kind === 'refine-metadata') {
      label = 'Уточнить теги (MusicBrainz)';
      icon = <RefineIcon />;
      onClick = execRefineMetadata;
    } else {
      label = a.label;
      icon = a.icon;
      onClick = a.onClick;
      danger = !!a.danger;
    }
    return (
      <button
        key={i}
        onClick={() => { close(); onClick(); }}
        style={menuItemStyle(danger)}
      >
        <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
        <span>{label}</span>
      </button>
    );
  }

  return (
    <>
      <div
        onContextMenu={onContextMenu}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{ display: 'contents' }}
      >
        {children}
      </div>

      {pos && (
        <>
          <div onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }}
               style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'transparent' }} />
          <div style={{
            position: 'fixed',
            left: pos.x, top: pos.y,
            zIndex: 201,
            minWidth: 200,
            padding: 6,
            borderRadius: 12,
            background: 'oklch(0.15 0.04 280 / 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column', gap: 1,
          }}>
            {actions.map(renderItem)}
          </div>
        </>
      )}
    </>
  );
}

function menuItemStyle(danger: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: danger ? 'oklch(0.75 0.2 30)' : 'var(--ink)',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'inline-flex', alignItems: 'center', gap: 8,
  };
}

function menuLabelStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    color: 'var(--ink-faint)',
    padding: '6px 12px 4px',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: "'Space Grotesk', sans-serif",
  };
}

function LinkIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function RefineIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.5-6.3" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3" />
      <path d="M18 3v5h-5" />
      <path d="M6 21v-5h5" />
    </svg>
  );
}
