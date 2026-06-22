'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';

/**
 * Простая toast-система. Используется вместо alert() — alert блокирует UI
 * и выглядит как браузерное предупреждение, а toast вписывается в дизайн.
 *
 * Использование:
 *   const toast = useToast();
 *   toast.error('Не удалось добавить друга');
 *   toast.success('Трек загружен');
 *   toast.info('Скопировано в буфер');
 */
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }

interface ToastCtx {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((arr) => arr.filter((t) => t.id !== id));
    const tm = timersRef.current.get(id);
    if (tm) { clearTimeout(tm); timersRef.current.delete(id); }
  }, []);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = nextId++;
    setItems((arr) => [...arr, { id, kind, text }]);
    const tm = setTimeout(() => dismiss(id), 4000);
    timersRef.current.set(id, tm);
  }, [dismiss]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const value: ToastCtx = {
    success: (t) => push('success', t),
    error:   (t) => push('error', t),
    info:    (t) => push('info', t),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(420px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}>
        {items.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              background: 'rgba(20, 20, 30, 0.95)',
              backdropFilter: 'blur(10px)',
              color: t.kind === 'error'   ? 'oklch(0.75 0.2 30)'
                  : t.kind === 'success' ? 'oklch(0.85 0.15 140)'
                  : 'oklch(0.85 0.05 240)',
              border: `1px solid ${
                t.kind === 'error'   ? 'oklch(0.65 0.2 30 / 0.45)' :
                t.kind === 'success' ? 'oklch(0.65 0.18 140 / 0.45)' :
                                       'oklch(0.65 0.1 240 / 0.45)'}`,
              fontSize: 13,
              fontWeight: 500,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              cursor: 'pointer',
              pointerEvents: 'auto',
              animation: 'toast-in 0.18s ease-out',
              wordBreak: 'break-word',
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) {
    // Fallback на случай если ToastProvider не подключен: используем console
    return {
      success: (t) => console.log('[toast/success]', t),
      error:   (t) => console.warn('[toast/error]', t),
      info:    (t) => console.log('[toast/info]', t),
    };
  }
  return v;
}
