import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { NOTICE_KINDS, STATE_COMMAND_TYPES, type Command, type CommandOf, type StateCommandType } from '../src/types/commands';
import type { GameState, ZoneId } from '../src/types/state';
import type { LogEntry } from '../src/types/storage';

const lines = readFileSync(new URL('./fixtures/v1/game.jsonl', import.meta.url), 'utf8').trim().split('\n');
const entries = lines.slice(1).map((l) => JSON.parse(l) as LogEntry);

describe('shared types', () => {
  it('cover every command and notice in the v1 log', () => {
    const known = new Set<string>([...STATE_COMMAND_TYPES, ...NOTICE_KINDS, 'undo']);
    const seen = new Set<string>(entries.flatMap((e) => [e.command?.type, e.notice?.kind]).filter((t) => t !== undefined));
    expect([...seen].filter((t) => !known.has(t))).toEqual([]);
    // the fixture uses all 26 of v1's state commands; detachAll and setLead came later
    expect(STATE_COMMAND_TYPES.filter((t) => !seen.has(t))).toEqual(['detachAll', 'setLead']);
  });

  it('match the fields the v1 log carries', () => {
    const final = JSON.parse(readFileSync(new URL('./fixtures/v1/final-state.json', import.meta.url), 'utf8')) as GameState;
    expect(Object.keys(final).sort()).toEqual(['activePlayer', 'cards', 'gameId', 'mode', 'nextId', 'players', 'result', 'schemaVersion', 'seq', 'turn', 'zones']);
    expect(Object.keys(final.zones)).toHaveLength(15);
    const kinds = new Set(entries.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['command', 'notice', 'rejected', 'snapshot', 'undo']);
  });

  it('narrow commands by type', () => {
    expectTypeOf<CommandOf<'move'>['payload']>().toEqualTypeOf<{ cardId: string; from: ZoneId; to: ZoneId; toIndex?: number }>();
    expectTypeOf<Command['type']>().toEqualTypeOf<StateCommandType>();
    expectTypeOf<'p1.hand'>().toExtend<ZoneId>();
  });
});
