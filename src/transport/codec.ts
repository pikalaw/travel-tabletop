// Pairing codes: a WebRTC offer or answer (SDP text), deflated and base64url-encoded so it
// fits in one QR code or one pasted line. Format: "MTG1" + "o" | "a" + payload.

import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

export const SIGNAL_PREFIX = 'MTG1';

export type SignalKind = 'offer' | 'answer';

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Drop SDP lines a data-channel connection does not need, to shrink the QR code: media extras and
 * host TCP candidates. Internet (srflx) and relay candidates stay, for play beyond one network.
 */
export function slimSdp(sdp: string): string {
  return sdp.split(/\r?\n/).filter((l) => l && !/^a=(extmap|rtcp-fb|ssrc|msid)/.test(l)
    && !/ tcptype /.test(l)).join('\r\n') + '\r\n';
}

export function encodeSignal(kind: SignalKind, sdp: string): string {
  return SIGNAL_PREFIX + (kind === 'offer' ? 'o' : 'a') + toB64url(deflateSync(strToU8(slimSdp(sdp)), { level: 9 }));
}

export function decodeSignal(text: unknown): { kind: SignalKind; sdp: string } {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t.startsWith(SIGNAL_PREFIX) || t.length < 10) throw new Error('This is not a pairing code from this app.');
  const k = t[SIGNAL_PREFIX.length];
  if (k !== 'o' && k !== 'a') throw new Error('Unknown pairing code type.');
  let sdp: string;
  try { sdp = strFromU8(inflateSync(fromB64url(t.slice(SIGNAL_PREFIX.length + 1)))); }
  catch { throw new Error('The pairing code is incomplete or damaged.'); }
  return { kind: k === 'o' ? 'offer' : 'answer', sdp };
}
