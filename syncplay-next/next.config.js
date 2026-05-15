/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Strict Mode double-mounts every effect in dev which (a) breaks our destroyedRef
  // guard for the WS connect flow, (b) opens two WS connections on every page load.
  // The trade-off (catching async-cleanup bugs early) isn't worth the breakage now.
  reactStrictMode: false,
  async rewrites() {
    // ВАЖНО: переменная БЕЗ префикса NEXT_PUBLIC_, иначе Next.js запечёт её
    // значение на этапе `next build` (когда она ещё не задана) и в рантайме
    // всегда будет fallback `http://localhost:8080`. Без префикса — читается
    // из env контейнера при старте сервера.
    const apiUrl = process.env.API_URL || 'http://localhost:8080';
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
    ];
  },
};
module.exports = nextConfig;
