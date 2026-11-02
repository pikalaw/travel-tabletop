// Rebuild a game's state from its action log. Applied commands carry their randomness,
// so replay reproduces the game exactly, including undos.

import { apply, emptyState } from '../engine/engine.js';
import { SNAPSHOT_CAP } from './host.js';

/** @param {import('../types').LogEntry[]} entries @returns {import('../types').GameState} */
export function replay(entries) {
  let state = emptyState();
  const stack = [];
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.kind === 'command' && e.command) {
      const res = apply(state, e.command);
      if ('error' in res) throw new Error(`replay failed at seq ${e.seq}: ${res.error} ${res.detail || ''}`);
      if (e.command.type === 'startGame') stack.length = 0;
      else { stack.push(state); if (stack.length > SNAPSHOT_CAP) stack.shift(); }
      state = res.state;
    } else if (e.kind === 'undo') {
      const prev = stack.pop();
      if (!prev) throw new Error(`replay: undo with empty stack at seq ${e.seq}`);
      state = prev;
    }
  }
  return state;
}
