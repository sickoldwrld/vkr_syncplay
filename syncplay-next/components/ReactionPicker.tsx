'use client';
import { REACTION_EMOJIS } from '@/lib/roomSession';

/**
 * Compact strip of allowed emoji reactions. Clicking a button emits the
 * emoji over the WebSocket; everyone in the room (including the sender)
 * sees the floating animation via ReactionLayer.
 */
export default function ReactionPicker({ onSend, disabled }: {
  onSend: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Реакции"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid var(--glass-border)',
      }}
    >
      {REACTION_EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => onSend(emoji)}
          disabled={disabled}
          aria-label={`Реакция ${emoji}`}
          style={{
            width: 32, height: 32, borderRadius: 999,
            background: 'transparent',
            border: 'none',
            fontSize: 18, lineHeight: 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            transition: 'transform 0.1s ease, background 0.15s ease',
          }}
          onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.85)'; }}
          onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
