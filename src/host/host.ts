// The host: owns the authoritative game state, applies commands one at a time through the
// pure engine, fills in randomness, keeps the undo snapshot stack, writes the action log,
// persists after every command, and notifies listeners (the local UI and the remote guest).

import { apply, emptyState, randomNeeded, STATE_COMMANDS, SCHEMA_VERSION } from '../engine/engine';
import { visibleTo, zoneKind, zoneOwner, findZone, isZone } from '../engine/view';
import { describeCommand, describeNotice, ALERT_NOTICES } from './describe';
import { SNAPSHOT_CAP } from './replay';
import { NOTICE_KINDS, type Command, type Movement, type Notice, type NoticeKind } from '../types/commands';
import type { Actor, GameState, ZoneId } from '../types/state';
import type { LogEntry } from '../types/storage';
import type { Commit, Persistence } from '../storage/db';
import type { History } from '../types/protocol';

export { SNAPSHOT_CAP };

export const NOTICE_TYPES: ReadonlySet<string> = new Set(NOTICE_KINDS);

/** A command or notice as a session hands it over: the type is checked here, the payload by the engine. */
export interface IncomingCommand {
  type: string;
  actor: Actor;
  payload?: unknown;
  clientSeq?: number | undefined;
}

export type DispatchResult =
  | { ok: true; version?: number; notice?: Notice }
  | { ok: false; error: string; detail?: string | undefined };

/** What state listeners learn about each change. */
export interface ChangeInfo {
  version: number;
  text: string;
  alert: boolean;
  actor: Actor;
  clientSeq?: number | undefined;
  undo?: boolean;
}

/** One undo step: the board before a move, and that move's log line (missing for older saves). */
export interface UndoStep { key: number; state: GameState; text?: string | undefined }

export interface HostOptions {
  state?: GameState;
  snapshots?: UndoStep[];
  logSeq?: number;
  persist?: Persistence | null;
  random?: (n: number) => number[];
  now?: () => string;
}

/** Default randomness: uniform floats in [0, 1) from the platform CSPRNG. */
export function cryptoRandom(n: number): number[] {
  const buf = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (x) => x / 4294967296);
}

type StateListener = (state: GameState, info: ChangeInfo) => void;
type NoticeListener = (notice: Notice) => void;

export class Host {
  state: GameState;
  /** Undo steps, oldest first; the last is what Undo takes back. Saved with the game. */
  snapshots: UndoStep[];
  /**
   * Redo steps: each board an Undo stepped back from, with its move's line; the last is what Redo
   * brings back. Only until the next move (which clears them) or leaving the game: not saved.
   */
  private future: { state: GameState; text?: string | undefined }[] = [];
  logSeq: number;
  /** Increments on every state change, including undo. */
  version = 0;
  lastText = '';
  lastAlert = false;
  private persist: Persistence | null;
  private random: (n: number) => number[];
  private now: () => string;
  private listeners = { state: new Set<StateListener>(), notice: new Set<NoticeListener>() };
  private saving: Promise<void> = Promise.resolve();
  private nextSnapKey: number;

  constructor(opts: HostOptions = {}) {
    this.state = opts.state || emptyState();
    this.snapshots = opts.snapshots || [];
    this.logSeq = opts.logSeq || 0;
    this.persist = opts.persist || null;
    this.random = opts.random || cryptoRandom;
    this.now = opts.now || (() => new Date().toISOString());
    const last = this.snapshots[this.snapshots.length - 1];
    this.nextSnapKey = last ? last.key + 1 : 1;
  }

  on(kind: 'state', fn: StateListener): () => void;
  on(kind: 'notice', fn: NoticeListener): () => void;
  on(kind: 'state' | 'notice', fn: StateListener | NoticeListener): () => void {
    const set = this.listeners[kind] as Set<typeof fn>;
    set.add(fn);
    return () => { set.delete(fn); };
  }

  private emitState(state: GameState, info: ChangeInfo): void {
    for (const fn of this.listeners.state) { try { fn(state, info); } catch (e) { console.error(e); } }
  }

  private emitNotice(n: Notice): void {
    for (const fn of this.listeners.notice) { try { fn(n); } catch (e) { console.error(e); } }
  }

  /** Wait until every pending save has finished. */
  flush(): Promise<void> { return this.saving; }

  /** Handle one command, notice or undo. */
  dispatch(cmd: IncomingCommand): DispatchResult {
    if (!cmd || typeof cmd.type !== 'string') return { ok: false, error: 'invalid' };
    if (cmd.type === 'undo') return this.undo(cmd.actor);
    if (cmd.type === 'redo') return this.redo(cmd.actor);
    if (NOTICE_TYPES.has(cmd.type)) return this.notice(cmd.type as NoticeKind, cmd.actor, cmd.payload);
    if (!STATE_COMMANDS.has(cmd.type)) return { ok: false, error: 'invalid', detail: `unknown ${cmd.type}` };
    const filled = { type: cmd.type, actor: cmd.actor, payload: cmd.payload || {} } as Command;
    if (cmd.clientSeq != null) filled.clientSeq = cmd.clientSeq;
    const n = randomNeeded(this.state, filled);
    if (n > 0) filled.random = this.random(n);
    const before = this.state;
    const res = apply(before, filled);
    if ('error' in res) {
      this.log([this.entry('rejected', filled.actor, { command: filled, reason: `${res.error}: ${res.detail || ''}` })]);
      return { ok: false, error: res.error, detail: res.detail };
    }
    const after = res.state;
    const text = describeCommand(filled, before, after, res.moved);
    // Snapshot the prior state for undo, named by this move's line (not across a new game). Only
    // moves get here: notices (dice, pointing, looks) never become undo steps. A move ends redo.
    let push: Commit['push'];
    let drop: number[];
    if (filled.type !== 'startGame') {
      push = { key: this.nextSnapKey++, state: before, text };
      drop = this.pushStep(push);
    } else {
      drop = this.snapshots.map((s) => s.key);
      this.snapshots = [];
    }
    this.future = [];
    this.state = after;
    this.version++;
    // A library change the other player should notice. Dragging the top card into its owner's hand
    // is a draw, as routine as the draw command, so it is not one.
    const drawn = (m: Movement) => m.from && m.to && zoneKind(m.to) === 'hand' && zoneOwner(m.to) === zoneOwner(m.from)
      && before.zones[m.from][0] === m.id;
    const alert = filled.type === 'shuffle' || res.moved.some((m) =>
      (m.from && zoneKind(m.from) === 'library' && filled.type === 'move' && !drawn(m)) ||
      (m.to && zoneKind(m.to) === 'library'));
    this.lastText = text;
    this.lastAlert = alert;
    const entries = [this.entry('command', filled.actor, {
      command: filled, text, ...(alert ? { alert } : {}),
      cards: res.moved.map((m) => {
        const c = (before.cards[m.id] || after.cards[m.id])!;
        const b = before.cards[m.id], a = after.cards[m.id];
        return {
          id: m.id, defId: c.defId, name: c.name,
          from: m.from || undefined, to: m.to || undefined, toIndex: m.toIndex,
          visibleTo: {
            before: m.from && b ? visibleTo(before, b, m.from) : [],
            after: m.to && a ? visibleTo(after, a, m.to) : [],
          },
        };
      }) as NonNullable<LogEntry['cards']>,
    })];
    if (filled.type === 'startGame' || filled.type === 'passTurn' || filled.type === 'concede' || filled.type === 'endGame') {
      entries.push(this.entry('snapshot', 'host', { state: after }));
    }
    this.save({ state: after, push, drop, log: entries });
    this.emitState(after, { version: this.version, text, alert, actor: filled.actor, clientSeq: filled.clientSeq });
    return { ok: true, version: this.version };
  }

  /** What Undo would take back and Redo would bring back now, by log line (null: nothing). */
  history(): History {
    const named = (s: { text?: string | undefined } | undefined) => (s ? s.text || 'the last change' : null);
    return { undo: named(this.snapshots[this.snapshots.length - 1]), redo: named(this.future[this.future.length - 1]) };
  }

  /** Add an undo step, keeping at most SNAPSHOT_CAP; returns the keys of the steps dropped. */
  private pushStep(step: UndoStep): number[] {
    this.snapshots.push(step);
    const drop: number[] = [];
    while (this.snapshots.length > SNAPSHOT_CAP) drop.push(this.snapshots.shift()!.key);
    return drop;
  }

  private nameOf(actor: Actor): string {
    return actor === 'p1' || actor === 'p2' ? this.state.players[actor].name : 'Table';
  }

  /** Revert the most recent state change, whoever made it; Redo can bring it back until the next move. */
  undo(actor: Actor): DispatchResult {
    const snap = this.snapshots.pop();
    if (!snap) return { ok: false, error: 'invalid', detail: 'nothing to undo' };
    const undone = this.state.seq;
    this.future.push({ state: this.state, text: snap.text });
    this.state = snap.state;
    this.version++;
    const text = snap.text ? `${this.nameOf(actor)} undid: ${snap.text}` : `${this.nameOf(actor)} undid the last action`;
    this.lastText = text;
    this.lastAlert = false;
    this.save({ state: this.state, drop: [snap.key], log: [this.entry('undo', actor, { undoneSeq: undone, text })] });
    this.emitState(this.state, { version: this.version, text, alert: false, actor, undo: true });
    return { ok: true, version: this.version };
  }

  /** Bring back the move the last Undo took back, exactly as it was (a shuffle or a roll is not redone). */
  redo(actor: Actor): DispatchResult {
    const next = this.future.pop();
    if (!next) return { ok: false, error: 'invalid', detail: 'nothing to redo' };
    const push = { key: this.nextSnapKey++, state: this.state, text: next.text };
    const drop = this.pushStep(push);
    this.state = next.state;
    this.version++;
    const text = next.text ? `${this.nameOf(actor)} redid: ${next.text}` : `${this.nameOf(actor)} redid the last action`;
    this.lastText = text;
    this.lastAlert = false;
    this.save({ state: this.state, push, drop, log: [this.entry('redo', actor, { text })] });
    this.emitState(this.state, { version: this.version, text, alert: false, actor, undo: true });
    return { ok: true, version: this.version };
  }

  /** Logged, broadcast events that do not change state. Randomness results are filled here. */
  notice(kind: NoticeKind, actor: Actor, input: unknown): DispatchResult {
    const payload: Record<string, unknown> = { ...(typeof input === 'object' && input ? input : {}) };
    // A guest's notice may hold any JSON: the fields the log text and results read must be well formed.
    const bad = (payload.zone != null && !isZone(payload.zone))
      || ('n' in payload && !Number.isInteger(payload.n))
      || (payload.cardId != null && typeof payload.cardId !== 'string')
      || ('ids' in payload && !(Array.isArray(payload.ids) && payload.ids.every((x) => typeof x === 'string')));
    if (bad) return { ok: false, error: 'invalid', detail: `bad ${kind} notice` };
    if (kind === 'coinFlip') payload.result = this.random(1)[0]! < 0.5 ? 'heads' : 'tails';
    if (kind === 'rollDie') {
      const sides = Math.max(2, Math.min(1000, (typeof payload.sides === 'number' ? Math.trunc(payload.sides) : parseInt(typeof payload.sides === 'string' ? payload.sides : '', 10)) || 6));
      payload.sides = sides;
      payload.result = 1 + Math.floor(this.random(1)[0]! * sides);
    }
    if (kind === 'randomPick') {
      const ids = isZone(payload.zone) ? this.state.zones[payload.zone] : [];
      if (!ids.length) return { ok: false, error: 'invalid', detail: 'zone is empty' };
      payload.cardId = ids[Math.floor(this.random(1)[0]! * ids.length)];
    }
    const notice = { kind, actor, payload } as Notice;
    notice.text = describeNotice(notice, this.state);
    notice.alert = ALERT_NOTICES.has(kind);
    const entry = this.entry('notice', actor, { notice, text: notice.text });
    notice.seq = entry.seq;
    this.save({ log: [entry] });
    this.emitNotice(notice);
    // Closing a search shuffles that library.
    if (kind === 'searchClose' && isZone(payload.zone) && zoneKind(payload.zone) === 'library') {
      this.dispatch({ type: 'shuffle', actor, payload: { zone: payload.zone } });
    }
    return { ok: true, notice };
  }

  /** Build a log entry. */
  private entry(kind: LogEntry['kind'], actor: Actor, extra: Partial<LogEntry>): LogEntry {
    return {
      gameId: this.state.gameId,
      seq: ++this.logSeq,
      ts: this.now(),
      mode: this.state.mode,
      turn: this.state.turn,
      kind,
      actor,
      schemaVersion: SCHEMA_VERSION,
      ...extra,
    };
  }

  private log(entries: LogEntry[]): void { this.save({ log: entries }); }

  /** Queue a save after the previous one, so commits reach storage in order. */
  /** `state` only when the game changed, so a log-only line (notice, refusal) doesn't count as play. */
  protected save(c: { state?: GameState; push?: Commit['push']; drop?: number[]; log?: LogEntry[] }): void {
    const persist = this.persist;
    if (!persist) return;
    const job = () => persist.commit({ state: c.state, push: c.push, drop: c.drop || [], log: c.log || [] });
    this.saving = this.saving.then(job, job).catch((e: unknown) => console.error('save failed', e));
  }

  /** Locate a card (used by UI helpers). */
  zoneOf(id: string): ZoneId | null { return findZone(this.state, id); }
}
