'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import LeftColumn from '@/components/LeftColumn';
import CenterColumn from '@/components/CenterColumn';
import RightColumn from '@/components/RightColumn';
import Player from '@/components/Player';
import PlaylistView from '@/components/PlaylistView';
import TweaksPanel, { useTweaks } from '@/components/TweaksPanel';
import { Icon } from '@/components/Icons';
import MobileApp from '@/components/mobile/MobileApp';
import { useIsMobile } from '@/components/mobile/useIsMobile';
import { getMe, logout, streamUrl, api } from '@/lib/api';

interface Track {
  id: string; title: string; artist: string;
  durationMs: number; liked?: boolean; coverKey?: string | null;
}

type RepeatMode = 'off' | 'all' | 'one';

export default function HomePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [leftRefresh, setLeftRefresh] = useState(0);
  const [openPl, setOpenPl] = useState<{ id: string; name: string; isPublic: boolean; readOnly?: boolean } | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [tweaks, setTweaks] = useTweaks();
  const isMobile = useIsMobile();

  // Контекст воспроизведения
  const [queue, setQueue] = useState<Track[]>([]);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [volume, setVolume] = useState(1);

  const audioRef = useRef<HTMLAudioElement>(null);
  const trackStartRef = useRef<number>(0);
  const lastTrackIdRef = useRef<string | null>(null);
  // Стабильные ссылки для onEnd, чтобы не перерегистрировать listener при каждом изменении queue
  const queueRef = useRef<Track[]>([]);
  const currentTrackRef = useRef<Track | null>(null);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>('off');
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);

  // Start mobile with panels closed
  useEffect(() => {
    if (window.innerWidth <= 640) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, []);

  // Auth
  useEffect(() => {
    (async () => {
      const me = await getMe();
      if (!me) { router.replace('/login'); return; }
      setAuthed(true);
    })();
  }, [router]);

  // Восстановить громкость и shuffle/repeat из localStorage
  useEffect(() => {
    try {
      const v = localStorage.getItem('syncplay.volume');
      if (v !== null) setVolume(Math.max(0, Math.min(1, parseFloat(v))));
      const s = localStorage.getItem('syncplay.shuffle');
      if (s !== null) setShuffle(s === '1');
      const r = localStorage.getItem('syncplay.repeat');
      if (r === 'off' || r === 'all' || r === 'one') setRepeat(r);
    } catch {}
  }, []);

  // Применять громкость к audio
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    try { localStorage.setItem('syncplay.volume', String(volume)); } catch {}
  }, [volume]);
  useEffect(() => { try { localStorage.setItem('syncplay.shuffle', shuffle ? '1' : '0'); } catch {} }, [shuffle]);
  useEffect(() => { try { localStorage.setItem('syncplay.repeat', repeat); } catch {} }, [repeat]);

  // Heartbeat presence (раз в 20с пока активна вкладка)
  useEffect(() => {
    if (!authed) return;
    let timer: any = null;
    function ping() {
      if (document.visibilityState !== 'visible') return;
      api('POST', '/auth/ping').catch(() => {});
    }
    ping();
    timer = setInterval(ping, 20000);
    return () => clearInterval(timer);
  }, [authed]);

  // Запись истории при закрытии вкладки
  useEffect(() => {
    function recordHistory() {
      if (!lastTrackIdRef.current) return;
      const playedMs = Date.now() - trackStartRef.current;
      navigator.sendBeacon(
        '/api/history',
        new Blob(
          [JSON.stringify({ trackId: lastTrackIdRef.current, durationMs: playedMs })],
          { type: 'application/json' },
        )
      );
      lastTrackIdRef.current = null;
    }
    window.addEventListener('beforeunload', recordHistory);
    return () => {
      recordHistory();
      window.removeEventListener('beforeunload', recordHistory);
    };
  }, []);

  // Помощник: следующий индекс с учётом shuffle/repeat
  const pickNextIndex = useCallback((curIdx: number, len: number): number | null => {
    if (len === 0) return null;
    if (shuffleRef.current && len > 1) {
      let i = Math.floor(Math.random() * len);
      if (i === curIdx) i = (i + 1) % len;
      return i;
    }
    const next = curIdx + 1;
    if (next >= len) return repeatRef.current === 'all' ? 0 : null;
    return next;
  }, []);

  const playInternal = useCallback((track: Track) => {
    if (!audioRef.current) return;
    if (lastTrackIdRef.current && lastTrackIdRef.current !== track.id) {
      const playedMs = Date.now() - trackStartRef.current;
      api('POST', '/history', { trackId: lastTrackIdRef.current, durationMs: playedMs }).catch(() => {});
    }
    setCurrentTrack(track);
    audioRef.current.src = streamUrl(track.id);
    audioRef.current.play().catch(() => {});
    setPlaying(true);
    trackStartRef.current = Date.now();
    lastTrackIdRef.current = track.id;
  }, []);

  // Audio events
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const onTime = () => { if (!isNaN(a.duration)) { setProgress(a.currentTime); setDuration(a.duration); } };
    const onEnd = () => {
      // История
      const cur = currentTrackRef.current;
      if (cur) {
        api('POST', '/history', { trackId: cur.id, durationMs: Math.round(a.duration * 1000) }).catch(() => {});
      }
      // Repeat-one — повторить тот же трек
      if (repeatRef.current === 'one' && cur) {
        a.currentTime = 0;
        a.play().catch(() => {});
        setPlaying(true);
        trackStartRef.current = Date.now();
        return;
      }
      // Иначе — следующий из очереди
      const q = queueRef.current;
      if (cur && q.length > 0) {
        const idx = q.findIndex(t => t.id === cur.id);
        const ni = pickNextIndex(idx, q.length);
        if (ni !== null) {
          playInternal(q[ni]);
          return;
        }
      }
      setPlaying(false);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); };
  }, [pickNextIndex, playInternal]);

  // Главный play(): принимает track + опциональный context-список
  function play(track: Track, list?: Track[]) {
    if (!audioRef.current) return;
    if (currentTrack?.id === track.id) { togglePlay(); return; }
    if (list && list.length > 0) setQueue(list);
    playInternal(track);
  }

  function togglePlay() {
    const a = audioRef.current; if (!a || !currentTrack) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  }

  function seek(sec: number) {
    if (audioRef.current) audioRef.current.currentTime = sec;
  }

  function playNext() {
    const q = queueRef.current;
    const cur = currentTrackRef.current;
    if (!cur || q.length === 0) return;
    const idx = q.findIndex(t => t.id === cur.id);
    const ni = pickNextIndex(idx, q.length);
    if (ni !== null) playInternal(q[ni]);
  }

  function playPrev() {
    const a = audioRef.current;
    // Если играем больше 3 секунд — просто перематываем в начало (как Spotify)
    if (a && a.currentTime > 3) { a.currentTime = 0; return; }
    const q = queueRef.current;
    const cur = currentTrackRef.current;
    if (!cur || q.length === 0) return;
    const idx = q.findIndex(t => t.id === cur.id);
    const prev = idx <= 0 ? (repeatRef.current === 'all' ? q.length - 1 : 0) : idx - 1;
    playInternal(q[prev]);
  }

  function toggleShuffle() { setShuffle(s => !s); }
  function cycleRepeat() {
    setRepeat(r => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off');
  }

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  async function refreshLikedStatus() {
    if (!currentTrack) return;
    try {
      const tracks = await api<Track[]>('GET', '/tracks');
      const updated = tracks.find(t => t.id === currentTrack.id);
      if (updated) setCurrentTrack(updated);
    } catch {}
    setRefreshSignal(s => s + 1);
    setLeftRefresh(s => s + 1);
  }

  const layoutClass = ['columns',
    leftOpen ? '' : 'left-hidden',
    rightOpen ? '' : 'right-hidden',
  ].filter(Boolean).join(' ');

  if (!authed) return null;

  if (isMobile) {
    return (
      <>
        <MobileApp
          currentTrack={currentTrack}
          playing={playing}
          progressSec={progress}
          durationSec={duration}
          onPlay={play}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onNext={playNext}
          onPrev={playPrev}
          onLikeChanged={refreshLikedStatus}
        />
        <audio ref={audioRef} preload="auto" />
      </>
    );
  }

  return (
    <div className="app">
      <button onClick={handleLogout} title="Выйти" className="profile-btn">
        <Icon.Logout size={16} />
      </button>
      <button
        onClick={() => setTweaksOpen(o => !o)}
        title="Темы и настройки"
        className="profile-btn"
        style={{ top: 56 }}
      >
        <Icon.Sliders size={16} />
      </button>

      <button
        className="toggle-btn toggle-left"
        onClick={() => setLeftOpen(o => !o)}
        title={leftOpen ? 'Скрыть библиотеку' : 'Показать библиотеку'}
      >
        {leftOpen ? <Icon.ChevronLeft size={14} /> : <Icon.ChevronRight size={14} />}
      </button>
      <button
        className="toggle-btn toggle-right"
        onClick={() => setRightOpen(o => !o)}
        title={rightOpen ? 'Скрыть друзей' : 'Показать друзей'}
      >
        {rightOpen ? <Icon.ChevronRight size={14} /> : <Icon.ChevronLeft size={14} />}
      </button>

      {/* Mobile scrim — closes drawers on tap */}
      <div
        className={`drawer-scrim${(leftOpen || rightOpen) ? ' open' : ''}`}
        onClick={() => { setLeftOpen(false); setRightOpen(false); }}
        aria-hidden
      />

      <div className={layoutClass}>
        <LeftColumn
          refreshKey={leftRefresh}
          onPlayTrack={play}
          onOpenPlaylist={(id, name, isPublic) => setOpenPl({ id, name, isPublic })}
        />
        <CenterColumn
          onPlay={play}
          currentTrackId={currentTrack?.id || null}
          isPlaying={playing}
          refreshSignal={refreshSignal}
          onRefreshLeft={() => setLeftRefresh(s => s + 1)}
          onOpenPlaylist={(id, name, isPublic, readOnly) => setOpenPl({ id, name, isPublic, readOnly })}
        />
        <RightColumn />
      </div>

      <Player
        track={currentTrack}
        playing={playing}
        progressSec={progress}
        durationSec={duration}
        onTogglePlay={togglePlay}
        onSeek={seek}
        onLikeChanged={refreshLikedStatus}
        onNext={playNext}
        onPrev={playPrev}
        shuffle={shuffle}
        onShuffle={toggleShuffle}
        repeat={repeat}
        onRepeat={cycleRepeat}
        volume={volume}
        onVolumeChange={setVolume}
      />

      <audio ref={audioRef} preload="auto" />

      {openPl && (
        <PlaylistView
          playlistId={openPl.id}
          playlistName={openPl.name}
          isPublic={openPl.isPublic}
          readOnly={openPl.readOnly}
          onClose={() => setOpenPl(null)}
          onPlay={play}
          onChanged={() => { setLeftRefresh(s => s + 1); setRefreshSignal(s => s + 1); }}
        />
      )}

      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        state={tweaks}
        setState={setTweaks}
      />
    </div>
  );
}
