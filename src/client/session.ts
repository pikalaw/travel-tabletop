// Game sessions: the object the UI talks to. Two kinds share one interface:
//   - LocalSession: same-device play, or the host side of a networked game (owns a Host)
//   - GuestSession: the guest side of a networked game (talks to the host over a Transport)

import type { Host } from '../host/host';
import { asGuestMessage, asHostMessage } from './net';
import type { Actor, GameState, PlayerId } from '../types/state';
import type { Notice } from '../types/commands';
import type { HelloMessage, RefuseMessage, RejectedMessage, StateMessage } from '../types/protocol';
import type { Transport } from '../transport/transport';

export type SessionKind = 'same-device' | 'host' | 'guest';
/** `waiting`: a host with no guest yet; `lost`: the link dropped and may come back. */
export type SessionStatus = 'waiting' | 'connecting' | 'open' | 'lost';

export interface SessionChange {
  version?: number;
  text?: string | undefined;
  alert?: boolean | undefined;
  actor?: Actor | undefined;
  status?: SessionStatus;
  undo?: boolean | undefined;
}

export interface Rejection {
  type?: string;
  reason: string;
  detail?: string | undefined;
  clientSeq?: number | undefined;
}

export type SendResult = { ok: boolean; error?: string | undefined; detail?: string | undefined; pending?: boolean; version?: number | undefined };

/** What the UI needs from any session. */
export interface Session {
  readonly kind: SessionKind;
  readonly me: PlayerId;
  readonly state: GameState;
  readonly version: number;
  readonly lastText: string;
  readonly lastAlert: boolean;
  readonly status: SessionStatus;
  readonly notices: Notice[];
  subscribe(fn: (c: SessionChange) => void): () => void;
  onNotice(fn: (n: Notice) => void): () => void;
  onReject(fn: (r: Rejection) => void): () => void;
  /** Send a command or notice. On one device the UI chooses the actor (viewer or table). */
  send(type: string, payload: unknown, actor?: Actor): SendResult;
}

class Emitter {
  private subs = new Set<(c: SessionChange) => void>();
  private noticeSubs = new Set<(n: Notice) => void>();
  private rejectSubs = new Set<(r: Rejection) => void>();
  subscribe(fn: (c: SessionChange) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  onNotice(fn: (n: Notice) => void) { this.noticeSubs.add(fn); return () => { this.noticeSubs.delete(fn); }; }
  onReject(fn: (r: Rejection) => void) { this.rejectSubs.add(fn); return () => { this.rejectSubs.delete(fn); }; }
  protected changed(info: SessionChange) { for (const fn of this.subs) fn(info); }
  protected noticed(n: Notice) { for (const fn of this.noticeSubs) fn(n); }
  protected rejected(r: Rejection) { for (const fn of this.rejectSubs) fn(r); }
}

/** Messages from the guest that the session does not handle itself (hello, refuse). */
export type GuestControlMessage = HelloMessage | RefuseMessage;

/** Same-device play, and the host side of networked play. */
export class LocalSession extends Emitter implements Session {
  readonly kind: 'same-device' | 'host';
  readonly me: PlayerId;
  readonly guestPlayer: PlayerId = 'p2';
  status: SessionStatus;
  notices: Notice[] = [];
  private transport: Transport | null = null;

  constructor(readonly host: Host, opts: { mode: 'same-device' | 'host'; me?: PlayerId }) {
    super();
    this.kind = opts.mode;
    this.me = opts.me || 'p1';
    this.status = opts.mode === 'host' ? 'waiting' : 'open';
    host.on('state', (state, info) => {
      this.changed(info);
      this.forward({
        type: 'state', version: host.version, state, text: info.text, alert: info.alert, actor: info.actor,
        ...(info.actor === this.guestPlayer && info.clientSeq !== undefined ? { clientSeq: info.clientSeq } : {}),
      } satisfies StateMessage);
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

  send(type: string, payload: unknown, actor: Actor = this.me): SendResult {
    const res = this.host.dispatch({ type, actor, payload });
    if (!res.ok) this.rejected({ type, reason: res.error, detail: res.detail });
    return res;
  }

  private forward(msg: unknown) { if (this.transport && this.status === 'open') this.transport.send(msg); }

  /** Attach a guest transport (networked host). */
  attach(transport: Transport, onGuestMessage?: (msg: GuestControlMessage, transport: Transport) => void): void {
    this.transport?.close();
    this.transport = transport;
    this.status = transport.status === 'open' ? 'open' : 'connecting';
    this.changed({ status: this.status });
    transport.onStatus((s) => {
      if (this.transport !== transport) return;
      this.status = s === 'open' ? 'open' : 'lost';
      this.changed({ status: this.status });
    });
    transport.onMessage((raw) => {
      if (this.transport !== transport) return;
      const msg = asGuestMessage(raw);
      if (!msg) return;
      if (msg.type === 'command') {
        const cmd = msg.cmd;
        const res = this.host.dispatch({ type: cmd.type, actor: this.guestPlayer, payload: cmd.payload, clientSeq: cmd.clientSeq });
        if (!res.ok) transport.send({ type: 'rejected', clientSeq: cmd.clientSeq, reason: res.error, ...(res.detail ? { detail: res.detail } : {}) } satisfies RejectedMessage);
      } else {
        onGuestMessage?.(msg, transport);
      }
    });
  }

  /** Full state to the guest (after welcome or reconnect). */
  sendFullState(): void {
    this.forward({ type: 'state', version: this.host.version, state: this.host.state, text: this.host.lastText, alert: false } satisfies StateMessage);
  }
}

/** The guest side of a networked game. */
export class GuestSession extends Emitter implements Session {
  readonly kind = 'guest';
  readonly me: PlayerId;
  state: GameState;
  version: number;
  lastText = '';
  lastAlert = false;
  status: SessionStatus = 'open';
  notices: Notice[] = [];
  private transport: Transport | null = null;
  private clientSeq = 1;

  constructor(transport: Transport | null, { me = 'p2', state, version = 0 }: { me?: PlayerId; state: GameState; version?: number }) {
    super();
    this.me = me;
    this.state = state;
    this.version = version;
    if (transport) this.attach(transport);
  }

  attach(transport: Transport): void {
    this.transport?.close();
    this.transport = transport;
    this.status = transport.status === 'open' || transport.status === undefined ? 'open' : 'connecting';
    this.changed({ status: this.status });
    transport.onStatus((s) => {
      if (this.transport !== transport) return;
      this.status = s === 'open' ? 'open' : 'lost';
      this.changed({ status: this.status });
    });
    transport.onMessage((raw) => {
      if (this.transport !== transport) return;
      const msg = asHostMessage(raw);
      if (!msg) return;
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

  send(type: string, payload: unknown): SendResult {
    if (this.status !== 'open' || !this.transport) {
      this.rejected({ type, reason: 'offline', detail: 'Reconnecting — the board is read-only.' });
      return { ok: false, error: 'offline' };
    }
    this.transport.send({ type: 'command', cmd: { type, payload, clientSeq: this.clientSeq++ } });
    return { ok: true, pending: true };
  }
}
