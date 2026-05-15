'use client';
import { useEffect, useState } from 'react';
import { Icon, Eq, Cover, coverStyle } from './Icons';
import { api } from '@/lib/api';

interface Playlist { id: string; name: string; isPublic: boolean; liked?: boolean; }
interface Track { id: string; title: string; artist: string; durationMs: number; liked?: boolean; coverKey?: string | null; }

interface Props {
  onPlayTrack?: (track: Track, list?: Track[]) => void;
  onOpenPlaylist?: (id: string, name: string, isPublic: boolean) => void;
  refreshKey?: number;
}

export default function LeftColumn({ onPlayTrack, onOpenPlaylist, refreshKey }: Props) {
  const [tab, setTab] = useState<'playlists' | 'liked'>('playlists');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [liked, setLiked] = useState<Track[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [editing, setEditing] = useState<Playlist | null>(null);

  useEffect(() => { reload(); }, [tab, refreshKey]);

  async function reload() {
    try {
      if (tab === 'playlists') setPlaylists(await api<Playlist[]>('GET', '/playlists'));
      else setLiked(await api<Track[]>('GET', '/tracks/liked'));
    } catch {}
  }

  async function createPl() {
    if (!newName.trim()) return;
    await api('POST', '/playlists', { name: newName.trim(), isPublic: newPublic });
    setCreating(false); setNewName(''); setNewPublic(false);
    reload();
  }

  return (
    <div className="glass col">
      <div className="fav-header">
        <h2 className="col-title">Library</h2>
        <button className="icon-btn" title="Создать плейлист" onClick={() => setCreating(true)}>
          <Icon.Plus />
        </button>
      </div>

      {creating && (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            autoFocus placeholder="Название..."
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createPl()}
            style={{
              padding: '8px 12px', borderRadius: 999,
              background: 'var(--glass)', border: '1px solid var(--glass-border)',
              color: 'var(--ink)', fontSize: 12, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <label style={{ fontSize: 11, color: 'var(--ink-dim)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={newPublic} onChange={e => setNewPublic(e.target.checked)} />
            Публичный
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="pill" onClick={createPl} style={{ flex: 1 }}>Создать</button>
            <button className="pill" onClick={() => { setCreating(false); setNewName(''); }}>Отмена</button>
          </div>
        </div>
      )}

      <div className="fav-tabs">
        <button className={'pill ' + (tab === 'playlists' ? 'active' : '')} onClick={() => setTab('playlists')}>
          Playlists
        </button>
        <button className={'pill ' + (tab === 'liked' ? 'active' : '')} onClick={() => setTab('liked')}>
          Liked tracks
        </button>
      </div>

      <div className="col-scroll">
        {tab === 'playlists' ? (
          playlists.length === 0
            ? <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>Нет плейлистов</div>
            : playlists.map(p => (
                <div key={p.id} className={'fav-playlist ' + (activeId === p.id ? 'active' : '')}>
                  <div
                    onClick={() => { setActiveId(p.id); onOpenPlaylist?.(p.id, p.name, p.isPublic); }}
                    style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  >
                    <div className="fav-cover">
                      <div className="cov" style={coverStyle(p.id)} />
                    </div>
                    <div className="fav-meta">
                      <div className="fav-name">{p.name}</div>
                      <div className="fav-sub">{p.isPublic ? 'Public' : 'Private'}</div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--ink-faint)', padding: 4, fontFamily: 'inherit',
                    }}
                    title="Редактировать"
                  >⋯</button>
                  {activeId === p.id && <Eq />}
                </div>
              ))
        ) : (
          liked.length === 0
            ? <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>Нет любимых треков</div>
            : liked.map(t => (
                <div key={t.id} className="fav-track" style={{ cursor: 'pointer' }} onClick={() => onPlayTrack?.(t, liked)}>
                  <Cover trackId={t.id} coverKey={t.coverKey} size={36} className="fav-track-cover" />
                  <div className="fav-track-meta">
                    <div className="fav-track-title">{t.title}</div>
                    <div className="fav-track-artist">{t.artist || '—'}</div>
                  </div>
                  <span className="heart"><Icon.Heart filled /></span>
                </div>
              ))
        )}
      </div>

      {editing && (
        <EditPlaylistModal
          playlist={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function EditPlaylistModal({ playlist, onClose, onSaved }: {
  playlist: Playlist;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(playlist.name);
  const [isPublic, setIsPublic] = useState(playlist.isPublic);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api('PUT', `/playlists/${playlist.id}`, { name: name.trim(), isPublic });
      onSaved();
    } catch (e: any) {
      alert(e.message);
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!confirm(`Удалить плейлист "${playlist.name}"?`)) return;
    try {
      await api('DELETE', `/playlists/${playlist.id}`);
      onSaved();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,6,18,0.7)',
        backdropFilter: 'blur(8px)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass"
        style={{
          padding: 24, borderRadius: 16, width: 360, maxWidth: '90vw',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Редактировать плейлист</h3>

        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="Название"
          style={{
            padding: '10px 14px', borderRadius: 8, fontFamily: 'inherit',
            background: 'var(--glass)', border: '1px solid var(--glass-border)',
            color: 'var(--ink)', fontSize: 14, outline: 'none',
          }}
        />

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          color: 'var(--ink-dim)', cursor: 'pointer',
        }}>
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
          Публичный плейлист
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button
            onClick={remove}
            style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'transparent', border: '1px solid oklch(0.5 0.2 30)',
              color: 'oklch(0.7 0.2 30)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Удалить</button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'transparent', border: '1px solid var(--glass-border)',
              color: 'var(--ink-dim)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Отмена</button>
          <button
            onClick={save} disabled={saving || !name.trim()}
            style={{
              padding: '10px 18px', borderRadius: 8,
              background: 'var(--accent)', border: 'none', color: '#1a0030',
              cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit',
            }}
          >{saving ? '...' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}
