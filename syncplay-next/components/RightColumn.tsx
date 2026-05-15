'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, Eq, coverStyle } from './Icons';
import { api } from '@/lib/api';

interface Friend {
  id: string; username: string;
  isLive?: boolean;
  online?: boolean;
  lastSeenAt?: number; // epoch ms
  nowPlaying?: { title: string; artist: string };
  roomId?: string;
}

function formatLastSeen(ts?: number): string {
  if (!ts) return 'Offline';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Только что';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} д назад`;
}
interface FriendRequest { id: string; fromUsername: string; }
interface Room { id: string; name: string; hostName?: string; count?: number; state: string; track?: string; }

export default function RightColumn() {
  const router = useRouter();
  const [tab, setTab] = useState<'friends' | 'rooms'>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [newRoomName, setNewRoomName] = useState('');

  useEffect(() => { reload(); }, [tab]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try { setSearchResults(await api('GET', `/friends/search?q=${encodeURIComponent(searchQuery)}`)); }
      catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function reload() {
    try {
      if (tab === 'friends') {
        setFriends(await api<Friend[]>('GET', '/friends'));
        setRequests(await api<FriendRequest[]>('GET', '/friends/requests'));
      } else {
        setRooms(await api<Room[]>('GET', '/rooms'));
      }
    } catch {}
  }

  async function sendRequest(username: string) {
    try {
      await api('POST', '/friends/requests', { username });
      setSearchQuery(''); setSearchResults([]);
      alert(`Заявка отправлена ${username}`);
    } catch (e: any) { alert(e.message); }
  }

  async function acceptRequest(id: string) { await api('POST', `/friends/requests/${id}/accept`); reload(); }
  async function rejectRequest(id: string) { await api('POST', `/friends/requests/${id}/reject`); reload(); }

  async function createRoom() {
    if (!newRoomName.trim()) return;
    const r = await api<{ id: string }>('POST', '/rooms', { name: newRoomName.trim() });
    setShowCreateRoom(false); setNewRoomName('');
    router.push(`/rooms/${r.id}`);
  }

  async function joinRoom(id: string) {
    try { await api('POST', `/rooms/${id}/join`); } catch {}
    router.push(`/rooms/${id}`);
  }

  /** Join Session: подключиться к комнате друга через FriendController. */
  async function joinFriendSession(friendId: string) {
    try {
      const data = await api<{ roomId?: string }>('GET', `/friends/${friendId}/session`);
      if (data?.roomId) joinRoom(data.roomId);
      else alert('Друг сейчас не слушает в комнате');
    } catch (e: any) {
      alert(e.message || 'Не удалось подключиться');
    }
  }

  const liveCount = friends.filter(f => f.isLive).length;
  const onlineCount = friends.filter(f => f.online && !f.isLive).length;

  // Авто-рефреш списка друзей каждые 25с — чтобы статусы обновлялись
  useEffect(() => {
    if (tab !== 'friends') return;
    const t = setInterval(() => reload(), 25000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="glass col">
      <div className="fav-header">
        <h2 className="col-title">{tab === 'friends' ? 'Friends' : 'Rooms'}</h2>
        <button
          className="icon-btn"
          onClick={() => tab === 'friends' ? setShowAddFriend(true) : setShowCreateRoom(true)}
        >
          <Icon.Plus />
        </button>
      </div>
      {tab === 'friends' && (liveCount > 0 || onlineCount > 0) && (
        <div className="px-3.5 pb-1.5 text-[10px] uppercase tracking-widest font-bold text-[var(--accent-soft)]">
          {liveCount > 0 && <>{liveCount} listening now</>}
          {liveCount > 0 && onlineCount > 0 && ' · '}
          {onlineCount > 0 && <span style={{ color: 'oklch(0.85 0.15 140)' }}>{onlineCount} online</span>}
        </div>
      )}

      <div className="fav-tabs">
        <button
          className={'pill ' + (tab === 'friends' ? 'active' : '')}
          onClick={() => setTab('friends')}
        >
          <Icon.Users size={12} /> Друзья
        </button>
        <button
          className={'pill ' + (tab === 'rooms' ? 'active' : '')}
          onClick={() => setTab('rooms')}
        >
          <Icon.Headphones size={12} /> Комнаты
        </button>
      </div>

      {showAddFriend && tab === 'friends' && (
        <div className="px-3 pb-2.5">
          <input
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            autoFocus placeholder="Поиск по username..."
            className="w-full px-3 py-2 rounded-full bg-[var(--glass)] border border-[var(--glass-border)] text-[var(--ink)] text-xs"
          />
          {searchResults.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1">
              {searchResults.map(u => (
                <div key={u.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-[var(--glass)]">
                  <span className="flex-1 text-xs">{u.username}</span>
                  {u.isFriend
                    ? <span className="text-[10px] text-[var(--ink-faint)]">уже друг</span>
                    : <button className="pill" onClick={() => sendRequest(u.username)}>Добавить</button>
                  }
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => { setShowAddFriend(false); setSearchQuery(''); }}
            className="mt-2 text-[11px] text-[var(--ink-faint)] bg-transparent border-none cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      )}

      {showCreateRoom && tab === 'rooms' && (
        <div className="px-3 pb-2.5 flex flex-col gap-1.5">
          <input
            autoFocus placeholder="Название комнаты..."
            value={newRoomName} onChange={e => setNewRoomName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createRoom()}
            className="px-3 py-2 rounded-full bg-[var(--glass)] border border-[var(--glass-border)] text-[var(--ink)] text-xs"
          />
          <div className="flex gap-1.5">
            <button className="pill flex-1" onClick={createRoom}>Создать</button>
            <button className="pill" onClick={() => { setShowCreateRoom(false); setNewRoomName(''); }}>Отмена</button>
          </div>
        </div>
      )}

      <div className="col-scroll">
        {tab === 'friends' ? (
          <>
            {requests.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] text-[var(--ink-faint)] uppercase tracking-widest p-1 pb-2">
                  Заявки в друзья
                </div>
                {requests.map(r => (
                  <div key={r.id} className="friend">
                    <div className="friend-top">
                      <div className="avatar" style={{ background: 'oklch(0.7 0.14 200)' }}>
                        {r.fromUsername[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="friend-name">{r.fromUsername}</div>
                        <div className="friend-status">хочет дружить</div>
                      </div>
                    </div>
                    <div className="friend-actions">
                      <button className="pill flex-1" onClick={() => acceptRequest(r.id)}>Принять</button>
                      <button className="pill" onClick={() => rejectRequest(r.id)}>Отклонить</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {friends.length === 0
              ? <div className="p-4 text-center text-[var(--ink-faint)] text-xs">Нет друзей</div>
              : friends.map(f => {
                  const statusLabel = f.isLive
                    ? <><span className="live-dot" />Listening now</>
                    : f.online
                      ? <><span className="live-dot" style={{ background: 'oklch(0.75 0.18 140)' }} />Online</>
                      : formatLastSeen(f.lastSeenAt);
                  const avatarClass = f.isLive ? 'live' : f.online ? 'online' : '';
                  return (
                  <div key={f.id} className="friend">
                    <div className="friend-top">
                      <div
                        className={'avatar ' + avatarClass}
                        style={{
                          background: `oklch(0.78 0.14 ${(f.username.charCodeAt(0) * 7) % 360})`,
                          opacity: !f.online && !f.isLive ? 0.55 : 1,
                        }}
                      >
                        {f.username[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="friend-name">{f.username}</div>
                        <div className="friend-status">{statusLabel}</div>
                      </div>
                    </div>
                    {f.nowPlaying && (
                      <div className="friend-track">
                        <div className="friend-cover" style={coverStyle(f.username + (f.nowPlaying.title || ''))} />
                        <div className="friend-track-meta">
                          <div className="friend-track-title">{f.nowPlaying.title}</div>
                          <div className="friend-track-artist">{f.nowPlaying.artist}</div>
                        </div>
                        {f.isLive && <Eq />}
                      </div>
                    )}
                    {f.roomId && f.isLive && (
                      <div className="friend-actions">
                        <button
                          className="pill flex-1"
                          onClick={() => joinFriendSession(f.id)}
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}
                        >
                          Join session
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
          </>
        ) : (
          rooms.length === 0
            ? <div className="p-4 text-center text-[var(--ink-faint)] text-xs">Нет активных комнат</div>
            : rooms.map(r => (
                <div
                  key={r.id} className="friend cursor-pointer"
                  onClick={() => joinRoom(r.id)}
                >
                  <div className="friend-top">
                    <div className="avatar live" style={{ background: 'var(--accent)' }}>
                      <Icon.Headphones size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="friend-name">{r.name}</div>
                      <div className="friend-status">
                        <span className="live-dot" />{r.count || 0} слушателей · {r.state}
                      </div>
                    </div>
                  </div>
                  {r.track && (
                    <div className="friend-track">
                      <div className="friend-cover" style={coverStyle(r.id)} />
                      <div className="friend-track-meta">
                        <div className="friend-track-title">{r.track}</div>
                        <div className="friend-track-artist">Хост: {r.hostName || '?'}</div>
                      </div>
                      {r.state === 'PLAYING' && <Eq />}
                    </div>
                  )}
                </div>
              ))
        )}
      </div>
    </div>
  );
}
