import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DriftMetricsBar, { driftBand } from '@/components/DriftIndicator';

describe('driftBand classifier', () => {
  it('returns "ok" inside ±80ms', () => {
    expect(driftBand(0)).toBe('ok');
    expect(driftBand(79)).toBe('ok');
    expect(driftBand(-50)).toBe('ok');
  });

  it('returns "warn" between 80 and 300ms', () => {
    expect(driftBand(150)).toBe('warn');
    expect(driftBand(-299)).toBe('warn');
  });

  it('returns "bad" past 300ms in either direction', () => {
    expect(driftBand(400)).toBe('bad');
    expect(driftBand(-1500)).toBe('bad');
  });
});

describe('DriftMetricsBar', () => {
  it('renders drift with sign and ms suffix', () => {
    render(
      <DriftMetricsBar
        metrics={{ rtt: 30, avg: 35, jitter: 10, offset: 5, drift: 120 }}
      />,
    );
    expect(screen.getByTestId('drift-value')).toHaveTextContent('Drift: +120ms');
  });

  it('renders negative drift without double-sign', () => {
    render(
      <DriftMetricsBar
        metrics={{ rtt: 30, avg: 35, jitter: 10, offset: 5, drift: -80 }}
      />,
    );
    expect(screen.getByTestId('drift-value')).toHaveTextContent('Drift: -80ms');
  });

  it('exposes a status LED with the band label', () => {
    render(
      <DriftMetricsBar
        metrics={{ rtt: 30, avg: 35, jitter: 10, offset: 5, drift: 500 }}
      />,
    );
    expect(screen.getByTestId('drift-led')).toHaveAttribute('aria-label', 'рассинхрон');
  });
});
