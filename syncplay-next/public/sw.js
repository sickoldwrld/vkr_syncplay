// SyncPlay Service Worker — KILL SWITCH
// ============================================================
// Старая версия SW кэшировала /api/* и из-за этого:
//  - /api/auth/ws-token падал внутри SW с TypeError: Failed to fetch
//  - /api/stream/<id> возвращал net::ERR_FAILED
//  - WebSocket не мог получить токен → "Подключаемся..." на бесконечно
//
// Этот SW при установке отключает себя, чистит все кэши, делает unregister
// и перезагружает все клиенты. После этого браузер больше никогда не будет
// перехватывать запросы — пока кто-то снова не зарегистрирует SW.
//
// Если в production снова понадобится offline-кэш — пишите новую версию,
// но обязательно с другим именем файла (например /sw-v2.js), чтобы не
// конфликтовать с этим kill-switch.
// ============================================================

self.addEventListener('install', (event) => {
  // Сразу активироваться, не ждать пока старая версия отпустит контроль
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Удалить все кэши которые мог накопить старый SW
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {
      // ignore — главное продолжить unregister
    }

    // 2. Самоуничтожение
    try {
      await self.registration.unregister();
    } catch (e) {
      // ignore
    }

    // 3. Захватить всех текущих клиентов и перезагрузить их,
    //    чтобы они переключились на работу БЕЗ Service Worker'а.
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    } catch (e) {
      // ignore
    }
  })());
});

// Сетевые запросы — НИЧЕГО не перехватываем. Браузер пойдёт напрямую.
self.addEventListener('fetch', () => {
  // намеренно пусто — fall-through к default browser behavior
});
