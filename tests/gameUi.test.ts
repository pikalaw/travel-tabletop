import { describe, expect, it } from 'vitest';
import { initialUi, uiReducer, logLines, type UiAction, type UiState } from '../src/ui/gameUi';
import { numberLines, type LogLine } from '../src/ui/Overlays';
import type { LogEntry } from '../src/types/storage';

const run = (s: UiState, ...as: UiAction[]) => as.reduce(uiReducer, s);

describe('game screen state', () => {
  it('one device starts blinded on the active player’s side; two devices on your own', () => {
    expect(initialUi(true, 'p1', 'p2')).toMatchObject({ viewer: 'nobody', persp: 'p2' });
    expect(initialUi(false, 'p2', 'p1')).toMatchObject({ viewer: 'p2', persp: 'p2' });
  });
  it('modes replace each other: one mode at a time', () => {
    const s = run(initialUi(true, 'p1', 'p1'),
      { type: 'mode', mode: { kind: 'library', zone: 'p1.library', n: 1 } },
      { type: 'mode', mode: { kind: 'combat', blocker: null, vigilance: false } });
    expect(s.mode).toEqual({ kind: 'combat', blocker: null, vigilance: false });
  });
  it('the library count stays within 1–99 and only applies in library mode', () => {
    let s = run(initialUi(true, 'p1', 'p1'), { type: 'mode', mode: { kind: 'library', zone: 'p1.library', n: 1 } }, { type: 'libraryN', n: 0 });
    expect(s.mode).toMatchObject({ n: 1 });
    s = run(s, { type: 'libraryN', n: 120 });
    expect(s.mode).toMatchObject({ n: 99 });
    expect(run(initialUi(true, 'p1', 'p1'), { type: 'libraryN', n: 5 }).mode).toEqual({ kind: 'normal' });
  });
  it('unblinding shows that player’s side, closes slots and the library footer, and shows what happened while away', () => {
    const s = run(initialUi(true, 'p1', 'p1'),
      { type: 'openSlot', zone: 'p1.hand' },
      { type: 'mode', mode: { kind: 'library', zone: 'p1.library', n: 3 } },
      { type: 'unblind', player: 'p2', away: { name: 'Bo', lines: [{ text: 'Ann drew 2 cards', alert: false }] } });
    expect(s).toMatchObject({ viewer: 'p2', persp: 'p2', openSlots: [], mode: { kind: 'normal' }, sheet: { kind: 'away', name: 'Bo' } });
  });
  it('blinding closes private trays but keeps other sheets', () => {
    const peek = run(initialUi(false, 'p1', 'p1'), { type: 'sheet', sheet: { kind: 'peek', zone: 'p1.library', ids: [] } }, { type: 'blind' });
    expect(peek).toMatchObject({ viewer: 'nobody', sheet: null });
    const log = run(initialUi(false, 'p1', 'p1'), { type: 'sheet', sheet: { kind: 'log' } }, { type: 'blind' });
    expect(log.sheet).toEqual({ kind: 'log' });
  });
  it('slots open once each and close one by one or all together', () => {
    let s = run(initialUi(true, 'p1', 'p1'), { type: 'openSlot', zone: 'p1.hand' }, { type: 'openSlot', zone: 'p1.hand' }, { type: 'openSlot', zone: 'p2.lands' });
    expect(s.openSlots).toEqual(['p1.hand', 'p2.lands']);
    s = run(s, { type: 'closeSlot', zone: 'p1.hand' });
    expect(s.openSlots).toEqual(['p2.lands']);
    expect(run(s, { type: 'closeSlots' }).openSlots).toEqual([]);
  });
});

describe('log lines from a stored log', () => {
  const entry = (seq: number, kind: LogEntry['kind'], extra: Partial<LogEntry> = {}): LogEntry =>
    ({ gameId: 'g', seq, ts: '2026-11-09T20:00:00.000Z', mode: 'same-device', turn: 1, kind, actor: 'p1', schemaVersion: 1, ...extra });
  it('keeps commands, notices and undos with their text and alerts, and drops the rest', () => {
    const lines = logLines([
      entry(1, 'snapshot'),
      entry(2, 'command', { text: 'Player 1 shuffled their library', alert: true }),
      entry(3, 'rejected', { reason: 'stale' }),
      entry(4, 'notice', { text: 'Player 1 is looking at the top 1', notice: { kind: 'peek', actor: 'p1', payload: { zone: 'p1.library', n: 1 }, alert: true } }),
      entry(5, 'undo', { text: 'Player 1 undid the last action' }),
      entry(6, 'command', { text: 'Player 1 tapped Elf' }),
    ]);
    expect(lines.map((l) => [l.text, l.alert])).toEqual([
      ['Player 1 shuffled their library', true],
      ['Player 1 is looking at the top 1', true],
      ['Player 1 undid the last action', false],
      ['Player 1 tapped Elf', false],
    ]);
    expect(lines[0]!.time).toMatch(/\d/);
  });
  it('marks a new game and each pass turn as a turn start', () => {
    const cmd = (type: string) => ({ type, actor: 'p1', payload: {} }) as unknown as NonNullable<LogEntry['command']>;
    const lines = logLines([
      entry(1, 'command', { text: 'New game', command: cmd('startGame') }),
      entry(2, 'command', { text: 'tapped', command: cmd('tap') }),
      entry(3, 'command', { text: 'Turn 2', turn: 2, command: cmd('passTurn') }),
    ]);
    expect(lines.map((l) => [l.turn, !!l.turnStart])).toEqual([[1, true], [1, false], [2, true]]);
  });
  it('keeps the whole log, from the start of the game', () => {
    const many = Array.from({ length: 2500 }, (_, i) => entry(i + 1, 'command', { text: `line ${i + 1}` }));
    const lines = logLines(many);
    expect(lines).toHaveLength(2500);
    expect(lines[0]!.text).toBe('line 1');
  });
});

describe('log line numbers', () => {
  const L = (text: string, turn: number, turnStart = false): LogLine => ({ text, turn, turnStart, time: '' });
  it('numbers turn.n; a turn start gets none; an undo back into a turn carries its count on', () => {
    const labels = numberLines([
      L('New game', 1, true), L('a', 1), L('b', 1), L('Turn 2', 2, true), L('c', 2), L('Undo', 1), L('d', 1), L('Turn 2', 2, true), L('e', 2),
    ]).map((x) => x.label);
    expect(labels).toEqual(['', '1.1', '1.2', '', '2.1', '1.3', '1.4', '', '2.2']);
  });
});
