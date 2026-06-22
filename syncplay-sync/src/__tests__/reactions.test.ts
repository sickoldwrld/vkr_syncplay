import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreate, rooms,
  allowReaction, dropUserReactions,
  REACTION_BURST, REACTION_WINDOW_MS, ALLOWED_REACTIONS,
} from '../roomManager';

describe('reactions: rate limiting and whitelist', () => {
  beforeEach(() => {
    rooms.clear();
  });

  it('whitelist contains expected base set', () => {
    expect(ALLOWED_REACTIONS.has('❤️')).toBe(true);
    expect(ALLOWED_REACTIONS.has('🔥')).toBe(true);
    expect(ALLOWED_REACTIONS.has('👏')).toBe(true);
    expect(ALLOWED_REACTIONS.has('😂')).toBe(true);
    expect(ALLOWED_REACTIONS.has('🎵')).toBe(true);
    expect(ALLOWED_REACTIONS.has('🥳')).toBe(true);
    expect(ALLOWED_REACTIONS.has('💩')).toBe(false);
  });

  it('allows up to BURST reactions inside a single window', () => {
    const r = getOrCreate('r1', 'h');
    const t = 1000;
    for (let i = 0; i < REACTION_BURST; i++) {
      expect(allowReaction(r, 'u1', t + i)).toBe(true);
    }
    // (BURST + 1)-th reaction inside the window is rejected
    expect(allowReaction(r, 'u1', t + REACTION_BURST)).toBe(false);
  });

  it('refills the bucket once window expires', () => {
    const r = getOrCreate('r1', 'h');
    const t = 1000;
    for (let i = 0; i < REACTION_BURST; i++) allowReaction(r, 'u1', t + i);
    expect(allowReaction(r, 'u1', t + REACTION_BURST)).toBe(false);
    // After the window ends, all stamps are evicted and a fresh burst is allowed
    expect(allowReaction(r, 'u1', t + REACTION_WINDOW_MS + 1)).toBe(true);
  });

  it('counts per-user separately', () => {
    const r = getOrCreate('r1', 'h');
    const t = 1000;
    for (let i = 0; i < REACTION_BURST; i++) allowReaction(r, 'u1', t + i);
    expect(allowReaction(r, 'u1', t + REACTION_BURST)).toBe(false);
    expect(allowReaction(r, 'u2', t + REACTION_BURST)).toBe(true);
  });

  it('clears window on dropUserReactions', () => {
    const r = getOrCreate('r1', 'h');
    const t = 1000;
    for (let i = 0; i < REACTION_BURST; i++) allowReaction(r, 'u1', t + i);
    dropUserReactions(r, 'u1');
    expect(r.reactionWindow.has('u1')).toBe(false);
    // Fresh user, fresh budget
    expect(allowReaction(r, 'u1', t + REACTION_BURST)).toBe(true);
  });
});
