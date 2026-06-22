'use client';

export interface DriftMetrics {
  rtt: number;
  avg: number;
  jitter: number;
  offset: number;
  drift: number;
}

/**
 * Real-time clock-quality bar shown above the player.
 *
 * `drift` is the signed difference (ms) between the local audio.currentTime
 * and the server-expected position. Coloured according to perceptual bands:
 *   |drift| < 80ms   — green ("в синхроне")
 *   80–300ms         — yellow ("дрейф")
 *   > 300ms          — red ("рассинхрон")
 * Jitter uses the same thresholds (typical, not worst-case).
 */
function driftBand(ms: number): 'ok' | 'warn' | 'bad' {
  const a = Math.abs(ms);
  if (a < 80) return 'ok';
  if (a < 300) return 'warn';
  return 'bad';
}

const BAND_COLOR: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'oklch(0.85 0.15 140)',
  warn: 'oklch(0.85 0.18 90)',
  bad: 'oklch(0.7 0.2 30)',
};

const BAND_LABEL: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'в синхроне',
  warn: 'дрейф',
  bad: 'рассинхрон',
};

export default function DriftMetricsBar({ metrics }: { metrics: DriftMetrics }) {
  const driftBandKey = driftBand(metrics.drift);
  const jitterBandKey = metrics.jitter < 40 ? 'ok' : metrics.jitter < 120 ? 'warn' : 'bad';
  return (
    <div
      className="glass metrics-bar"
      data-testid="drift-bar"
      style={{
        marginBottom: 16, borderRadius: 12, overflowX: 'auto', whiteSpace: 'nowrap',
        display: 'flex', gap: 14, alignItems: 'center', padding: '8px 14px',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          data-testid="drift-led"
          aria-label={BAND_LABEL[driftBandKey]}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: BAND_COLOR[driftBandKey],
            boxShadow: `0 0 6px ${BAND_COLOR[driftBandKey]}`,
          }}
        />
        <span data-testid="drift-value" style={{ color: BAND_COLOR[driftBandKey], fontWeight: 600 }}>
          Drift: {metrics.drift >= 0 ? '+' : ''}{metrics.drift}ms
        </span>
        <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>· {BAND_LABEL[driftBandKey]}</span>
      </span>
      <span style={{ color: 'var(--ink-faint)' }}>|</span>
      <span>RTT: <span style={{ color: 'oklch(0.85 0.15 140)' }}>{metrics.rtt}ms</span></span>
      <span>Avg: {metrics.avg}ms</span>
      <span>
        Jitter: <span style={{ color: BAND_COLOR[jitterBandKey] }}>{metrics.jitter}ms</span>
      </span>
      <span>Offset: {metrics.offset}ms</span>
    </div>
  );
}

export { driftBand };
