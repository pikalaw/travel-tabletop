// The Transport interface the sessions use, the data-channel framing, and an in-memory pair.

import type { Frame } from '../types/protocol';

export type TransportStatus = 'connecting' | 'open' | 'lost' | 'closed';

/** A message channel to the other device. Messages arrive as `unknown`: the receiver checks them. */
export interface Transport {
  readonly status: TransportStatus;
  send(msg: unknown): boolean;
  onMessage(fn: (msg: unknown) => void): () => void;
  onStatus(fn: (s: TransportStatus) => void): () => void;
  close(): void;
}

/** Characters per data-channel message (safe across browsers). */
export const CHUNK = 15000;

/** Split a message into frames: one `msg`, or `part`s of a long one. */
export function frames(msg: unknown, id: number, chunk = CHUNK): Frame[] {
  const text = JSON.stringify(msg);
  if (text.length <= chunk) return [{ t: 'msg', m: msg as never }];
  const n = Math.ceil(text.length / chunk);
  return Array.from({ length: n }, (_, i) => ({ t: 'part', id, i, n, d: text.slice(i * chunk, (i + 1) * chunk) }));
}

/** Reassembles framed messages. `push` returns a complete message, or undefined. */
export class Reassembler {
  private parts = new Map<number, (string | undefined)[]>();

  push(raw: unknown): { message: unknown } | undefined {
    let obj: unknown;
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : undefined; } catch { return undefined; }
    if (typeof obj !== 'object' || obj === null) return undefined;
    const f = obj as Record<string, unknown>;
    if (f.t === 'msg') return { message: f.m };
    if (f.t !== 'part') return undefined; // ping, or junk
    const { id, i, n, d } = f;
    if (typeof id !== 'number' || typeof i !== 'number' || typeof n !== 'number' || typeof d !== 'string'
      || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 10000 || i < 0 || i >= n) return undefined;
    const buf = this.parts.get(id) || [];
    buf[i] = d;
    this.parts.set(id, buf);
    if (buf.filter((x) => x != null).length !== n) return undefined;
    this.parts.delete(id);
    try { return { message: JSON.parse(buf.join('')) }; } catch { console.error('bad chunked message'); return undefined; }
  }
}

/** An in-memory pair of transports, for tests and for local two-player debugging. */
export function memoryPair(): [Transport, Transport] {
  class Mem implements Transport {
    status: TransportStatus = 'open';
    peer: Mem | null = null;
    handlers = new Set<(msg: unknown) => void>();
    statusHandlers = new Set<(s: TransportStatus) => void>();
    onMessage(fn: (msg: unknown) => void) { this.handlers.add(fn); return () => { this.handlers.delete(fn); }; }
    onStatus(fn: (s: TransportStatus) => void) { this.statusHandlers.add(fn); return () => { this.statusHandlers.delete(fn); }; }
    send(msg: unknown) {
      const p = this.peer!;
      const copy: unknown = JSON.parse(JSON.stringify(msg));
      queueMicrotask(() => p.handlers.forEach((fn) => fn(copy)));
      return true;
    }
    close() { this.status = 'closed'; }
  }
  const a = new Mem(), b = new Mem();
  a.peer = b; b.peer = a;
  return [a, b];
}
