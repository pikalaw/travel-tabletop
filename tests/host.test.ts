// The host: v1's host-level cases (notices, undo exactness, replay of its own log, the
// snapshot cap), plus persistence order.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Host, SNAPSHOT_CAP } from '../src/host/host';
import { checkInvariants } from '../src/engine/engine';
import { allZones } from '../src/engine/view';
import { STATE_COMMAND_TYPES, NOTICE_KINDS } from '../src/types/commands';
import { replay } from '../src/host/replay';
import type { Commit } from '../src/storage/db';
import type { LogEntry } from '../src/types/storage';
import { seeded, started } from './support';
import { cmdArb, concretize } from './steps';

const newHost = (seed = 7) => started(new Host({ random: seeded(seed) }));

describe('host', () => {
  it('search close shuffles the library', () => {
    const h = newHost();
    const order = [...h.state.zones['p1.library']];
    h.dispatch({ type: 'searchOpen', actor: 'p1', payload: { zone: 'p1.library' } });
    h.dispatch({ type: 'searchClose', actor: 'p1', payload: { zone: 'p1.library' } });
    expect(h.state.zones['p1.library']).not.toEqual(order);
    expect([...h.state.zones['p1.library']].sort()).toEqual([...order].sort());
  });

  it('randomness notices carry host results', () => {
    const h = newHost();
    const r = h.dispatch({ type: 'rollDie', actor: 'p1', payload: { sides: 20 } });
    if (!r.ok || r.notice?.kind !== 'rollDie') throw new Error('no notice');
    expect(r.notice.payload.result).toBeGreaterThanOrEqual(1);
    expect(r.notice.payload.result).toBeLessThanOrEqual(20);
    const pick = h.dispatch({ type: 'randomPick', actor: 'p1', payload: { zone: 'p1.hand' } });
    if (!pick.ok || pick.notice?.kind !== 'randomPick') throw new Error('no notice');
    expect(h.state.zones['p1.hand']).toContain(pick.notice.payload.cardId);
    expect(h.dispatch({ type: 'randomPick', actor: 'p1', payload: { zone: 'p1.exile' } })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('any command or notice with any payload, as a guest might send it, is applied or refused, never thrown', () => {
    // Values that broke the host before: an object whose toString is not a function.
    const hostile: unknown[] = [{ toString: '' }, { valueOf: 1, toString: 2 }, [{ toString: '' }]];
    const value = fc.oneof(fc.constantFrom<unknown>(...allZones(), 'p1', 'p2', 'c1', 'c3', 'a1', 'plus', 'label', null, undefined, true, -1, 2.5, 1e9, ...hostile), fc.anything());
    const payload = fc.dictionary(fc.constantFrom('cardId', 'from', 'to', 'toZone', 'toCardId', 'attackerId', 'attackerZone', 'player', 'kind', 'label', 'n', 'value', 'zone', 'key', 'toIndex', 'defId', 'name', 'owner', 'winner', 'text', 'sides', 'ids', 'to'), value);
    fc.assert(fc.property(fc.constantFrom(...STATE_COMMAND_TYPES.filter((t) => t !== 'startGame'), ...NOTICE_KINDS), payload, (type, p) => {
      const h = newHost();
      expect(() => h.dispatch({ type, actor: 'p2', payload: p })).not.toThrow();
      expect(checkInvariants(h.state)).toBeNull();
    }), { numRuns: 600 });
  });

  it('tells listeners about changes, notices and undos', () => {
    const h = newHost();
    const seen: string[] = [];
    h.on('state', (_s, info) => seen.push(`${info.version}:${info.text}${info.undo ? ' (undo)' : ''}`));
    h.on('notice', (n) => seen.push(`notice:${n.text}`));
    h.dispatch({ type: 'draw', actor: 'p1', payload: { player: 'p1', n: 2 } });
    h.dispatch({ type: 'coinFlip', actor: 'p2', payload: {} });
    h.dispatch({ type: 'undo', actor: 'table' });
    expect(seen).toEqual(['2:Ann drew 2 cards', expect.stringMatching(/^notice:Bo flipped a coin: (heads|tails)$/), '3:Table undid the last action (undo)']);
  });

  it('snapshot stack is capped', () => {
    const h = newHost();
    for (let i = 0; i < SNAPSHOT_CAP + 30; i++) h.dispatch({ type: 'untapAll', actor: 'p1', payload: { player: 'p1' } });
    expect(h.snapshots.length).toBe(SNAPSHOT_CAP);
  });

  it('saves in order, one commit per change, even when a save is slow', async () => {
    const commits: Commit[] = [];
    let slow = true;
    const persist = { commit: async (c: Commit) => { if (slow) { slow = false; await new Promise((r) => setTimeout(r, 30)); } commits.push(c); } };
    const h = started(new Host({ random: seeded(3), persist }));
    h.dispatch({ type: 'draw', actor: 'p1', payload: { player: 'p1', n: 1 } });
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: 'nope', from: 'p1.hand', to: 'p1.exile' } }); // rejected: logged
    h.dispatch({ type: 'undo', actor: 'p1' });
    await h.flush();
    expect(commits.map((c) => c.log.map((e) => e.kind).join('+'))).toEqual(['command+snapshot', 'command', 'rejected', 'undo']);
    expect(commits.map((c) => c.log[0]!.seq)).toEqual([1, 3, 4, 5]);
    expect(commits[1]!.push?.key).toBe(1);
    expect(commits[3]!.drop).toEqual([1]);
  });
});

describe('host properties', () => {
  it('undo restores the prior state exactly', () => {
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 40 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const h = newHost(seed);
      for (const step of steps) {
        if (step.type === 'undo') continue;
        const before = structuredClone(h.state);
        const r = h.dispatch(concretize(h.state, step));
        if (r.ok && r.version) {
          h.dispatch({ type: 'undo', actor: 'table', payload: {} });
          expect(h.state).toStrictEqual(before);
          h.dispatch(concretize(h.state, step)); // re-apply to keep moving
        }
      }
    }), { numRuns: 100 });
  });

  it('replaying the log reproduces the final state', () => {
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 60 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const log: LogEntry[] = [];
      // Capture entries synchronously instead of waiting for the async save chain.
      class Capturing extends Host {
        protected override save(c: { log?: LogEntry[] }) { log.push(...(c.log || [])); }
      }
      const h = started(new Capturing({ random: seeded(seed) }));
      for (const step of steps) h.dispatch(concretize(h.state, step));
      expect(replay(log)).toStrictEqual(h.state);
    }), { numRuns: 100 });
  });
});
