// Test helpers shared by the engine and host suites.

import { expect } from 'vitest';
import { apply, randomNeeded } from '../src/engine/engine';
import type { Command } from '../src/types/commands';
import type { Actor, GameState } from '../src/types/state';
import { emptyState } from '../src/engine/engine';

/** Deterministic randomness for tests (the same LCG as v1's tests). */
export function seeded(seed = 1): (n: number) => number[] {
  let s = seed >>> 0;
  return (n) => Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  });
}

export function deck(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ defId: `${prefix}${i % 5}`, name: `${prefix} card ${i}`, deckId: prefix }));
}

/** A command as a test writes it: any type, any payload (tests send bad input on purpose). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TestCommand { type: string; actor: Actor; payload: any; clientSeq?: number }

export interface DispatchResult { ok: boolean; error?: string; detail?: string; version?: number }

/**
 * The smallest stand-in for the host that the engine suites need: applies state commands with
 * seeded randomness and keeps an undo stack. The real host has its own suite.
 */
export class Table {
  state: GameState = emptyState();
  version = 0;
  private undoStack: GameState[] = [];
  constructor(private random: (n: number) => number[] = seeded(7)) {}

  dispatch(input: TestCommand): DispatchResult {
    if (input.type === 'undo') {
      const prev = this.undoStack.pop();
      if (!prev) return { ok: false, error: 'invalid', detail: 'nothing to undo' };
      this.state = prev;
      this.version++;
      return { ok: true, version: this.version };
    }
    const cmd = { type: input.type, actor: input.actor, payload: input.payload ?? {} } as Command;
    const n = randomNeeded(this.state, cmd);
    if (n > 0) cmd.random = this.random(n);
    const res = apply(this.state, cmd);
    if ('error' in res) return { ok: false, error: res.error, ...(res.detail ? { detail: res.detail } : {}) };
    if (cmd.type === 'startGame') this.undoStack = [];
    else this.undoStack.push(this.state);
    this.state = res.state;
    this.version++;
    return { ok: true, version: this.version };
  }
}

/** A started game: Ann (p1) and Bo (p2), 40 cards each. */
export function started<T extends { dispatch(c: TestCommand): { ok: boolean } }>(table: T): T;
export function started(): Table;
export function started(table: { dispatch(c: TestCommand): { ok: boolean } } = new Table()) {
  const r = table.dispatch({
    type: 'startGame', actor: 'host',
    payload: { gameId: 'g1', mode: 'same-device', startingLife: 20, players: { p1: { name: 'Ann', cards: deck('a', 40) }, p2: { name: 'Bo', cards: deck('b', 40) } } },
  });
  expect(r.ok).toBe(true);
  return table;
}
