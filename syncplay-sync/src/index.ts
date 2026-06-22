import http, { IncomingMessage, ServerResponse } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { handleConnection } from './handler';
import { updateHosts, kickUser } from './roomManager';

const PORT = Number(process.env.PORT ?? 3002);
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'syncplay-internal-secret';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleInternal(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== 'POST') return false;
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    const m = req.url?.match(/^\/internal\/rooms\//);
    if (!m) return false;
    res.writeHead(403); res.end(); return true;
  }

  // POST /internal/rooms/:id/hosts — invalidate in-memory host set after Spring
  // promotes/demotes a co-host.
  const hostsMatch = req.url?.match(/^\/internal\/rooms\/([^/]+)\/hosts$/);
  if (hostsMatch) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { primaryHostId?: string; hostIds?: string[] };
      if (!parsed.primaryHostId || !Array.isArray(parsed.hostIds)) {
        res.writeHead(400); res.end(); return true;
      }
      const ok = updateHosts(hostsMatch[1], parsed.primaryHostId, parsed.hostIds);
      res.writeHead(ok ? 204 : 404); res.end();
    } catch {
      res.writeHead(400); res.end();
    }
    return true;
  }

  // POST /internal/rooms/:id/kick — force-close every WS connection of userId.
  const kickMatch = req.url?.match(/^\/internal\/rooms\/([^/]+)\/kick$/);
  if (kickMatch) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { userId?: string };
      if (!parsed.userId) { res.writeHead(400); res.end(); return true; }
      const ok = kickUser(kickMatch[1], parsed.userId);
      res.writeHead(ok ? 204 : 404); res.end();
    } catch {
      res.writeHead(400); res.end();
    }
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (await handleInternal(req, res)) return;
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  handleConnection(ws, req).catch(err => {
    console.error('WS connection error:', err);
    if (ws.readyState === ws.OPEN) ws.close(1011, 'Internal error');
  });
});

server.listen(PORT, () => {
  console.log(`syncplay-sync listening on :${PORT}`);
});
