'use client';
import { Icon } from '@/components/Icons';

export interface SkipVoteState {
  votes: number;
  required: number;
  listeners: number;
  voted: boolean;
}

interface Props {
  state: SkipVoteState;
  disabled?: boolean;
  onVote: () => void;
}

/**
 * Vote-skip control: progress bar + toggle button. Any participant can press,
 * host's explicit SKIP bypasses voting entirely. Threshold = ceil(listeners/2).
 */
export default function VoteSkipBar({ state, disabled, onVote }: Props) {
  const { votes, required, listeners, voted } = state;
  const pct = required > 0 ? Math.min(100, Math.round((votes / required) * 100)) : 0;
  const reached = votes >= required && required > 0;

  return (
    <div
      data-testid="vote-skip"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 12,
        background: 'var(--glass)', border: '1px solid var(--glass-border)',
        fontSize: 12,
      }}
    >
      <button
        onClick={onVote}
        disabled={disabled}
        aria-label={voted ? 'Убрать голос за скип' : 'Голосовать за скип'}
        data-testid="vote-skip-button"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 999,
          border: '1px solid var(--glass-border)',
          background: voted ? 'oklch(0.78 0.11 var(--accent-h) / 0.22)' : 'transparent',
          color: voted ? 'var(--accent)' : 'var(--ink-dim)',
          fontSize: 12, fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon.Next size={11} />
        {voted ? 'Голос подан' : 'Скип'}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}>
          <div
            data-testid="vote-skip-progress"
            style={{
              width: `${pct}%`, height: '100%',
              background: reached ? 'oklch(0.75 0.18 140)' : 'var(--accent)',
              transition: 'width 0.2s ease-out',
            }}
          />
        </div>
        <div style={{
          marginTop: 4, fontSize: 10, color: 'var(--ink-faint)',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span data-testid="vote-skip-count">{votes}/{required} голосов</span>
          <span>{listeners} {listeners === 1 ? 'слушатель' : 'слушателей'}</span>
        </div>
      </div>
    </div>
  );
}
