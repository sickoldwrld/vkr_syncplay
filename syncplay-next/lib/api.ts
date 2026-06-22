'use client';

const API = '/api';

export async function api<T = any>(method: string, path: string, body?: any, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as any) };
  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
    ...init,
  });
  if (res.status === 401 || res.status === 403) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data as T;
}

export async function uploadTrack(file: File): Promise<any> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(API + '/tracks', {
    method: 'POST',
    body: fd,
    credentials: 'include',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

export function streamUrl(trackId: string): string {
  return `${API}/stream/${trackId}`;
}

/** Toggle голос за элемент очереди комнаты. Возвращает true если голос ДОБАВЛЕН. */
export async function voteQueueItem(roomId: string, queueId: string): Promise<boolean> {
  const r = await api<{ voted: boolean }>('POST', `/rooms/${roomId}/queue/${queueId}/vote`);
  return r.voted;
}

/**
 * WebSocket goes directly to Spring on port 8080 — same hostname as the page,
 * so cookies set by the API session are sent automatically (no cross-port
 * gymnastics, no auth tokens, no separate sync server).
 *
 * Works for:
 *   - localhost during dev
 *   - 192.168.x.x when iPhone hits Mac over LAN
 *   - any domain in production (assuming :8080 is reachable, or use a reverse proxy)
 */
export function connectRoomWs(roomId: string): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(`${proto}//${location.hostname}:8080/ws/room/${roomId}`);
}

export interface Me { id: string; username: string; email: string; }

export async function getMe(): Promise<Me | null> {
  try { return await api<Me>('GET', '/auth/me'); }
  catch { return null; }
}

export async function logout() {
  await fetch(API + '/auth/logout', { method: 'POST', credentials: 'include' });
}
