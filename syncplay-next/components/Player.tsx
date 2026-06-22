'use client';
import { useRef, useState } from 'react';
import { Icon, Cover, fmt } from './Icons';
import { api } from '@/lib/api';
import SleepTimer from './SleepTimer';

interface Track {
  id: string; title: string; artist: string; durationMs: number;
  liked?: boolean; coverKey?: string | null;
}

type RepeatMode = 'off' | 'all' | 'one';

interface Props {
  track: Track | null;
  playing: boolean;
  progressSec: number;
  durationSec: number;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onLikeChanged?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  shuffle?: boolean;
  onShuffle?: () => void;
  repeat?: RepeatMode;
  onRepeat?: () => void;
  volume?: number; // 0..1
  onVolumeChange?: (v: number) => void;
  /** Если задан — рендерится Sleep Timer. По срабатыванию вызывается этот колбэк (обычно pause). */
  onSleepTrigger?: () => void;
}

export default function Player({
  track, playing, progressSec, durationSec,
  onTogglePlay, onSeek, onLikeChanged,
  onNext, onPrev,
  shuffle = false, onShuffle,
  repeat = 'off', onRepeat,
  volume = 1, onVolumeChange,
  onSleepTrigger,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const [volBeforeMute, setVolBeforeMute] = useState(1);

  function handleSeek(e: React.MouseEvent) {
    if (!barRef.current || !durationSec) return;
    const r = barRef.current.getBoundingClientRect();
    const pct = (e.clientX - r.left) / r.width;
    onSeek(Math.max(0, Math.min(1, pct)) * durationSec);
  }

  function handleVol(e: React.MouseEvent) {
    if (!volRef.current || !onVolumeChange) return;
    const r = volRef.current.getBoundingClientRect();
    const pct = (e.clientX - r.left) / r.width;
    onVolumeChange(Math.max(0, Math.min(1, pct)));
  }

  function toggleMute() {
    if (!onVolumeChange) return;
    if (volume > 0) { setVolBeforeMute(volume); onVolumeChange(0); }
    else { onVolumeChange(volBeforeMute > 0 ? volBeforeMute : 0.5); }
  }

  async function toggleLike() {
    if (!track) return;
    if (track.liked) await api('DELETE', `/tracks/${track.id}/like`);
    else await api('POST', `/tracks/${track.id}/like`);
    onLikeChanged?.();
  }

  const accent = 'var(--accent)';
  const dim = 'var(--ink-dim)';
  const VolIcon = volume === 0 ? Icon.VolumeMute : (volume < 0.5 ? Icon.VolumeLow : Icon.Volume);

  return (
    <div className="player-wrap">
      <div className={'glass player ' + (playing ? '' : 'paused')}>
        <div className="now-playing">
          {track
            ? <Cover trackId={track.id} coverKey={track.coverKey} size={56} className="np-cover" />
            : <div className="np-cover" style={{ background: 'var(--glass)' }} />
          }
          <div className="np-meta">
            <div className="np-title">{track?.title || '—'}</div>
            <div className="np-artist">{track?.artist || ''}</div>
          </div>
          {track && (
            <button
              className="icon-btn" onClick={toggleLike}
              style={{ color: track.liked ? accent : dim }}
              title={track.liked ? 'Убрать из любимых' : 'В любимые'}
            >
              <Icon.Heart filled={track.liked} size={16} />
            </button>
          )}
        </div>
        <div className="player-center">
          <div className="transport">
            <button
              className="icon-btn"
              onClick={onShuffle}
              title={shuffle ? 'Случайный порядок: вкл' : 'Случайный порядок: выкл'}
              style={{ color: shuffle ? accent : dim }}
            ><Icon.Shuffle /></button>
            <button
              className="icon-btn"
              onClick={onPrev}
              disabled={!track}
              title="Предыдущий"
            ><Icon.Prev /></button>
            <button className="play-btn" onClick={onTogglePlay} disabled={!track}>
              {playing ? <Icon.Pause size={18} /> : <Icon.Play size={18} />}
            </button>
            <button
              className="icon-btn"
              onClick={onNext}
              disabled={!track}
              title="Следующий"
            ><Icon.Next /></button>
            <button
              className="icon-btn"
              onClick={onRepeat}
              title={`Повтор: ${repeat === 'off' ? 'выкл' : repeat === 'all' ? 'все' : 'один'}`}
              style={{ color: repeat !== 'off' ? accent : dim, position: 'relative' }}
            >
              <Icon.Repeat />
              {repeat === 'one' && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  fontSize: 8, fontWeight: 700, lineHeight: 1,
                  background: accent, color: '#1a0030',
                  borderRadius: 6, padding: '1px 3px',
                }}>1</span>
              )}
            </button>
          </div>
          <div className="progress-row">
            <span className="time">{fmt(progressSec)}</span>
            <div className="progress" ref={barRef} onClick={handleSeek}>
              <div
                className="progress-fill"
                style={{ width: durationSec ? `${(progressSec / durationSec) * 100}%` : '0%' }}
              >
                <div className="progress-thumb" />
              </div>
            </div>
            <span className="time">{fmt(durationSec)}</span>
          </div>
        </div>
        <div className="player-right">
          <div className="viz">
            <span /><span /><span /><span /><span /><span />
          </div>
          <button className="icon-btn" title="Очередь"><Icon.Queue /></button>
          {onSleepTrigger && <SleepTimer onTrigger={onSleepTrigger} />}
          <div className="volume" title={`Громкость: ${Math.round(volume * 100)}%`}>
            <button
              onClick={toggleMute}
              className="icon-btn"
              style={{ padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <VolIcon />
            </button>
            <div
              className="vol-bar"
              ref={volRef}
              onClick={handleVol}
              style={{ cursor: 'pointer' }}
            >
              <div className="vol-fill" style={{ width: `${Math.round(volume * 100)}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
