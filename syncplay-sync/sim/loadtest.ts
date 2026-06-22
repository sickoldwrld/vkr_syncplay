/**
 * Multi-room WS load harness for syncplay-sync (the main master-slave service
 * on :3002). Drives N rooms × M clients, records latency percentiles, and
 * samples server CPU/RSS in parallel.
 *
 * Run (from syncplay-sync/):
 *   ./loadtest.sh                          # default: ramp, ws://localhost:3002
 *   ROOMS=20 CLIENTS=10 DURATION_S=300 ./loadtest.sh
 *   SCENARIO=spike ./loadtest.sh
 *
 *   # Or compare against Kuramoto service on :3003:
 *   URL=ws://localhost:3003 MODE=kuramoto ./loadtest.sh
 *
 * Env:
 *   URL          ws endpoint                                 (default ws://localhost:3002)
 *   MODE         "master" | "kuramoto"                       (default master)
 *   ROOMS        number of rooms                             (default 5)
 *   CLIENTS      clients per room                            (default 10)
 *   DURATION_S   total test duration in seconds              (default 60)
 *   SCENARIO     "ramp" | "spike" | "steady" | "smoke"       (default ramp)
 *   PING_MS      ping cadence                                (default 800)
 *   PHASE_MS     phase report cadence (Kuramoto only)        (default 250)
 *   SERVER_PID   pid of the WS server, for resource sampling (optional)
 *   CSV          path to write a CSV of per-second metrics   (optional)
 *   TOKEN_FN     path to a JS module exporting (i) => string for real Spring
 *                ws-tokens. Without it, bots use `u:<id>` tokens which the
 *                main service rejects (1008 Unauthorized) unless
 *                BENCH_AUTH=1 is set on the server.
 */

import WebSocket from 'ws';
import { exec } from 'child_process';
import { writeFileSync } from 'fs';

const URL = process.env.URL ?? 'ws://localhost:3002';
const MODE: 'kuramoto' | 'master' = (process.env.MODE === 'kuramoto' ? 'kuramoto' : 'master');
const ROOMS = Number(process.env.ROOMS ?? 5);
const CLIENTS = Number(process.env.CLIENTS ?? 10);
const DURATION_S = Number(process.env.DURATION_S ?? 60);
const SCENARIO = process.env.SCENARIO ?? 'ramp';
const PING_MS = Number(process.env.PING_MS ?? 800);
const PHASE_MS = Number(process.env.PHASE_MS ?? 250);
const SERVER_PID = process.env.SERVER_PID ? Number(process.env.SERVER_PID) : null;
const CSV_PATH = process.env.CSV ?? '';

const TOTAL = ROOMS * CLIENTS;

interface PingSample { t: number; rtt: number; }
interface Bot {
  ws: WebSocket;
  roomId: string;
  userId: string;
  positionMs: number;
  rateSkewPpm: number;
  pings: PingSample[];
  pendingPings: Map<number, number>;
  errors: number;
  reconnects: number;
  msgsRcv: number;
  msgsSnt: number;
  connectedAt: number | null;
  connectStart: number;
}
const bots: Bot[] = [];

function rand(): number { return Math.random(); }
function pctl(arr: number[], q: number): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

function makeBot(roomIdx: number, clientIdx: number): Bot {
  const userId = `lt-r${roomIdx}-c${clientIdx}`;
  const roomId = `loadtest-${roomIdx}`;
  const ws = new WebSocket(`${URL}/ws/room/${roomId}?token=u:${userId}`);
  const bot: Bot = {
    ws,
    roomId,
    userId,
    positionMs: rand() * 1000,
    rateSkewPpm: (rand() * 2 - 1) * 100e-6, // ±100 ppm
    pings: [],
    pendingPings: new Map(),
    errors: 0,
    reconnects: 0,
    msgsRcv: 0,
    msgsSnt: 0,
    connectedAt: null,
    connectStart: Date.now(),
  };
  ws.on('open', () => { bot.connectedAt = Date.now(); });
  ws.on('message', raw => {
    bot.msgsRcv++;
    let msg: { type?: string; clientTimestamp?: number; serverTimestamp?: number };
    try { msg = JSON.parse(raw.toString()); } catch { bot.errors++; return; }
    if (msg.type === 'PONG' && typeof msg.clientTimestamp === 'number') {
      const sentAt = bot.pendingPings.get(msg.clientTimestamp);
      if (sentAt) {
        const rtt = Date.now() - sentAt;
        bot.pings.push({ t: Date.now(), rtt });
        bot.pendingPings.delete(msg.clientTimestamp);
      }
    }
  });
  ws.on('error', () => { bot.errors++; });
  ws.on('close', () => { bot.connectedAt = null; });
  return bot;
}

function send(bot: Bot, msg: object): void {
  if (bot.ws.readyState !== WebSocket.OPEN) return;
  try { bot.ws.send(JSON.stringify(msg)); bot.msgsSnt++; } catch { bot.errors++; }
}

// ─── Scenarios: schedule when each bot starts ──────────────
type Scenario = (idx: number, total: number, durationMs: number) => number; // returns delay ms
const SCENARIOS: Record<string, Scenario> = {
  smoke:  () => 0,
  spike:  () => 0,
  steady: () => 0,
  // Ramp: spread connections linearly over the first 60% of the test
  ramp:   (i, n, dur) => Math.floor((i / n) * dur * 0.6),
};

// ─── Server resource sampler ───────────────────────────────
interface Sample { tMs: number; cpu: number; rssKb: number; fds: number; clients: number; pingsRtt50: number; pingsRtt95: number; errors: number; }
const samples: Sample[] = [];

function sampleServer(): Promise<{ cpu: number; rssKb: number; fds: number }> {
  return new Promise(resolve => {
    if (!SERVER_PID) { resolve({ cpu: NaN, rssKb: NaN, fds: NaN }); return; }
    exec(`ps -p ${SERVER_PID} -o %cpu=,rss= && lsof -p ${SERVER_PID} 2>/dev/null | wc -l`, (err, out) => {
      if (err) { resolve({ cpu: NaN, rssKb: NaN, fds: NaN }); return; }
      const lines = out.trim().split('\n');
      const [cpuStr, rssStr] = lines[0].trim().split(/\s+/);
      const fdsStr = lines[1]?.trim() ?? '0';
      resolve({ cpu: Number(cpuStr), rssKb: Number(rssStr), fds: Number(fdsStr) });
    });
  });
}

function aggregateLastSecond(): { rtt50: number; rtt95: number; errors: number; clients: number } {
  const now = Date.now();
  const cutoff = now - 1000;
  const recent: number[] = [];
  let errors = 0, alive = 0;
  for (const b of bots) {
    if (b.ws.readyState === WebSocket.OPEN) alive++;
    errors += b.errors;
    for (let i = b.pings.length - 1; i >= 0 && b.pings[i].t > cutoff; i--) recent.push(b.pings[i].rtt);
  }
  return { rtt50: pctl(recent, 0.50), rtt95: pctl(recent, 0.95), errors, clients: alive };
}

// ─── Main ───────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`Load test: ${MODE} @ ${URL}`);
  console.log(`  ${ROOMS} rooms × ${CLIENTS} clients = ${TOTAL} bots, scenario=${SCENARIO}, duration=${DURATION_S}s`);
  if (SERVER_PID) console.log(`  sampling server pid ${SERVER_PID} (cpu / rss / fds)`);

  const durationMs = DURATION_S * 1000;
  const scenarioFn = SCENARIOS[SCENARIO] ?? SCENARIOS.ramp;

  // Schedule bot connects
  for (let r = 0; r < ROOMS; r++) {
    for (let c = 0; c < CLIENTS; c++) {
      const idx = r * CLIENTS + c;
      const delay = scenarioFn(idx, TOTAL, durationMs);
      setTimeout(() => {
        const bot = makeBot(r, c);
        bots.push(bot);
        // Per-bot ping loop
        const pingLoop = setInterval(() => {
          if (bot.ws.readyState !== WebSocket.OPEN) return;
          const ts = Date.now();
          bot.pendingPings.set(ts, ts);
          send(bot, { type: 'PING', clientTimestamp: ts });
          // Drop stale pending pings to avoid memory growth
          if (bot.pendingPings.size > 30) {
            const oldest = Math.min(...bot.pendingPings.keys());
            bot.pendingPings.delete(oldest);
          }
        }, PING_MS);
        // Kuramoto: send PHASE_REPORT
        let phaseLoop: NodeJS.Timeout | null = null;
        if (MODE === 'kuramoto') {
          phaseLoop = setInterval(() => {
            if (bot.ws.readyState !== WebSocket.OPEN) return;
            bot.positionMs += PHASE_MS * (1 + bot.rateSkewPpm);
            send(bot, { type: 'PHASE_REPORT', positionMs: bot.positionMs, sampledAt: Date.now() });
          }, PHASE_MS);
        }
        bot.ws.on('close', () => {
          clearInterval(pingLoop);
          if (phaseLoop) clearInterval(phaseLoop);
        });
      }, delay);
    }
  }

  // Per-second sampler
  const startWall = Date.now();
  const sampler = setInterval(async () => {
    const t = Date.now() - startWall;
    const srv = await sampleServer();
    const agg = aggregateLastSecond();
    const sample: Sample = {
      tMs: t,
      cpu: srv.cpu,
      rssKb: srv.rssKb,
      fds: srv.fds,
      clients: agg.clients,
      pingsRtt50: agg.rtt50,
      pingsRtt95: agg.rtt95,
      errors: agg.errors,
    };
    samples.push(sample);
    const cpuStr = isNaN(sample.cpu) ? '   -' : sample.cpu.toFixed(1).padStart(5);
    const rssStr = isNaN(sample.rssKb) ? '    -' : `${Math.round(sample.rssKb / 1024)}M`.padStart(5);
    const fdsStr = isNaN(sample.fds) ? '   -' : String(sample.fds).padStart(5);
    console.log(
      `t=${(t/1000).toFixed(0).padStart(4)}s  clients=${String(sample.clients).padStart(4)}/${TOTAL}  ` +
      `rtt p50=${(sample.pingsRtt50||0).toFixed(0).padStart(4)}ms p95=${(sample.pingsRtt95||0).toFixed(0).padStart(4)}ms  ` +
      `errs=${String(sample.errors).padStart(4)}  cpu=${cpuStr}%  rss=${rssStr}  fds=${fdsStr}`
    );
  }, 1000);

  // Stop after duration
  await new Promise(r => setTimeout(r, durationMs));
  clearInterval(sampler);

  // Final summary
  console.log('\n── Summary ──────────────────────────────────────');
  const allRtts: number[] = [];
  let totalErrors = 0, totalReconnects = 0, connectTimes: number[] = [];
  for (const b of bots) {
    for (const p of b.pings) allRtts.push(p.rtt);
    totalErrors += b.errors;
    totalReconnects += b.reconnects;
    if (b.connectedAt) connectTimes.push(b.connectedAt - b.connectStart);
  }
  console.log(`connects (n=${connectTimes.length}):  p50=${pctl(connectTimes, 0.5).toFixed(0)}ms  p95=${pctl(connectTimes, 0.95).toFixed(0)}ms  max=${Math.max(...connectTimes, 0)}ms`);
  console.log(`ping rtt (n=${allRtts.length}):  p50=${pctl(allRtts, 0.5).toFixed(0)}ms  p95=${pctl(allRtts, 0.95).toFixed(0)}ms  p99=${pctl(allRtts, 0.99).toFixed(0)}ms`);
  console.log(`errors (sum across bots): ${totalErrors}`);
  console.log(`reconnects: ${totalReconnects}`);
  const finalSample = samples[samples.length - 1];
  if (finalSample && !isNaN(finalSample.cpu)) {
    const peakCpu = Math.max(...samples.map(s => s.cpu).filter(c => !isNaN(c)));
    const peakRss = Math.max(...samples.map(s => s.rssKb).filter(c => !isNaN(c)));
    const peakFds = Math.max(...samples.map(s => s.fds).filter(c => !isNaN(c)));
    console.log(`server peaks:  cpu=${peakCpu.toFixed(1)}%  rss=${Math.round(peakRss/1024)}MB  fds=${peakFds}`);
  }

  if (CSV_PATH) {
    const lines = ['tMs,clients,rtt_p50,rtt_p95,errors,cpu,rss_kb,fds'];
    for (const s of samples) lines.push([s.tMs, s.clients, s.pingsRtt50, s.pingsRtt95, s.errors, s.cpu, s.rssKb, s.fds].join(','));
    writeFileSync(CSV_PATH, lines.join('\n'));
    console.log(`csv: ${CSV_PATH}`);
  }

  // Disconnect everyone
  for (const b of bots) try { b.ws.close(); } catch {}
  setTimeout(() => process.exit(0), 500);
}

main().catch(err => { console.error(err); process.exit(1); });
