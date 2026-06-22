import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, streamUrl, voteQueueItem } from '@/lib/api';

const originalFetch = globalThis.fetch;

function mockFetch(response: Partial<Response>) {
  const r = {
    ok: response.status ? response.status < 400 : true,
    status: response.status ?? 200,
    json: () => Promise.resolve((response as any)._body ?? {}),
    ...response,
  } as unknown as Response;
  globalThis.fetch = vi.fn().mockResolvedValue(r) as any;
}

beforeEach(() => {
  delete (globalThis as any).window;
  (globalThis as any).window = { location: { pathname: '/' } };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('api()', () => {
  it('adds JSON headers, prefixes /api, and parses JSON response', async () => {
    mockFetch({ status: 200, _body: { ok: true } } as any);
    const out = await api<{ ok: boolean }>('GET', '/tracks');
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('/api/tracks');
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('GET');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');
    expect(out.ok).toBe(true);
  });

  it('returns null for 204 No Content', async () => {
    mockFetch({ status: 204 });
    const out = await api('POST', '/rooms/x/leave');
    expect(out).toBeNull();
  });

  it('throws and redirects to /login on 401 (outside /login)', async () => {
    (window as any).location = { pathname: '/', href: '/' };
    mockFetch({ status: 401, _body: { error: 'nope' } } as any);
    await expect(api('GET', '/auth/me')).rejects.toThrow();
    expect((window as any).location.href).toBe('/login');
  });

  it('throws with server error message when ok=false', async () => {
    mockFetch({ status: 400, _body: { error: 'bad input' } } as any);
    await expect(api('POST', '/rooms', { name: '' })).rejects.toThrow('bad input');
  });
});

describe('streamUrl()', () => {
  it('builds same-origin stream path', () => {
    expect(streamUrl('abc-123')).toBe('/api/stream/abc-123');
  });
});

describe('voteQueueItem()', () => {
  it('POSTs to room queue vote endpoint and returns voted bool', async () => {
    mockFetch({ status: 200, _body: { voted: true } } as any);
    const voted = await voteQueueItem('room-1', 'q-99');
    expect(voted).toBe(true);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('/api/rooms/room-1/queue/q-99/vote');
    expect(init.method).toBe('POST');
  });
});
