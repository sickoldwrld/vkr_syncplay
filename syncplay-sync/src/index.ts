import http, { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { handleConnection } from './handler';

const PORT = Number(process.env.PORT ?? 3002);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
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
