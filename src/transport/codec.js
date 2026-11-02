// Pairing codes: a WebRTC offer or answer (SDP text), deflated and base64url-encoded so it
// fits in one QR code or one pasted line. Format: "MTG1" + "o" | "a" + payload.

import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

const PREFIX = 'MTG1';

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Drop SDP lines a data-channel-only LAN connection does not need, to shrink the QR code. */
export function slimSdp(sdp) {
  return sdp.split(/\r?\n/).filter((l) => l && !/^a=(extmap|rtcp-fb|ssrc|msid)/.test(l)
    && !/typ (srflx|relay)/.test(l) && !/ tcptype /.test(l)).join('\r\n') + '\r\n';
}

/** @param {'offer' | 'answer'} kind @param {string} sdp */
export function encodeSignal(kind, sdp) {
  return PREFIX + (kind === 'offer' ? 'o' : 'a') + toB64url(deflateSync(strToU8(slimSdp(sdp)), { level: 9 }));
}

/** @returns {{ kind: 'offer' | 'answer', sdp: string }} */
export function decodeSignal(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t.startsWith(PREFIX) || t.length < 10) throw new Error('This is not a pairing code from this app.');
  const k = t[PREFIX.length];
  if (k !== 'o' && k !== 'a') throw new Error('Unknown pairing code type.');
  let sdp;
  try { sdp = strFromU8(inflateSync(fromB64url(t.slice(PREFIX.length + 1)))); }
  catch { throw new Error('The pairing code is incomplete or damaged.'); }
  return { kind: k === 'o' ? 'offer' : 'answer', sdp };
}
