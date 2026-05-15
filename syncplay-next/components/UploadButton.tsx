'use client';
import { useRef, useState } from 'react';
import { Icon } from './Icons';
import { api, uploadTrack } from '@/lib/api';

interface Props {
  /** Текст кнопки. */
  label?: string;
  /** Если задан — после загрузки трек добавляется в этот плейлист. */
  playlistId?: string;
  /** Колбэк после успешной загрузки. */
  onUploaded?: (track: any) => void;
  /** Дополнительный класс/стили для кнопки. */
  className?: string;
  style?: React.CSSProperties;
  /** Вариант отображения: 'pill' (по умолчанию) или 'dropzone' (большая зона). */
  variant?: 'pill' | 'dropzone';
}

/**
 * Единая кнопка загрузки трека.
 * Один клик → системный picker → загрузка стартует сразу после выбора файла.
 */
export default function UploadButton({
  label = 'Загрузить',
  playlistId,
  onUploaded,
  className,
  style,
  variant = 'pill',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  function pick() {
    if (state === 'uploading') return;
    inputRef.current?.click();
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = ''; // сбросить — чтобы повторный выбор того же файла снова триггерил change
    setState('uploading');
    setMessage(null);

    try {
      const track = await uploadTrack(f);
      if (playlistId && track?.id) {
        try { await api('POST', `/playlists/${playlistId}/tracks`, { trackId: track.id }); }
        catch { /* трек загружен, добавление в плейлист — best-effort */ }
      }
      setState('done');
      setMessage(`«${track.title || f.name}» загружен`);
      onUploaded?.(track);
      setTimeout(() => { setState('idle'); setMessage(null); }, 2500);
    } catch (err: any) {
      setState('error');
      setMessage(err?.message || 'Ошибка загрузки');
      setTimeout(() => { setState('idle'); setMessage(null); }, 4000);
    }
  }

  const busy = state === 'uploading';

  if (variant === 'dropzone') {
    return (
      <div style={style}>
        <div
          onClick={pick}
          className={className}
          style={{
            border: '2px dashed var(--glass-border)',
            borderRadius: 12,
            padding: 36,
            textAlign: 'center',
            cursor: busy ? 'progress' : 'pointer',
            background: 'var(--glass)',
            transition: 'border-color 0.2s, background 0.2s',
            opacity: busy ? 0.7 : 1,
          }}
        >
          <div style={{ marginBottom: 12, color: 'var(--accent)' }}>
            <Icon.Upload size={32} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
            {busy ? 'Загрузка…' : 'Нажми, чтобы выбрать аудио-файл'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
            MP3, FLAC, OGG, WAV, M4A — загрузка стартует сразу
          </div>
        </div>
        <input
          ref={inputRef} type="file" accept="audio/*"
          style={{ display: 'none' }} onChange={onChange}
        />
        {message && (
          <div style={{
            marginTop: 10, padding: 10, borderRadius: 8, fontSize: 13,
            background: state === 'error' ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)',
            color: state === 'error' ? 'oklch(0.7 0.2 30)' : 'oklch(0.85 0.15 140)',
            border: `1px solid ${state === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(74,222,128,0.3)'}`,
          }}>
            {state === 'error' ? '✗' : '✓'} {message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        className={className}
        style={{
          padding: '8px 16px', borderRadius: 999,
          background: busy ? 'var(--glass-strong)' : 'var(--accent)',
          color: busy ? 'var(--ink-dim)' : '#1a0030',
          border: 'none', cursor: busy ? 'progress' : 'pointer',
          fontSize: 13, fontWeight: 500, textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
          ...style,
        }}
      >
        <Icon.Upload size={14} /> {busy ? 'Загрузка…' : label}
      </button>
      <input
        ref={inputRef} type="file" accept="audio/*"
        style={{ display: 'none' }} onChange={onChange}
      />
      {message && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          padding: '6px 10px', borderRadius: 8, fontSize: 12, whiteSpace: 'nowrap',
          background: state === 'error' ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)',
          color: state === 'error' ? 'oklch(0.75 0.2 30)' : 'oklch(0.85 0.15 140)',
          border: `1px solid ${state === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(74,222,128,0.3)'}`,
          zIndex: 50,
        }}>
          {state === 'error' ? '✗' : '✓'} {message}
        </div>
      )}
    </div>
  );
}
