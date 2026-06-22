import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreate,
  rooms,
  requiredVotes,
  toggleSkipVote,
  getSkipVoteState,
  dropUserFromSkipVotes,
  schedulePlay,
  stopPlayback,
} from '../roomManager';
import type { TrackMeta } from '../types';

const TRACK: TrackMeta = {
  id: 'track-1', title: 'A', artist: 'B', durationMs: 60_000, coverKey: null,
};

function addClient(room: ReturnType<typeof getOrCreate>, userId: string) {
  // We don't exercise the websocket, only the bookkeeping — a stub is enough.
  // Map key is the connectionId (one user may have several connections); using
  // userId as connectionId in tests preserves the original 1-user-1-entry semantics.
  const ws = { readyState: 1, send: () => {} } as unknown as import('ws').WebSocket;
  room.clients.set(userId, { ws, userId, roomId: room.roomId, connectionId: userId });
}

beforeEach(() => {
  rooms.clear();
});

describe('requiredVotes (threshold function)', () => {
  it('returns 1 for solo room (host alone counts as enough)', () => {
    expect(requiredVotes(1)).toBe(1);
  });

  it('rounds up to majority for even and odd', () => {
    expect(requiredVotes(2)).toBe(1);
    expect(requiredVotes(3)).toBe(2);
    expect(requiredVotes(4)).toBe(2);
    expect(requiredVotes(5)).toBe(3);
    expect(requiredVotes(10)).toBe(5);
    expect(requiredVotes(11)).toBe(6);
  });
});

describe('toggleSkipVote', () => {
  it('returns null when no track is playing', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    expect(toggleSkipVote(room, 'host')).toBeNull();
  });

  it('adds a vote on first toggle and reports threshold reached when crossed', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    addClient(room, 'u2');
    addClient(room, 'u3');
    schedulePlay(room, TRACK, 0, () => {});

    // 3 listeners → required=2. First vote: 1/2, not yet.
    const r1 = toggleSkipVote(room, 'u2');
    expect(r1).not.toBeNull();
    expect(r1!.state.votes).toBe(1);
    expect(r1!.state.required).toBe(2);
    expect(r1!.state.voted).toBe(true);
    expect(r1!.thresholdReached).toBe(false);

    // Second vote crosses threshold.
    const r2 = toggleSkipVote(room, 'u3');
    expect(r2!.state.votes).toBe(2);
    expect(r2!.thresholdReached).toBe(true);
  });

  it('removes a vote on the second toggle by the same user (toggle semantics)', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    addClient(room, 'u2');
    schedulePlay(room, TRACK, 0, () => {});

    toggleSkipVote(room, 'u2'); // add
    const r = toggleSkipVote(room, 'u2'); // remove
    expect(r!.state.votes).toBe(0);
    expect(r!.state.voted).toBe(false);
    expect(r!.thresholdReached).toBe(false);
  });

  it('removing a vote never reports thresholdReached', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    schedulePlay(room, TRACK, 0, () => {});

    // Solo room: required=1, one vote = reached. Then remove → must NOT trigger again.
    const r1 = toggleSkipVote(room, 'host');
    expect(r1!.thresholdReached).toBe(true);
    const r2 = toggleSkipVote(room, 'host');
    expect(r2!.state.votes).toBe(0);
    expect(r2!.thresholdReached).toBe(false);
  });
});

describe('schedulePlay / stopPlayback clear vote-skips', () => {
  it('resets skipVotes on schedulePlay (new track)', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    addClient(room, 'u2');
    schedulePlay(room, TRACK, 0, () => {});
    toggleSkipVote(room, 'u2');
    expect(room.skipVotes.size).toBe(1);

    // New track — votes from previous track should not carry over.
    schedulePlay(room, { ...TRACK, id: 'track-2' }, 0, () => {});
    expect(room.skipVotes.size).toBe(0);
  });

  it('resets skipVotes on stopPlayback', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    schedulePlay(room, TRACK, 0, () => {});
    toggleSkipVote(room, 'host');
    expect(room.skipVotes.size).toBe(1);
    stopPlayback(room);
    expect(room.skipVotes.size).toBe(0);
  });
});

describe('dropUserFromSkipVotes', () => {
  it('removes the user from the vote set and reflects new listener count', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    addClient(room, 'u2');
    addClient(room, 'u3');
    schedulePlay(room, TRACK, 0, () => {});
    toggleSkipVote(room, 'u2');
    expect(room.skipVotes.size).toBe(1);

    // Simulate u2 disconnect.
    room.clients.delete('u2');
    const state = dropUserFromSkipVotes(room, 'u2');
    expect(state.votes).toBe(0);
    expect(state.listeners).toBe(2);
    expect(state.required).toBe(1);
  });
});

describe('getSkipVoteState', () => {
  it('reflects current vote set and viewer voted bit', () => {
    const room = getOrCreate('r1', 'host');
    addClient(room, 'host');
    addClient(room, 'u2');
    schedulePlay(room, TRACK, 0, () => {});
    toggleSkipVote(room, 'u2');
    const stateForU2 = getSkipVoteState(room, 'u2');
    expect(stateForU2.voted).toBe(true);
    const stateForHost = getSkipVoteState(room, 'host');
    expect(stateForHost.voted).toBe(false);
    expect(stateForHost.votes).toBe(1);
  });
});
