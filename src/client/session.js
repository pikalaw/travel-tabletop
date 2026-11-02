// Game sessions: the object the UI talks to. Three kinds share one interface:
//   - LocalSession: same-device play, or the host side of a networked game (owns a Host)
//   - GuestSession: the guest side of a networked game (talks to the host over a Transport)
// Interface: state, version, lastText, status, subscribe(fn), onNotice(fn), send(type, payload, actor)

import { Host } from '../host/host.js';
import { PROTOCOL_VERSION, APP_VERSION } from '../version.js';

class Emitter {
  constructor() { this.subs = new Set(); this.noticeSubs = new Set(); this.rejectSubs = new Set(); }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  onNotice(fn) { this.noticeSubs.add(fn); return () => this.noticeSubs.delete(fn); }
  onReject(fn) { this.rejectSubs.add(fn); return () => this.rejectSubs.delete(fn); }
  changed(info) { for (const fn of this.subs) fn(info); }
  noticed(n) { for (const fn of this.noticeSubs) fn(n); }
  rejected(r) { for (const fn of this.rejectSubs) fn(r); }
}

/** Same-device play, and the host side of networked play. */
export class LocalSession extends Emitter {
  /**
   * @param {Host} host
   * @param {{ mode: 'same-device' | 'host', me?: 'p1' | 'p2' }} opts
   */
  constructor(host, opts) {
    super();
    this.host = host;
    this.kind = opts.mode;
    this.me = opts.me || 'p1';
    this.transport = null;
    this.guestPlayer = 'p2';
    this.status = opts.mode === 'host' ? 'waiting' : 'open';
    this.notices = [];
    host.on('state', (state, info) => {
      this.changed(info);
      this.forward({ type: 'state', version: host.version, state, text: info.text, alert: info.alert, actor: info.actor, clientSeq: info.actor === this.guestPlayer ? info.clientSeq : undefined });
    });
    host.on('notice', (n) => {
      this.notices.push(n);
      this.noticed(n);
      this.forward({ type: 'notice', notice: n });
    });
  }

  get state() { return this.host.state; }
  get version() { return this.host.version; }
  get lastText() { return this.host.lastText; }
  get lastAlert() { return this.host.lastAlert; }

  /** Send a command or notice. Actor comes from the caller (UI decides viewer/table). */
  send(type, payload, actor) {
    const res = this.host.dispatch({ type, actor, payload });
    if (!res.ok) this.rejected({ type, reason: res.error, detail: res.detail });
    return res;
  }

  forward(msg) { if (this.transport && this.status === 'open') this.transport.send(msg); }

  /** Attach a guest transport (networked host). */
  attach(transport, onGuestMessage) {
    this.transport?.close?.();
    this.transport = transport;
    this.status = transport.status === 'open' ? 'open' : 'connecting';
    this.changed({ status: this.status });
    transport.onStatus((s) => {
      if (this.transport !== transport) return;
      this.status = s === 'open' ? 'open' : 'lost';
      this.changed({ status: this.status });
    });
    transport.onMessage((msg) => {
      if (this.transport !== transport) return;
      if (msg.type === 'command') {
        const cmd = msg.cmd || {};
        const res = this.host.dispatch({ type: cmd.type, actor: this.guestPlayer, payload: cmd.payload, clientSeq: cmd.clientSeq });
        if (!res.ok) transport.send({ type: 'rejected', clientSeq: cmd.clientSeq, reason: res.error, detail: res.detail });
      } else {
        onGuestMessage?.(msg, transport);
      }
    });
  }

  /** Full state to the guest (after welcome or reconnect). */
  sendFullState() {
    this.forward({ type: 'state', version: this.host.version, state: this.host.state, text: this.host.lastText, alert: false });
  }
}

/** The guest side of a networked game. */
export class GuestSession extends Emitter {
  constructor(transport, { me = 'p2', state, version = 0 } = {}) {
    super();
    this.kind = 'guest';
    this.me = me;
    this.transport = null;
    this.state = state;
    this.version = version;
    this.lastText = '';
    this.lastAlert = false;
    this.status = 'open';
    this.clientSeq = 1;
    this.notices = [];
    if (transport) this.attach(transport);
  }

  attach(transport) {
    this.transport?.close?.();
    this.transport = transport;
    this.status = transport.status === 'open' || transport.status === undefined ? 'open' : 'connecting';
    this.changed({ status: this.status });
    transport.onStatus((s) => {
      if (this.transport !== transport) return;
      this.status = s === 'open' ? 'open' : 'lost';
      this.changed({ status: this.status });
    });
    transport.onMessage((msg) => {
      if (this.transport !== transport) return;
      if (msg.type === 'state') {
        if (msg.version < this.version && msg.version !== 0) return;
        this.state = msg.state;
        this.version = msg.version;
        this.lastText = msg.text || this.lastText;
        this.lastAlert = !!msg.alert;
        this.changed({ version: msg.version, text: msg.text, alert: msg.alert, actor: msg.actor });
      } else if (msg.type === 'notice') {
        this.notices.push(msg.notice);
        this.noticed(msg.notice);
      } else if (msg.type === 'rejected') {
        this.rejected({ reason: msg.reason, detail: msg.detail, clientSeq: msg.clientSeq });
        this.changed({ version: this.version }); // re-render from host state: the card snaps back
      }
    });
  }

  send(type, payload) {
    if (this.status !== 'open') {
      this.rejected({ type, reason: 'offline', detail: 'Reconnecting — the board is read-only.' });
      return { ok: false, error: 'offline' };
    }
    this.transport.send({ type: 'command', cmd: { type, payload, clientSeq: this.clientSeq++ } });
    return { ok: true, pending: true };
  }
}

/** The guest's first message after the channel opens. */
export function helloMessage({ name, decks, tokens, gameId }) {
  return { type: 'hello', protocolVersion: PROTOCOL_VERSION, appVersion: APP_VERSION, name, decks, tokens, gameId: gameId || null };
}

export { Host };
