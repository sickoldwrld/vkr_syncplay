'use client';
import { useEffect } from 'react';

/**
 * Регистрация Service Worker'а — DISABLED.
 *
 * Старая версия SW активно кэшировала /api/* и ломала login / ws-token /
 * audio streams (см. логи: "TypeError: Failed to fetch" в sw.js).
 * Текущий /public/sw.js — kill-switch, который при загрузке делает
 * unregister себя. Этот компонент явно регистрирует kill-switch один раз
 * чтобы у клиентов которые ещё держат старый SW, тот заменился на kill
 * и сам удалился.
 *
 * После того как у всех клиентов SW удалится, можно вообще убрать вызов
 * register — но пока он стоит «на всякий случай» (хуже не будет: kill-switch
 * себя удалит снова).
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Регистрируем kill-switch — пусть он стартанёт и сам же удалится.
    // Это гарантия избавления от старых SW даже если их нельзя
    // прибить из JS (например, iOS Safari иногда не отдаёт getRegistrations).
    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => { /* ignore: kill-switch could already be inactive */ });

    // Параллельно — попытка programmatic cleanup на случай если регистрация
    // не сработала (старый SW заблокировал scope).
    navigator.serviceWorker.getRegistrations()
      .then(async (regs) => {
        if (regs.length === 0) return;
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      })
      .catch(() => {});
  }, []);

  return null;
}
