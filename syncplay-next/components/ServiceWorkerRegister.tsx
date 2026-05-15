'use client';
import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // SW только в production

    navigator.serviceWorker
      .register('/sw.js')
      .then(() => console.log('[SW] registered'))
      .catch((err) => console.warn('[SW] registration failed', err));
  }, []);

  return null;
}
