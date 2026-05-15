'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, logout } from '@/lib/api';
import { Icon, Cover, coverStyle, fmt } from '@/components/Icons';
import TweaksPanel, { useTweaks } from '@/components/TweaksPanel';

type Tab = 'home' | 'library' | 'friends' | 'search' | 'player';

interface Track {
  id: string; title: string; artist: string;
  durationMs: number; liked?: boolean; coverKey?: string | null;
}
interface Playlist { id: string; name: string; ownerName?: string; trackCount?: number; }
interface FriendNP {
  userId: string; username: string; isOnline: boolean;
  trackId?: string | null; trackTitle?: string | null; trackArtist?: string | null; coverKey?: string | null;
  roomId?: string | null;
}

interface Props {
  currentTrack: Track | null;
  playing: boolean;
  progressSec: number;
  durationSec: number;
  onPlay: (t: Track, list?: Track[]) => void;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onLikeChanged?: () => void;
}

/* ─── small reusable bits ─── */

function Eq() {
  return <span className="sp-eq"><span /><span /><span /><span /></span>;
}

const MI = {
  Play: ({ s = 16 }: { s?: number }) => <Icon.Play size={s} />,
  Pause: ({ s = 16 }: { s?: number }) => <Icon.Pause size={s} />,
  Prev: ({ s = 22 }: { s?: number }) => <Icon.Prev size={s} />,
  Next: ({ s = 22 }: { s?: number }) => <Icon.Next size={s} />,
  Shuffle: ({ s = 18 }: { s?: number }) => <Icon.Shuffle size={s} />,
  Repeat: ({ s = 18 }: { s?: number }) => <Icon.Repeat size={s} />,
  Heart: ({ s = 18, filled }: { s?: number; filled?: boolean }) => <Icon.Heart size={s} filled={filled} />,
  Search: ({ s = 16 }: { s?: number }) => <Icon.Search size={s} />,
  Plus: ({ s = 18 }: { s?: number }) => <Icon.Plus size={s} />,
  Queue: ({ s = 20 }: { s?: number }) => <Icon.Queue size={s} />,
  Logout: ({ s = 16 }: { s?: number }) => <Icon.Logout size={s} />,
  Sliders: ({ s = 16 }: { s?: number }) => <Icon.Sliders size={s} />,
  Headphones: ({ s = 16 }: { s?: number }) => <Icon.Headphones size={s} />,
  Down: ({ s = 18 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  Home: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12L12 4l9 8" /><path d="M5 10v10h14V10" />
    </svg>
  ),
  Lib: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4v16M8 4v16M13 6l4 14M17.5 4l1 1.5" />
    </svg>
  ),
  Friends: ({ s = 20 }: { s?: number }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

/* ─── mini player (anchored above tab bar) ─── */
function MiniPlayer({
  track, playing, progressSec, durationSec, onTogglePlay, onExpand,
}: {
  track: Track | null; playing: boolean; progressSec: number; durationSec: number;
  onTogglePlay: () => void; onExpand: () => void;
}) {
  if (!track) return null;
  const pct = durationSec > 0 ? Math.min(100, (progressSec / durationSec) * 100) : 0;
  return (
    <div className="sp-mini" onClick={onExpand}>
      <div className="sp-mini-cov" style={coverStyle(track.id)} />
      <div className="sp-mini-meta">
        <div className="sp-mini-title">{track.title}</div>
        <div className="sp-mini-artist">{track.artist || '—'}</div>
      </div>
      {playing && <Eq />}
      <button
        className="sp-mini-play"
        onClick={e => { e.stopPropagation(); onTogglePlay(); }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <MI.Pause s={16} /> : <MI.Play s={16} />}
      </button>
      <div className="sp-mini-prog" style={{ ['--prog' as any]: `${pct}%` }} />
    </div>
  );
}

/* ─── tab bar ─── */
function TabBar({ tab, setTab, hasTrack }: { tab: Tab; setTab: (t: Tab) => void; hasTrack: boolean }) {
  const tabs: { id: Tab; label: string; icon: ({ s }: { s?: number }) => React.JSX.Element; disabled?: boolean }[] = [
    { id: 'home', label: 'Home', icon: MI.Home },
    { id: 'library', label: 'Library', icon: MI.Lib },
    { id: 'player', label: 'Player', icon: MI.Play, disabled: !hasTrack },
    { id: 'friends', label: 'Friends', icon: MI.Friends },
    { id: 'search', label: 'Search', icon: MI.Search },
  ];
  return (
    <div className="sp-tabs">
      {tabs.map(t => {
        const I = t.icon;
        return (
          <button
            key={t.id}
            className={'sp-tab ' + (tab === t.id ? 'active' : '')}
            onClick={() => !t.disabled && setTab(t.id)}
            disabled={t.disabled}
            style={t.disabled ? { opacity: 0.35 } : undefined}
          >
            <span className="sp-tab-icon"><I s={20} /></span>
            <span className="sp-tab-label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── HOME ─── */
function HomeScreen({
  tracks, recommendations, history, onPlay, onOpenTweaks, onLogout,
}: {
  tracks: Track[]; recommendations: Track[]; history: Track[];
  onPlay: (t: Track, list: Track[]) => void;
  onOpenTweaks: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      <div className="sp-hdr">
        <div>
          <div className="sp-hdr-sub">Welcome back</div>
          <div className="sp-hdr-title">Syncplay</div>
        </div>
        <div className="sp-hdr-actions">
          <button className="sp-icon-btn" onClick={onOpenTweaks} aria-label="Tweaks">
            <MI.Sliders s={16} />
          </button>
          <button className="sp-icon-btn" onClick={onLogout} aria-label="Logout">
            <MI.Logout s={16} />
          </button>
        </div>
      </div>

      <div className="sp-scroll">
        {recommendations.length > 0 && (
          <>
            <div className="sp-sec-title"><h3>Для тебя</h3></div>
            <div className="sp-hrow">
              {recommendations.slice(0, 8).map(t => (
                <div key={t.id} className="sp-hcard">
                  <div className="sp-tile-cov" style={coverStyle(t.id)} onClick={() => onPlay(t, recommendations)}>
                    <button className="sp-tile-play" aria-label="Play"><MI.Play s={14} /></button>
                  </div>
                  <div className="sp-tile-title">{t.title}</div>
                  <div className="sp-tile-sub">{t.artist || '—'}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {history.length > 0 && (
          <>
            <div className="sp-sec-title"><h3>Недавно слушали</h3></div>
            <div className="sp-chips-row">
              {history.slice(0, 4).map(t => (
                <div key={t.id} className="sp-hero" style={{ padding: 8, gap: 10 }} onClick={() => onPlay(t, history)}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, ...coverStyle(t.id) }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: 'Space Grotesk', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>{t.artist || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="sp-sec-title"><h3>Все треки</h3></div>
        <div className="sp-tiles">
          {tracks.slice(0, 12).map(t => (
            <div key={t.id}>
              <div className="sp-tile-cov" style={coverStyle(t.id)} onClick={() => onPlay(t, tracks)}>
                <button className="sp-tile-play" aria-label="Play"><MI.Play s={14} /></button>
              </div>
              <div className="sp-tile-title">{t.title}</div>
              <div className="sp-tile-sub">{t.artist || '—'}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── LIBRARY ─── */
function LibraryScreen({
  tracks, playlists, onPlay,
}: {
  tracks: Track[]; playlists: Playlist[]; onPlay: (t: Track, list: Track[]) => void;
}) {
  const [tab, setTab] = useState<'tracks' | 'playlists'>('tracks');
  return (
    <>
      <div className="sp-hdr">
        <div>
          <div className="sp-hdr-sub">Your music</div>
          <div className="sp-hdr-title">Library</div>
        </div>
      </div>

      <div className="sp-segs">
        <button className={'sp-pill ' + (tab === 'tracks' ? 'active' : '')} onClick={() => setTab('tracks')}>Tracks</button>
        <button className={'sp-pill ' + (tab === 'playlists' ? 'active' : '')} onClick={() => setTab('playlists')}>Playlists</button>
      </div>

      <div className="sp-scroll">
        {tab === 'tracks' ? (
          <div className="sp-tiles">
            {tracks.map(t => (
              <div key={t.id}>
                <div className="sp-tile-cov" style={coverStyle(t.id)} onClick={() => onPlay(t, tracks)}>
                  <button className="sp-tile-play" aria-label="Play"><MI.Play s={14} /></button>
                </div>
                <div className="sp-tile-title">{t.title}</div>
                <div className="sp-tile-sub">{t.artist || '—'}</div>
              </div>
            ))}
            {tracks.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--ink-faint)', padding: 40 }}>
                Пока нет треков
              </div>
            )}
          </div>
        ) : (
          <div>
            {playlists.map(p => (
              <div key={p.id} className="sp-hero">
                <div style={{ ...coverStyle(p.id), width: 58, height: 58, borderRadius: 14, flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, fontFamily: 'Space Grotesk' }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2 }}>
                    {p.ownerName || 'You'} · {p.trackCount || 0} треков
                  </div>
                </div>
              </div>
            ))}
            {playlists.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 40 }}>
                Нет плейлистов
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ─── FRIENDS + ROOMS ─── */
interface Room { id: string; name: string; hostName?: string; count?: number; state: string; track?: string; }

function FriendsScreen({ friends }: { friends: FriendNP[] }) {
  const router = useRouter();
  const [sub, setSub] = useState<'friends' | 'rooms'>('friends');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (sub === 'rooms') {
      api<Room[]>('GET', '/rooms').then(setRooms).catch(() => {});
    }
  }, [sub]);

  async function createRoom() {
    const name = newRoomName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const r = await api<{ id: string }>('POST', '/rooms', { name });
      setCreateOpen(false);
      setNewRoomName('');
      router.push(`/rooms/${r.id}`);
    } catch (e: any) {
      alert(e?.message || 'Не удалось создать комнату');
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(id: string) {
    try { await api('POST', `/rooms/${id}/join`); } catch {}
    router.push(`/rooms/${id}`);
  }

  const live = friends.filter(f => f.isOnline && f.trackId);

  return (
    <>
      <div className="sp-hdr">
        <div>
          <div className="sp-hdr-sub">{sub === 'rooms' ? 'Live sessions' : 'Listening together'}</div>
          <div className="sp-hdr-title">{sub === 'rooms' ? 'Rooms' : 'Friends'}</div>
        </div>
        <div className="sp-hdr-actions">
          {sub === 'rooms' ? (
            <button
              className="sp-icon-btn"
              onClick={() => setCreateOpen(true)}
              aria-label="Create room"
              title="Создать комнату"
              style={{ background: 'var(--accent-soft)', color: '#1a0f2e', border: 'none' }}
            >
              <MI.Plus s={16} />
            </button>
          ) : (
            <button className="sp-icon-btn" aria-label="Add friend"><MI.Plus s={16} /></button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="sp-segs">
        <button className={'sp-pill ' + (sub === 'friends' ? 'active' : '')} onClick={() => setSub('friends')}>
          Друзья
        </button>
        <button className={'sp-pill ' + (sub === 'rooms' ? 'active' : '')} onClick={() => setSub('rooms')}>
          Комнаты {rooms.length > 0 && `(${rooms.length})`}
        </button>
      </div>

      {/* Create room form */}
      {sub === 'rooms' && createOpen && (
        <div style={{ padding: '0 18px 14px' }}>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center',
            background: 'var(--glass)', border: '1px solid var(--glass-border)',
            padding: '10px 14px', borderRadius: 16,
          }}>
            <input
              autoFocus
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createRoom(); if (e.key === 'Escape') setCreateOpen(false); }}
              placeholder="Название комнаты…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--ink)', fontSize: 14, fontFamily: 'inherit',
              }}
            />
            <button
              className="sp-pill active"
              onClick={createRoom}
              disabled={creating || !newRoomName.trim()}
              style={{ opacity: !newRoomName.trim() ? 0.4 : 1 }}
            >
              {creating ? '...' : 'Создать'}
            </button>
            <button className="sp-pill" onClick={() => { setCreateOpen(false); setNewRoomName(''); }}>
              ×
            </button>
          </div>
        </div>
      )}

      {sub === 'friends' && (
        <>
          <div style={{ padding: '0 18px 14px' }}>
            <span className="sp-live-count">
              <span className="sp-dot" />
              {live.length} listening now
            </span>
          </div>
          <div className="sp-scroll" style={{ paddingTop: 0 }}>
            {friends.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 40 }}>
                Друзья ещё не добавлены
              </div>
            )}
            {friends.map(f => (
              <div className="sp-friend" key={f.userId}>
                <div className="sp-f-top">
                  <div className={'sp-avatar ' + (f.isOnline ? 'live' : '')} style={{ background: `linear-gradient(135deg, oklch(0.7 0.18 ${(f.userId.charCodeAt(0) * 7) % 360}), oklch(0.55 0.2 ${(f.userId.charCodeAt(1) * 13) % 360}))` }}>
                    {f.username[0]?.toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="sp-f-name">{f.username}</div>
                    <div className="sp-f-status">
                      {f.isOnline && <span className="sp-dot" />}
                      {f.isOnline ? (f.trackTitle ? 'Слушает сейчас' : 'Онлайн') : 'Не в сети'}
                    </div>
                  </div>
                  {f.isOnline && f.trackId && <Eq />}
                </div>
                {f.trackId && f.trackTitle && (
                  <div className="sp-f-track">
                    <div className="sp-f-cov" style={coverStyle(f.trackId)} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="sp-f-title">{f.trackTitle}</div>
                      <div className="sp-f-artist">{f.trackArtist || '—'}</div>
                    </div>
                  </div>
                )}
                {f.isOnline && f.roomId && (
                  <div className="sp-f-actions">
                    <button className="sp-pill" onClick={() => joinRoom(f.roomId!)}>
                      Join
                    </button>
                    <button className="sp-pill">Wave 👋</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {sub === 'rooms' && (
        <div className="sp-scroll" style={{ paddingTop: 0 }}>
          {rooms.length === 0 && !createOpen && (
            <div style={{
              padding: '32px 20px', textAlign: 'center',
              color: 'var(--ink-faint)',
              borderRadius: 20,
              background: 'var(--glass)',
              border: '1px dashed var(--glass-border)',
              margin: '0 0 14px',
            }}>
              <div style={{ fontSize: 14, color: 'var(--ink-dim)', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, marginBottom: 6 }}>
                Нет активных комнат
              </div>
              <div style={{ fontSize: 12 }}>Создай первую — нажми «+» сверху</div>
            </div>
          )}
          {rooms.map(r => (
            <div className="sp-friend" key={r.id} onClick={() => joinRoom(r.id)} style={{ cursor: 'pointer' }}>
              <div className="sp-f-top">
                <div className="sp-avatar live" style={{ background: 'var(--accent)' }}>
                  <MI.Headphones s={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="sp-f-name">{r.name}</div>
                  <div className="sp-f-status">
                    <span className="sp-dot" />
                    {r.count || 0} слушателей · {r.state}
                  </div>
                </div>
                {r.state === 'PLAYING' && <Eq />}
              </div>
              {r.track && (
                <div className="sp-f-track">
                  <div className="sp-f-cov" style={coverStyle(r.id)} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="sp-f-title">{r.track}</div>
                    <div className="sp-f-artist">Хост: {r.hostName || '?'}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ─── SEARCH ─── */
function SearchScreen({ tracks, onPlay }: { tracks: Track[]; onPlay: (t: Track, list: Track[]) => void }) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? tracks.filter(t =>
        ((t.title || '') + (t.artist || '')).toLowerCase().includes(q.toLowerCase()))
    : [];
  return (
    <>
      <div className="sp-hdr">
        <div>
          <div className="sp-hdr-sub">Find a song</div>
          <div className="sp-hdr-title">Search</div>
        </div>
      </div>
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--glass)', border: '1px solid var(--glass-border)',
          padding: '11px 16px', borderRadius: 999,
        }}>
          <MI.Search s={16} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search tracks, artists…"
            autoFocus
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--ink)', fontSize: 14, flex: 1, fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      <div className="sp-scroll" style={{ paddingTop: 0 }}>
        {q.trim() === '' && (
          <div style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 40, fontSize: 13 }}>
            Начни вводить запрос
          </div>
        )}
        {q.trim() !== '' && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 40, fontSize: 13 }}>
            Ничего не найдено
          </div>
        )}
        {filtered.map(t => (
          <div key={t.id} className="sp-hero" onClick={() => onPlay(t, filtered)} style={{ padding: 10 }}>
            <Cover trackId={t.id} coverKey={t.coverKey} size={50} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'Space Grotesk' }}>{t.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2 }}>{t.artist || '—'}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── PLAYER TAB (was fullscreen overlay, now full-height tab content) ─── */
function PlayerScreen({
  track, playing, progressSec, durationSec, onTogglePlay, onSeek, onNext, onPrev, onLikeChanged,
}: {
  track: Track; playing: boolean; progressSec: number; durationSec: number;
  onTogglePlay: () => void; onSeek: (sec: number) => void;
  onNext: () => void; onPrev: () => void;
  onLikeChanged?: () => void;
}) {
  const [liked, setLiked] = useState(!!track.liked);
  useEffect(() => { setLiked(!!track.liked); }, [track.liked, track.id]);

  function toggleLike() {
    const next = !liked;
    setLiked(next);
    const fn = next ? api('POST', `/tracks/${track.id}/like`) : api('DELETE', `/tracks/${track.id}/like`);
    fn.then(() => onLikeChanged?.()).catch(() => setLiked(!next));
  }

  function seekFromClick(e: React.MouseEvent) {
    const r = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(pct * durationSec);
  }

  const remaining = Math.max(0, durationSec - progressSec);

  return (
    <div className="sp-np">
      <div className="sp-np-header">
        <div style={{ width: 36 }} />
        <div className="sp-np-ctx">
          <div className="sp-np-kicker">Now playing</div>
          <div className="sp-np-ctx-title">{track.artist || 'Library'}</div>
        </div>
        <button className="sp-icon-btn" aria-label="Queue">
          <MI.Queue s={18} />
        </button>
      </div>

      <div className="sp-np-cov-wrap" style={coverStyle(track.id)} />

      <div className="sp-np-title-row">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sp-np-title">{track.title}</div>
          <div className="sp-np-artist">{track.artist || '—'}</div>
        </div>
        <button
          className="sp-icon-btn sp-np-like"
          onClick={toggleLike}
          style={{ color: liked ? 'var(--accent)' : 'var(--ink-dim)' }}
          aria-label={liked ? 'Unlike' : 'Like'}
        >
          <MI.Heart s={20} filled={liked} />
        </button>
      </div>

      <div className="sp-np-prog">
        <div className="sp-np-bar" onClick={seekFromClick}>
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

      <div className="sp-np-transport">
        <button className="sp-np-tbtn muted" aria-label="Shuffle"><MI.Shuffle s={18} /></button>
        <button className="sp-np-tbtn" onClick={onPrev} aria-label="Previous"><MI.Prev s={28} /></button>
        <button className="sp-np-play" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <MI.Pause s={26} /> : <MI.Play s={26} />}
        </button>
        <button className="sp-np-tbtn" onClick={onNext} aria-label="Next"><MI.Next s={28} /></button>
        <button className="sp-np-tbtn muted" aria-label="Repeat"><MI.Repeat s={18} /></button>
      </div>
    </div>
  );
}

function PlayerEmpty() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 40, textAlign: 'center', color: 'var(--ink-faint)',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 24,
        background: 'var(--glass)', border: '1px solid var(--glass-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
      }}>
        <MI.Play s={28} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-dim)', fontFamily: "'Space Grotesk', sans-serif" }}>
        Ничего не играет
      </div>
      <div style={{ fontSize: 12, marginTop: 6 }}>
        Выбери трек на вкладке Home или Library
      </div>
    </div>
  );
}

/* ─── shell ─── */
export default function MobileApp({
  currentTrack, playing, progressSec, durationSec,
  onPlay, onTogglePlay, onSeek, onNext, onPrev, onLikeChanged,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('home');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [recommendations, setRecommendations] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [friends, setFriends] = useState<FriendNP[]>([]);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Wrap onPlay: switch to Player tab so user lands on the now-playing screen
  function playAndOpen(t: Track, list?: Track[]) {
    onPlay(t, list);
    setTab('player');
  }

  useEffect(() => {
    api<Track[]>('GET', '/tracks').then(setTracks).catch(() => {});
    api<Track[]>('GET', '/recommendations?limit=10').then(setRecommendations).catch(() => {});
    api<any[]>('GET', '/history?limit=8').then(rows => {
      setHistory(rows.map(h => ({ id: h.trackId, title: h.title, artist: h.artist, durationMs: h.durationMs })));
    }).catch(() => {});
    api<Playlist[]>('GET', '/playlists?mine=true').then(setPlaylists).catch(() => {});
    api<FriendNP[]>('GET', '/friends/now-playing').then(setFriends).catch(() => {});
  }, []);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <>
      <div className="sp-mobile">
        {tab === 'home' && (
          <HomeScreen
            tracks={tracks}
            recommendations={recommendations}
            history={history}
            onPlay={playAndOpen}
            onOpenTweaks={() => setTweaksOpen(true)}
            onLogout={handleLogout}
          />
        )}
        {tab === 'library' && <LibraryScreen tracks={tracks} playlists={playlists} onPlay={playAndOpen} />}
        {tab === 'friends' && <FriendsScreen friends={friends} />}
        {tab === 'search' && <SearchScreen tracks={tracks} onPlay={playAndOpen} />}
        {tab === 'player' && (
          currentTrack ? (
            <PlayerScreen
              track={currentTrack}
              playing={playing}
              progressSec={progressSec}
              durationSec={durationSec}
              onTogglePlay={onTogglePlay}
              onSeek={onSeek}
              onNext={onNext}
              onPrev={onPrev}
              onLikeChanged={onLikeChanged}
            />
          ) : <PlayerEmpty />
        )}
      </div>

      {tab !== 'player' && (
        <MiniPlayer
          track={currentTrack}
          playing={playing}
          progressSec={progressSec}
          durationSec={durationSec}
          onTogglePlay={onTogglePlay}
          onExpand={() => setTab('player')}
        />
      )}
      <TabBar tab={tab} setTab={setTab} hasTrack={!!currentTrack} />

      <MobileTweaks open={tweaksOpen} onClose={() => setTweaksOpen(false)} />
    </>
  );
}

function MobileTweaks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tw, setTw] = useTweaks();
  return <TweaksPanel open={open} onClose={onClose} state={tw} setState={setTw} />;
}
