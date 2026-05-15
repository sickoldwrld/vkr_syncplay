'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icons';

type Theme = 'mesh' | 'aurora' | 'sunset' | 'midnight';
type Density = 'airy' | 'balanced' | 'dense';

interface TweaksState {
  theme: Theme;
  accentHue: number;
  density: Density;
}

const DEFAULTS: TweaksState = { theme: 'mesh', accentHue: 300, density: 'balanced' };

const THEMES: { id: Theme; label: string; cols: [string, string, string] }[] = [
  { id: 'mesh',     label: 'Mesh',     cols: ['oklch(0.62 0.24 310)', 'oklch(0.65 0.22 200)', 'oklch(0.58 0.25 340)'] },
  { id: 'aurora',   label: 'Aurora',   cols: ['oklch(0.6 0.22 280)',  'oklch(0.7 0.18 190)',  'oklch(0.55 0.22 260)'] },
  { id: 'sunset',   label: 'Sunset',   cols: ['oklch(0.68 0.22 30)',  'oklch(0.65 0.24 0)',   'oklch(0.72 0.2 70)']  },
  { id: 'midnight', label: 'Midnight', cols: ['oklch(0.5 0.18 260)',  'oklch(0.45 0.16 240)', 'oklch(0.5 0.14 280)'] },
];

const HUES = [
  { h: 300, label: 'Lavender' },
  { h: 200, label: 'Cyan' },
  { h: 340, label: 'Pink' },
  { h: 130, label: 'Lime' },
  { h: 30,  label: 'Amber' },
];

const DENSITIES: Density[] = ['airy', 'balanced', 'dense'];

function loadState(): TweaksState {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem('syncplay.tweaks');
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function applyState(s: TweaksState): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', s.theme);
  root.setAttribute('data-density', s.density);
  root.style.setProperty('--accent-h', String(s.accentHue));
}

/**
 * Applies persisted tweaks on mount. Place once high in the tree (e.g. in app/page.tsx).
 * Without this, defaults from <html data-theme=...> in layout.tsx stick.
 */
export function useTweaks(): [TweaksState, (next: TweaksState) => void] {
  const [state, setState] = useState<TweaksState>(DEFAULTS);

  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    applyState(loaded);
  }, []);

  function update(next: TweaksState) {
    setState(next);
    applyState(next);
    try { localStorage.setItem('syncplay.tweaks', JSON.stringify(next)); } catch {}
  }

  return [state, update];
}

interface Props {
  open: boolean;
  onClose: () => void;
  state: TweaksState;
  setState: (s: TweaksState) => void;
}

export default function TweaksPanel({ open, onClose, state, setState }: Props) {
  return (
    <div className={'glass tweaks ' + (open ? 'open' : '')}>
      <div className="row-between" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, margin: 0, letterSpacing: '-0.01em' }}>Tweaks</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ width: 28, height: 28 }}>
          <Icon.Close size={14} />
        </button>
      </div>

      <div className="tweak-group">
        <div className="tweak-label">Theme</div>
        <div className="tweak-options">
          {THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              className={'tweak-swatch ' + (state.theme === t.id ? 'active' : '')}
              onClick={() => setState({ ...state, theme: t.id })}
              title={t.label}
              style={{ background: `linear-gradient(135deg, ${t.cols[0]}, ${t.cols[1]}, ${t.cols[2]})` }}
              aria-label={`Theme ${t.label}`}
            />
          ))}
        </div>
      </div>

      <div className="tweak-group">
        <div className="tweak-label">Accent</div>
        <div className="tweak-options">
          {HUES.map(h => (
            <button
              key={h.h}
              type="button"
              className={'tweak-swatch ' + (state.accentHue === h.h ? 'active' : '')}
              onClick={() => setState({ ...state, accentHue: h.h })}
              title={h.label}
              style={{ background: `oklch(0.78 0.11 ${h.h})` }}
              aria-label={`Accent ${h.label}`}
            />
          ))}
        </div>
      </div>

      <div className="tweak-group">
        <div className="tweak-label">Density</div>
        <div className="tweak-options">
          {DENSITIES.map(d => (
            <button
              key={d}
              type="button"
              className={'pill ' + (state.density === d ? 'active' : '')}
              onClick={() => setState({ ...state, density: d })}
              style={{ textTransform: 'capitalize' }}
            >{d}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
