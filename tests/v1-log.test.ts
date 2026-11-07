// The v1 compatibility fixture: a game recorded from v1 (tag v1) must replay to v1's final
// state, and the regenerated ticker text must equal v1's for every entry.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apply, emptyState } from '../src/engine/engine';
import { describeCommand, describeNotice, who } from '../src/host/describe';
import { replay, SNAPSHOT_CAP } from '../src/host/replay';
import type { Command } from '../src/types/commands';
import type { GameState } from '../src/types/state';
import type { LogEntry } from '../src/types/storage';

const read = (f: string) => readFileSync(new URL(`./fixtures/v1/${f}`, import.meta.url), 'utf8');
const lines = read('game.jsonl').trim().split('\n');
const entries = lines.slice(1).map((l) => JSON.parse(l) as LogEntry);
const final = JSON.parse(read('final-state.json')) as GameState;

/**
 * The replayed state without the fields v1 never had: `changed` marks (protocol 4) are a v2
 * display aid, set by the same commands. Everything v1 kept must still match exactly.
 */
function asV1(state: GameState): GameState {
  const s = structuredClone(state);
  for (const c of Object.values(s.cards)) delete c.changed;
  return s;
}

describe('the v1 game log', () => {
  it('replays to v1’s final state', () => {
    const replayed = asV1(replay(entries));
    expect(replayed).toEqual(final);
    // and exactly: no keys holding undefined, the same JSON once keys are sorted (the fixture's are)
    const canon = (x: unknown): string => JSON.stringify(x, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
    expect(canon(replayed)).toBe(canon(final));
    expect(replayed).toStrictEqual(final);
    // the game ended with cards in play, so the marks really were set along the way
    expect(Object.values(replay(entries).cards).some((c) => c.changed)).toBe(true);
  });

  it('regenerates every ticker line', () => {
    let state = emptyState();
    const stack: GameState[] = [];
    let checked = 0;
    for (const e of entries) {
      if (e.kind === 'command' && e.command) {
        const res = apply(state, e.command as Command);
        if ('error' in res) throw new Error(`seq ${e.seq}: ${res.error}`);
        expect(describeCommand(e.command as Command, state, res.state, res.moved), `seq ${e.seq}`).toBe(e.text);
        if (e.command.type === 'startGame') stack.length = 0; else { stack.push(state); if (stack.length > SNAPSHOT_CAP) stack.shift(); }
        state = res.state;
        checked++;
      } else if (e.kind === 'notice' && e.notice) {
        expect(describeNotice(e.notice, state), `seq ${e.seq}`).toBe(e.text);
        checked++;
      } else if (e.kind === 'undo') {
        state = stack.pop()!;
        expect(`${who(state, e.actor)} undid the last action`, `seq ${e.seq}`).toBe(e.text);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
