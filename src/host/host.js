// The host: owns the authoritative game state, applies commands one at a time through the
// pure engine, fills in randomness, keeps the undo snapshot stack, writes the action log,
// persists after every command, and notifies listeners (local UI and the remote guest).

import { apply, emptyState, randomNeeded, STATE_COMMANDS, SCHEMA_VERSION } from '../engine/engine.js';
import { visibleTo, zoneKind, findZone } from '../engine/view.js';
import { describeCommand, describeNotice, ALERT_NOTICES } from './describe.js';

/** @typedef {import('../types').GameState} GameState */
/** @typedef {import('../types').Command} Command */
/** @typedef {import('../types').Notice} Notice */
/** @typedef {import('../types').LogEntry} LogEntry */

export const SNAPSHOT_CAP = 100;
export const NOTICE_TYPES = new Set(['peek', 'revealTop', 'searchOpen', 'searchClose', 'inspect', 'point', 'showCard', 'coinFlip', 'rollDie', 'randomPick', 'info']);

/** Default randomness: uniform floats in [0, 1) from the platform CSPRNG. */
export function cryptoRandom(n) {
  const buf = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (x) => x / 4294967296);
}

/**
 * @typedef {object} Persistence
 * @property {(c: { state: GameState, push?: { key: number, state: GameState }, drop?: number[], log: LogEntry[] }) => Promise<void>} commit
 */

export class Host {
  /**
   * @param {object} opts
   * @param {GameState} [opts.state]
   * @param {{ key: number, state: GameState }[]} [opts.snapshots]
   * @param {number} [opts.logSeq]
   * @param {Persistence} [opts.persist]
   * @param {(n: number) => number[]} [opts.random]
   * @param {() => string} [opts.now]
   */
  constructor(opts = {}) {
    this.state = opts.state || emptyState();
    this.snapshots = opts.snapshots || [];
    this.logSeq = opts.logSeq || 0;
    this.persist = opts.persist || null;
    this.random = opts.random || cryptoRandom;
    this.now = opts.now || (() => new Date().toISOString());
    this.version = 0;               // increments on every state change, including undo
    this.lastText = '';
    this.lastAlert = false;
    this.listeners = { state: new Set(), notice: new Set() };
    this.saving = Promise.resolve();
    this.nextSnapKey = this.snapshots.length ? this.snapshots[this.snapshots.length - 1].key + 1 : 1;
  }

  on(kind, fn) { this.listeners[kind].add(fn); return () => this.listeners[kind].delete(fn); }
  emit(kind, ...args) { for (const fn of this.listeners[kind]) { try { fn(...args); } catch (e) { console.error(e); } } }

  /** Wait until every pending save has finished. */
  flush() { return this.saving; }

  /**
   * Handle one command or notice. Returns { ok, error?, detail?, notice? }.
   * @param {Command} cmd
   */
  dispatch(cmd) {
    if (!cmd || typeof cmd.type !== 'string') return { ok: false, error: 'invalid' };
    if (cmd.type === 'undo') return this.undo(cmd);
    if (NOTICE_TYPES.has(cmd.type)) return this.notice({ kind: /** @type {any} */ (cmd.type), actor: cmd.actor, payload: cmd.payload || {} });
    if (!STATE_COMMANDS.has(cmd.type)) return { ok: false, error: 'invalid', detail: `unknown ${cmd.type}` };

    /** @type {Command} */
    const filled = { type: cmd.type, actor: cmd.actor, payload: cmd.payload || {} };
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

    // Snapshot the prior state for undo (not across a new game).
    let push, drop = [];
    if (filled.type !== 'startGame') {
      push = { key: this.nextSnapKey++, state: before };
      this.snapshots.push(push);
      while (this.snapshots.length > SNAPSHOT_CAP) drop.push(this.snapshots.shift().key);
    } else {
      drop = this.snapshots.map((s) => s.key);
      this.snapshots = [];
    }

    this.state = after;
    this.version++;
    const text = describeCommand(filled, before, after, res.moved);
    const alert = filled.type === 'shuffle' || res.moved.some((m) =>
      (m.from && zoneKind(m.from) === 'library' && filled.type === 'move') ||
      (m.to && zoneKind(m.to) === 'library'));
    this.lastText = text;
    this.lastAlert = alert;

    const entries = [this.entry('command', filled.actor, {
      command: filled, text,
      cards: res.moved.map((m) => {
        const c = before.cards[m.id] || after.cards[m.id];
        return {
          id: m.id, defId: c.defId, name: c.name,
          from: m.from || undefined, to: m.to || undefined, toIndex: m.toIndex,
          visibleTo: {
            before: m.from && before.cards[m.id] ? visibleTo(before, before.cards[m.id], m.from) : [],
            after: m.to && after.cards[m.id] ? visibleTo(after, after.cards[m.id], m.to) : [],
          },
        };
      }),
    })];
    if (['startGame', 'passTurn', 'concede', 'endGame'].includes(filled.type)) {
      entries.push(this.entry('snapshot', 'host', { state: after }));
    }
    this.save({ state: after, push, drop, log: entries });
    this.emit('state', after, { version: this.version, text, alert, actor: filled.actor, clientSeq: filled.clientSeq });
    return { ok: true, version: this.version };
  }

  /** Revert the most recent state change, whoever made it. */
  undo(cmd) {
    const snap = this.snapshots.pop();
    if (!snap) return { ok: false, error: 'invalid', detail: 'nothing to undo' };
    const undone = this.state.seq;
    this.state = snap.state;
    this.version++;
    const who = cmd.actor === 'p1' || cmd.actor === 'p2' ? this.state.players[cmd.actor].name : 'Table';
    const text = `${who} undid the last action`;
    this.lastText = text;
    this.lastAlert = false;
    this.save({ state: this.state, drop: [snap.key], log: [this.entry('undo', cmd.actor, { undoneSeq: undone, text })] });
    this.emit('state', this.state, { version: this.version, text, alert: false, actor: cmd.actor, undo: true });
    return { ok: true, version: this.version };
  }

  /**
   * Logged, broadcast events that do not change state. Randomness results are filled here.
   * @param {Notice} n
   */
  notice(n) {
    const payload = { ...(n.payload || {}) };
    if (n.kind === 'coinFlip') payload.result = this.random(1)[0] < 0.5 ? 'heads' : 'tails';
    if (n.kind === 'rollDie') {
      const sides = Math.max(2, Math.min(1000, parseInt(payload.sides, 10) || 6));
      payload.sides = sides;
      payload.result = 1 + Math.floor(this.random(1)[0] * sides);
    }
    if (n.kind === 'randomPick') {
      const ids = this.state.zones[payload.zone] || [];
      if (!ids.length) return { ok: false, error: 'invalid', detail: 'zone is empty' };
      payload.cardId = ids[Math.floor(this.random(1)[0] * ids.length)];
    }
    const notice = { kind: n.kind, actor: n.actor, payload };
    notice.text = describeNotice(notice, this.state);
    notice.alert = ALERT_NOTICES.has(n.kind);
    const entry = this.entry('notice', n.actor, { notice, text: notice.text });
    notice.seq = entry.seq;
    this.save({ state: this.state, log: [entry] });
    this.emit('notice', notice);
    // Closing a search shuffles that library.
    if (n.kind === 'searchClose' && payload.zone && zoneKind(payload.zone) === 'library') {
      this.dispatch({ type: 'shuffle', actor: n.actor, payload: { zone: payload.zone } });
    }
    return { ok: true, notice };
  }

  /** Build a log entry. */
  entry(kind, actor, extra) {
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

  log(entries) { this.save({ state: this.state, log: entries }); }

  save(c) {
    if (!this.persist) return;
    const job = () => this.persist.commit({ state: c.state, push: c.push, drop: c.drop || [], log: c.log || [] });
    this.saving = this.saving.then(job, job).catch((e) => console.error('save failed', e));
  }

  /** Locate a card (used by UI helpers). */
  zoneOf(id) { return findZone(this.state, id); }
}
