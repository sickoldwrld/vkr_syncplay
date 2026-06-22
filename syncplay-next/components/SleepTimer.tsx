'use client';
import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';

interface Props {
  /** Любое действие которое останавливает воспроизведение (например cmd('PAUSE_COMMAND') у хоста или audio.pause() в плеере). */
  onTrigger: () => void;
  /** Опциональный обработчик для fade-out в последние 10с. По дефолту регулируем `audio.volume` если есть. */
  onPreFade?: (factor: number) => void;
}

const PRESETS_MIN = [15, 30, 60, 90] as const;

/**
 * Sleep Timer кнопка. По клику открывает меню выбора 15/30/60/90 мин или отмены.
 * После заведения таймера — отсчитывает оставшееся время, в последние 10с
 * вызывает onPreFade с factor 1.0 → 0.0 (если задан). По истечении вызывает
 * onTrigger и показывает toast.
 */
export default function SleepTimer({ onTrigger, onPreFade }: Props) {
  const [open, setOpen] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remainingMin, setRemainingMin] = useState<number>(0);
  const fadeTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  // Tick раз в секунду пока активен — обновляем remaining и делаем fade в конце
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const left = endsAt - Date.now();
      if (left <= 0) return;
      setRemainingMin(Math.ceil(left / 60_000));
      if (left < 10_000 && onPreFade) {
        onPreFade(left / 10_000);
      }
    };
    tick();
    fadeTickRef.current = setInterval(tick, 1000);
    return () => {
      if (fadeTickRef.current) clearInterval(fadeTickRef.current);
    };
  }, [endsAt, onPreFade]);

  function start(minutes: number) {
    cancel();
    const at = Date.now() + minutes * 60_000;
    setEndsAt(at);
    setRemainingMin(minutes);
    setOpen(false);
    toast.info(`Sleep timer: остановка через ${minutes} мин`);
    triggerRef.current = setTimeout(() => {
      onTrigger();
      if (onPreFade) onPreFade(1.0); // вернуть громкость
      setEndsAt(null);
      setRemainingMin(0);
      toast.info('Sleep timer сработал');
    }, minutes * 60_000);
  }

  function cancel() {
    if (triggerRef.current) { clearTimeout(triggerRef.current); triggerRef.current = null; }
    if (fadeTickRef.current) { clearInterval(fadeTickRef.current); fadeTickRef.current = null; }
    if (onPreFade) onPreFade(1.0); // восстановить громкость на случай если успели подзатухнуть
    setEndsAt(null);
    setRemainingMin(0);
  }

  // Cleanup при размонтировании
  useEffect(() => () => cancel(), []);

  const active = endsAt !== null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={active ? `Sleep timer: ${remainingMin} мин осталось` : 'Sleep timer'}
        style={{
          appearance: 'none',
          border: '1px solid var(--glass-border)',
          background: active ? 'oklch(0.78 0.11 var(--accent-h) / 0.18)' : 'var(--glass)',
          color: active ? 'var(--accent)' : 'var(--ink)',
          width: 36, height: 36,
          borderRadius: 14,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          cursor: 'pointer',
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 11, fontWeight: 600,
        }}
        aria-label="Sleep timer"
      >
        {active ? `${remainingMin}m` : <ZzzIcon />}
      </button>

      {open && (
        <>
          {/* scrim чтобы клик мимо закрывал */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }}
          />
          <div style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)', right: 0,
            zIndex: 60,
            padding: 8,
            minWidth: 160,
            borderRadius: 14,
            background: 'oklch(0.15 0.04 280 / 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <div style={{
              fontSize: 10, color: 'var(--ink-faint)',
              padding: '6px 10px 4px',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              fontFamily: "'Space Grotesk', sans-serif",
            }}>Остановить через</div>
            {PRESETS_MIN.map((m) => (
              <button
                key={m}
                onClick={() => start(m)}
                style={menuBtnStyle(false)}
              >{m} мин</button>
            ))}
            {active && (
              <button onClick={() => { cancel(); setOpen(false); toast.info('Sleep timer отменён'); }} style={menuBtnStyle(true)}>
                Отменить
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function menuBtnStyle(danger: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: danger ? 'oklch(0.75 0.2 30)' : 'var(--ink)',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  };
}

function ZzzIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h6L3 17h6" />
      <path d="M13 4h5l-5 8h5" />
    </svg>
  );
}
