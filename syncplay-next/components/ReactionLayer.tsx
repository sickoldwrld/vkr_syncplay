'use client';
import type { FloatingReaction } from '@/lib/roomSession';

/**
 * Renders floating-and-fading emoji reactions over its parent container.
 * Each reaction animates from the bottom upward with a random horizontal offset
 * and fades out. The animation duration matches REACTION_LIFETIME_MS in
 * lib/roomSession.tsx — react state removes them when the animation ends.
 *
 * The component is pointer-events: none so it never steals clicks from the UI.
 */
export default function ReactionLayer({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {reactions.map(r => (
        <span
          key={r.id}
          style={{
            position: 'absolute',
            left: '50%', bottom: 16,
            fontSize: 34, lineHeight: 1,
            animation: 'sp-float 2.8s ease-out forwards',
            ['--sp-r-x' as string]: `${r.offsetPx}px`,
          }}
        >
          {r.emoji}
        </span>
      ))}
      <style jsx>{`
        @keyframes sp-float {
          0%   { opacity: 0; transform: translate(-50%, 0) scale(0.7); }
          15%  { opacity: 1; transform: translate(calc(-50% + var(--sp-r-x) * 0.2), -30px) scale(1.1); }
          80%  { opacity: 0.9; transform: translate(calc(-50% + var(--sp-r-x) * 0.9), -160px) scale(1.0); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--sp-r-x)), -220px) scale(0.95); }
        }
      `}</style>
    </div>
  );
}
