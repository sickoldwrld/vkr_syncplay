'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Cover, fmtMs, coverStyle } from './Icons';
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

interface Props {
  playlistId: string;
  playlistName: string;
  isPublic?: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onPlay: (track: Track, list?: Track[]) => void;
  onChanged?: () => void;
}

export default function PlaylistView({
  playlistId, playlistName, isPublic, readOnly, onClose, onPlay, onChanged,
}: Props) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playlistName);
  const [pub, setPub] = useState<boolean>(!!isPublic);
  const [adderQuery, setAdderQuery] = useState('');
  const [showAdder, setShowAdder] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);

  function showError(msg: string) {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(prev => prev === msg ? null : prev), 5000);
  }

  useEffect(() => { reload(); }, [playlistId]);

  async function reload() {
    setLoading(true);
    try {
      const requests: [Promise<Track[]>, Promise<Track[]>?] = [
        api<Track[]>('GET', `/playlists/${playlistId}/tracks`),
        readOnly ? undefined : api<Track[]>('GET', '/tracks'),
      ];
      const [pl, all] = await Promise.all(requests);
      setTracks(pl ?? []);
      setAllTracks(all ?? []);
    } catch {} finally { setLoading(false); }
  }

  async function saveMeta() {
    if (!name.trim()) { showError('Имя плейлиста обязательно'); return; }
    setErrorMsg(null);
    try {
      await api('PUT', `/playlists/${playlistId}`, { name: name.trim(), isPublic: pub });
      setEditing(false);
      onChanged?.();
    } catch (e: any) { showError(e?.message || 'Не удалось сохранить'); }
  }

  async function removePlaylist() {
    if (!confirm(`Удалить плейлист «${playlistName}»?`)) return;
    try {
      await api('DELETE', `/playlists/${playlistId}`);
      onChanged?.();
      onClose();
    } catch (e: any) { showError(e?.message || 'Не удалось удалить'); }
  }

  async function removeTrack(trackId: string) {
    try {
      await api('DELETE', `/playlists/${playlistId}/tracks/${trackId}`);
      reload();
    } catch (e: any) { showError(e?.message || 'Не удалось удалить трек'); }
  }

  async function addExisting(trackId: string) {
    try {
      await api('POST', `/playlists/${playlistId}/tracks`, { trackId });
      setAdderQuery('');
      reload();
    } catch (e: any) { showError(e?.message || 'Не удалось добавить трек'); }
  }

  function playAll() {
    if (tracks.length > 0) onPlay(tracks[0], tracks);
  }

  // ── Drag-and-drop reorder ──────────────────────────────────────────────────
  function handleDragStart(i: number) {
    dragIdx.current = i;
  }

  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    setDragOver(i);
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  async function handleDrop(toIdx: number) {
    setDragOver(null);
    const fromIdx = dragIdx.current;
    dragIdx.current = null;
    if (fromIdx === null || fromIdx === toIdx) return;

    const reordered = [...tracks];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setTracks(reordered);

    try {
      await api('PUT', `/playlists/${playlistId}/tracks/order`, {
        trackIds: reordered.map(t => t.id),
      });
    } catch (e: any) {
      showError('Не удалось сохранить порядок');
      reload();
    }
  }

  function handleDragEnd() {
    dragIdx.current = null;
    setDragOver(null);
  }
  // ──────────────────────────────────────────────────────────────────────────

  const inPlaylist = useMemo(() => new Set(tracks.map(t => t.id)), [tracks]);
  const adderResults = useMemo(() => {
    const q = adderQuery.toLowerCase().trim();
    return allTracks
      .filter(t => !inPlaylist.has(t.id))
      .filter(t => !q || ((t.title || '') + (t.artist || '') + (t.album || '')).toLowerCase().includes(q))
      .slice(0, 12);
  }, [allTracks, inPlaylist, adderQuery]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,6,18,0.78)',
        backdropFilter: 'blur(10px)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 90,
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass"
        style={{
          width: 720, maxWidth: '100%', maxHeight: '88vh',
          borderRadius: 16, padding: 24,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        {errorMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: 'rgba(248,113,113,0.12)', color: 'oklch(0.78 0.18 30)',
            border: '1px solid rgba(248,113,113,0.35)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          }}>
            <span>✗ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} style={{
              background: 'transparent', border: 'none', color: 'inherit',
              cursor: 'pointer', fontSize: 16, fontFamily: 'inherit', padding: 0,
            }}>×</button>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 96, height: 96, borderRadius: 12, flexShrink: 0, ...coverStyle(playlistId) }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {!editing ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Плейлист {pub ? '· Public' : '· Private'}
                  {readOnly && <span style={{ marginLeft: 8, color: 'var(--accent-soft)' }}>· Чужой</span>}
                </div>
                <h2 style={{
                  fontSize: 28, fontWeight: 600, margin: '4px 0 8px',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{name}</h2>
                <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
                  {tracks.length} {tracks.length === 1 ? 'трек' : 'треков'}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  autoFocus value={name} onChange={e => setName(e.target.value)}
                  placeholder="Название"
                  style={{
                    padding: '10px 14px', borderRadius: 8, fontFamily: 'inherit',
                    background: 'var(--glass)', border: '1px solid var(--glass-border)',
                    color: 'var(--ink)', fontSize: 16, outline: 'none',
                  }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-dim)' }}>
                  <input type="checkbox" checked={pub} onChange={e => setPub(e.target.checked)} />
                  Публичный плейлист
                </label>
              </div>
            )}
          </div>
          <button onClick={onClose} title="Закрыть" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--ink-faint)', padding: 6, fontSize: 20, fontFamily: 'inherit',
          }}>×</button>
        </div>

        {/* Action bar */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={playAll} disabled={tracks.length === 0}
            style={{
              padding: '8px 18px', borderRadius: 999,
              background: tracks.length ? 'var(--accent)' : 'var(--glass-strong)',
              color: tracks.length ? '#1a0030' : 'var(--ink-faint)',
              border: 'none', cursor: tracks.length ? 'pointer' : 'not-allowed',
              fontWeight: 500, fontFamily: 'inherit', fontSize: 13,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <Icon.Play size={14} /> Воспроизвести
          </button>

          {!readOnly && !editing && (
            <button onClick={() => setEditing(true)} style={pillButton('ghost')}>
              Редактировать
            </button>
          )}
          {!readOnly && editing && (
            <>
              <button onClick={saveMeta} style={pillButton('primary')} disabled={!name.trim()}>Сохранить</button>
              <button
                onClick={() => { setEditing(false); setName(playlistName); setPub(!!isPublic); }}
                style={pillButton('ghost')}
              >Отмена</button>
            </>
          )}

          {!readOnly && (
            <>
              <button onClick={() => setShowAdder(s => !s)} style={pillButton('ghost')}>
                {showAdder ? 'Скрыть' : '+ Добавить трек'}
              </button>
              <UploadButton label="Загрузить и добавить" playlistId={playlistId} onUploaded={() => reload()} />
            </>
          )}

          <div style={{ flex: 1 }} />

          {!readOnly && (
            <button onClick={removePlaylist} style={{
              padding: '8px 14px', borderRadius: 999,
              background: 'transparent', border: '1px solid oklch(0.5 0.2 30)',
              color: 'oklch(0.7 0.2 30)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
            }}>Удалить плейлист</button>
          )}
        </div>

        {/* Track adder */}
        {!readOnly && showAdder && (
          <div style={{
            border: '1px solid var(--glass-border)', borderRadius: 12, padding: 12,
            display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--glass)',
          }}>
            <input
              autoFocus value={adderQuery} onChange={e => setAdderQuery(e.target.value)}
              placeholder="Поиск среди ваших треков…"
              style={{
                padding: '8px 12px', borderRadius: 8, fontFamily: 'inherit',
                background: 'var(--glass-strong)', border: '1px solid var(--glass-border)',
                color: 'var(--ink)', fontSize: 13, outline: 'none',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
              {adderResults.length === 0 ? (
                <div style={{ padding: 12, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
                  {allTracks.length === 0 ? 'Загрузка…' : 'Ничего не найдено'}
                </div>
              ) : adderResults.map(t => (
                <div key={t.id} style={{
                  display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 10,
                  alignItems: 'center', padding: '6px 8px', borderRadius: 8,
                }}>
                  <Cover trackId={t.id} coverKey={t.coverKey} size={32} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.title || 'Без названия'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.artist || '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => addExisting(t.id)}
                    style={{
                      padding: '4px 10px', borderRadius: 999,
                      background: 'var(--accent)', color: '#1a0030',
                      border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                    }}
                  >+</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tracks list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 80 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>Загрузка…</div>
          ) : tracks.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
              {readOnly
                ? 'В этом плейлисте пока нет треков.'
                : 'В плейлисте пока нет треков. Нажми «+ Добавить трек» или «Загрузить и добавить».'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {tracks.map((t, i) => (
                <div
                  key={t.id}
                  draggable={!readOnly}
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={e => handleDragOver(e, i)}
                  onDragLeave={handleDragLeave}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onPlay(t, tracks)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: readOnly ? '28px 40px 1fr 56px' : '20px 28px 40px 1fr 56px 28px',
                    gap: 10, alignItems: 'center', padding: '6px 10px',
                    borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s',
                    background: dragOver === i ? 'var(--glass-strong)' : 'transparent',
                    outline: dragOver === i ? '1px solid var(--accent)' : 'none',
                  }}
                  onMouseEnter={e => { if (dragOver !== i) (e.currentTarget as HTMLElement).style.background = 'var(--glass)'; }}
                  onMouseLeave={e => { if (dragOver !== i) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {!readOnly && (
                    <span
                      title="Перетащить"
                      onClick={e => e.stopPropagation()}
                      style={{
                        cursor: 'grab', color: 'var(--ink-faint)', fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        userSelect: 'none',
                      }}
                    >⠿</span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center' }}>{i + 1}</span>
                  <Cover trackId={t.id} coverKey={t.coverKey} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{t.title || 'Без названия'}</div>
                    <div style={{
                      fontSize: 11, color: 'var(--ink-dim)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{t.artist || '—'}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'right' }}>
                    {fmtMs(t.durationMs)}
                  </div>
                  {!readOnly && (
                    <button
                      onClick={e => { e.stopPropagation(); removeTrack(t.id); }}
                      title="Убрать из плейлиста"
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'var(--ink-faint)', padding: 4, fontFamily: 'inherit', fontSize: 16,
                      }}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function pillButton(kind: 'primary' | 'ghost'): React.CSSProperties {
  if (kind === 'primary') return {
    padding: '8px 14px', borderRadius: 999,
    background: 'var(--accent)', color: '#1a0030',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
  };
  return {
    padding: '8px 14px', borderRadius: 999,
    background: 'transparent', color: 'var(--ink-dim)',
    border: '1px solid var(--glass-border)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12,
  };
}
