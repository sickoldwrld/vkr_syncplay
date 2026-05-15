'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon, Cover, fmtMs } from './Icons';
import { api } from '@/lib/api';
import UploadButton from './UploadButton';

interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  liked?: boolean;
  coverKey?: string | null;
}
interface PublicPlaylist { id: string; name: string; ownerName?: string; trackCount?: number; }
interface HistoryItem { trackId: string; title: string; artist: string; durationMs: number; coverKey?: string | null; }

interface Props {
  onPlay: (track: Track, list?: Track[]) => void;
  currentTrackId: string | null;
  isPlaying: boolean;
  refreshSignal?: number;
  onRefreshLeft?: () => void;
  onOpenPlaylist?: (id: string, name: string, isPublic: boolean, readOnly: boolean) => void;
}

export default function CenterColumn({ onPlay, currentTrackId, isPlaying, refreshSignal, onRefreshLeft, onOpenPlaylist }: Props) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [filtered, setFiltered] = useState<Track[]>([]);
  const [recommendations, setRecommendations] = useState<Track[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [publicPl, setPublicPl] = useState<PublicPlaylist[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    reload();
    loadPublic();
    loadRecommendations();
    loadHistory();
  }, [refreshSignal]);

  useEffect(() => {
    const q = query.toLowerCase().trim();
    setFiltered(q
      ? tracks.filter(t => ((t.title || '') + (t.artist || '') + (t.album || '')).toLowerCase().includes(q))
      : tracks);
  }, [query, tracks]);

  async function reload() { try { setTracks(await api<Track[]>('GET', '/tracks')); } catch {} }
  async function loadPublic() { try { setPublicPl(await api<PublicPlaylist[]>('GET', '/playlists/public')); } catch {} }
  async function loadRecommendations() {
    try { setRecommendations(await api<Track[]>('GET', '/recommendations?limit=10')); } catch {}
  }
  async function loadHistory() {
    try { setHistory(await api<HistoryItem[]>('GET', '/history?limit=8')); } catch {}
  }

  async function toggleLike(t: Track) {
    if (t.liked) await api('DELETE', `/tracks/${t.id}/like`);
    else await api('POST', `/tracks/${t.id}/like`);
    reload();
    loadRecommendations();
    onRefreshLeft?.();
  }

  return (
    <div className="glass col">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)' }}>
            <Icon.Search />
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search songs, artists, playlists"
            style={{
              width: '100%', paddingLeft: 40, paddingRight: 12, paddingTop: 10, paddingBottom: 10,
              background: 'var(--glass)', border: '1px solid var(--glass-border)',
              borderRadius: 999, color: 'var(--ink)', fontSize: 13, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
        <UploadButton
          label="Загрузить"
          onUploaded={() => { reload(); loadRecommendations(); onRefreshLeft?.(); }}
        />
      </div>

      <div className="col-scroll">
        <div className="center-hero">
          <div className="hero-kicker">Welcome back</div>
          <h1 className="hero-title">Pick up where you left off.</h1>
          <p className="hero-sub">Открой плейлист или зайди в комнату с друзьями.</p>
        </div>

        {recommendations.length > 0 && (
          <>
            <div className="section-header">
              <h2 className="section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon.Sparkles /> Для тебя
              </h2>
            </div>
            <div className="tiles">
              {recommendations.slice(0, 6).map(t => (
                <div key={t.id} className="tile" style={{ cursor: 'pointer' }} onClick={() => onPlay(t, recommendations)}>
                  <div className="tile-cover">
                    <Cover trackId={t.id} coverKey={t.coverKey} size={160} />
                    <button className="tile-play"><Icon.Play size={16} /></button>
                  </div>
                  <div className="tile-title">{t.title}</div>
                  <div className="tile-sub">{t.artist || '—'}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {publicPl.length > 0 && (
          <>
            <div className="section-header">
              <h2 className="section-title">Made for you</h2>
              <span className="see-all">See all →</span>
            </div>
            <div className="tiles">
              {publicPl.slice(0, 6).map(p => (
                <div
                  key={p.id}
                  className="tile"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onOpenPlaylist?.(p.id, p.name, true, true)}
                >
                  <div className="tile-cover">
                    <Cover trackId={p.id} size={160} />
                    <button className="tile-play" onClick={e => { e.stopPropagation(); onOpenPlaylist?.(p.id, p.name, true, true); }}>
                      <Icon.Play size={16} />
                    </button>
                  </div>
                  <div className="tile-title">{p.name}</div>
                  <div className="tile-sub">{p.ownerName || 'Unknown'} · {p.trackCount || 0} треков</div>
                </div>
              ))}
            </div>
          </>
        )}

        {history.length > 0 && (
          <>
            <div className="section-header">
              <h2 className="section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon.History /> Недавно слушали
              </h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
              {history.slice(0, 8).map(h => {
                const t = tracks.find(tr => tr.id === h.trackId);
                return (
                  <div
                    key={h.trackId}
                    onClick={() => {
                      if (!t) return;
                      // Контекст истории: маппим в реальные треки которые уже есть в `tracks`
                      const list = history.map(x => tracks.find(tr => tr.id === x.trackId)).filter(Boolean) as Track[];
                      onPlay(t, list.length ? list : [t]);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: 8,
                      borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--glass)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <Cover trackId={h.trackId} coverKey={h.coverKey || t?.coverKey} size={44} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 500,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {h.title}
                      </div>
                      <div style={{
                        fontSize: 11, color: 'var(--ink-faint)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {h.artist || '—'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="section-header">
          <h2 className="section-title">
            All tracks
            {query && (
              <span style={{ fontSize: 13, color: 'var(--ink-faint)', fontWeight: 400, marginLeft: 8 }}>
                · {filtered.length} из {tracks.length}
              </span>
            )}
          </h2>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
            {tracks.length === 0
              ? <>Загрузи первый трек на странице <Link href="/upload" style={{ color: 'var(--accent)' }}>/upload</Link></>
              : 'Ничего не найдено'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.map((t, i) => {
              const active = t.id === currentTrackId;
              return (
                <div
                  key={t.id}
                  className="track-row"
                  onClick={() => onPlay(t, filtered)}
                  style={{
                    display: 'grid', gridTemplateColumns: '36px 44px 1fr 100px 28px 56px',
                    gap: 10, alignItems: 'center', padding: '8px 12px',
                    borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s',
                    background: active ? 'var(--glass-strong)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--glass)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{
                    fontSize: 14, textAlign: 'center',
                    color: active ? 'var(--accent)' : 'var(--ink-faint)',
                  }}>
                    {active && isPlaying ? '♫' : i + 1}
                  </span>
                  <Cover trackId={t.id} coverKey={t.coverKey} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 500,
                      color: active ? 'var(--accent-soft)' : 'var(--ink)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {t.title || 'Без названия'}
                    </div>
                    <div style={{
                      fontSize: 11, color: 'var(--ink-dim)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {t.artist || '—'}
                    </div>
                  </div>
                  <div className="track-album" style={{
                    fontSize: 11, color: 'var(--ink-faint)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {t.album || ''}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleLike(t); }}
                    title={t.liked ? 'Убрать из любимых' : 'В любимые'}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: t.liked ? 'var(--accent)' : 'var(--ink-faint)',
                      padding: 0,
                    }}
                  >
                    <Icon.Heart size={14} filled={t.liked} />
                  </button>
                  <div className="track-duration" style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'right' }}>
                    {fmtMs(t.durationMs)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
