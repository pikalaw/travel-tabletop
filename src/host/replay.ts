// Rebuild a game's state from its action log. Applied commands carry their randomness,
// so replay reproduces the game exactly, including undos and redos.

import { apply, emptyState } from '../engine/engine';
import type { GameState } from '../types/state';
import type { LogEntry } from '../types/storage';
import type { Command } from '../types/commands';

/** How many undo snapshots the host keeps per game. */
export const SNAPSHOT_CAP = 100;

export function replay(entries: readonly LogEntry[]): GameState {
  let state = emptyState();
  const stack: GameState[] = [];
  const future: GameState[] = []; // boards an undo stepped back from, for redo; a new move clears them
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.kind === 'command' && e.command) {
      const res = apply(state, e.command as Command);
      if ('error' in res) throw new Error(`replay failed at seq ${e.seq}: ${res.error} ${res.detail || ''}`);
      if (e.command.type === 'startGame') stack.length = 0;
      else { stack.push(state); if (stack.length > SNAPSHOT_CAP) stack.shift(); }
      future.length = 0;
      state = res.state;
    } else if (e.kind === 'undo') {
      const prev = stack.pop();
      if (!prev) throw new Error(`replay: undo with empty stack at seq ${e.seq}`);
      future.push(state);
      state = prev;
    } else if (e.kind === 'redo') {
      const next = future.pop();
      if (!next) throw new Error(`replay: redo with nothing undone at seq ${e.seq}`);
      stack.push(state); if (stack.length > SNAPSHOT_CAP) stack.shift();
      state = next;
    }
  }
  return state;
}
