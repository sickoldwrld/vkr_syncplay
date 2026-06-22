import type { TrackMeta } from './types';

const SPRING_URL = process.env.SPRING_URL ?? 'http://spring:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'syncplay-internal-secret';
// Load-test gate: when BENCH_AUTH=1, accept tokens of the form `u:<userId>`
// and skip the round-trip to Spring. Off by default — never set this in prod.
const BENCH_AUTH = process.env.BENCH_AUTH === '1';

export interface AuthUser {
  id: string;
  username: string;
}

const internalHeaders: Record<string, string> = {
  'X-Internal-Secret': INTERNAL_SECRET,
  'Content-Type': 'application/json',
};

export type AuthFailure = 'no-cookie' | 'fetch-error' | 'unauthorized';

export async function validateSession(cookie: string): Promise<AuthUser | AuthFailure> {
  if (!cookie) {
    console.log('[auth] no cookie header on WS upgrade');
    return 'no-cookie';
  }
  const jsessionPresent = /JSESSIONID=/.test(cookie);
  console.log(`[auth] cookie len=${cookie.length} JSESSIONID=${jsessionPresent ? 'present' : 'MISSING'}`);
  try {
    const res = await fetch(`${SPRING_URL}/api/auth/me`, { headers: { cookie } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.log(`[auth] /api/auth/me → ${res.status} ${body.slice(0, 100)}`);
      return 'unauthorized';
    }
    const user = (await res.json()) as AuthUser;
    console.log(`[auth] validated user=${user.id} (${user.username}) via cookie`);
    return user;
  } catch (e: any) {
    console.error(`[auth] fetch ${SPRING_URL}/api/auth/me failed:`, e?.message || e);
    return 'fetch-error';
  }
}

/** Consume a one-time WS token via the internal endpoint. */
export async function validateWsToken(token: string): Promise<AuthUser | AuthFailure> {
  if (!token) return 'no-cookie';
  // Load-test bypass: `u:<userId>` tokens map straight to a fake user.
  // Only enabled when BENCH_AUTH=1 is set on the server.
  if (BENCH_AUTH && token.startsWith('u:')) {
    const id = token.slice(2);
    return { id, username: id };
  }
  try {
    const res = await fetch(`${SPRING_URL}/internal/ws-token/${encodeURIComponent(token)}`, {
      headers: internalHeaders,
    });
    if (!res.ok) {
      console.log(`[auth] ws-token ${token.slice(0, 8)}… → ${res.status} (invalid/expired)`);
      return 'unauthorized';
    }
    const user = (await res.json()) as AuthUser;
    console.log(`[auth] validated user=${user.id} (${user.username}) via ws-token`);
    return user;
  } catch (e: any) {
    console.error(`[auth] ws-token fetch failed:`, e?.message || e);
    return 'fetch-error';
  }
}

export async function fetchRoomDetail(roomId: string): Promise<{ id: string; hostId: string; hostIds?: string[] } | null> {
  // Load-test bypass: synthesize a room detail so the WS connect can complete
  // without a running Spring. The first connecting user effectively becomes
  // host (`__bootstrap__` is normalized in the handler).
  if (BENCH_AUTH) return { id: roomId, hostId: '__bootstrap__', hostIds: [] };
  try {
    const res = await fetch(`${SPRING_URL}/internal/rooms/${roomId}/detail`, { headers: internalHeaders });
    if (!res.ok) return null;
    return (await res.json()) as { id: string; hostId: string; hostIds?: string[] };
  } catch {
    return null;
  }
}

export async function popNextTrack(roomId: string): Promise<TrackMeta | null> {
  try {
    const res = await fetch(`${SPRING_URL}/internal/rooms/${roomId}/queue/pop`, {
      method: 'POST',
      headers: internalHeaders,
    });
    if (res.status === 204 || !res.ok) return null;
    return (await res.json()) as TrackMeta;
  } catch {
    return null;
  }
}
