// Peer-to-peer transport over one reliable, ordered WebRTC data channel, paired by
// exchanging one offer and one answer (QR code or pasted text). No STUN/TURN: LAN only.

import { encodeSignal, decodeSignal } from './codec.js';

const CHUNK = 15000;          // characters per data-channel message (safe across browsers)
const PING_MS = 2000;
const LOST_MS = 7000;

/** Wait for ICE gathering to finish so one blob carries every candidate (no trickle). */
function gathered(pc, timeoutMs = 4000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(t); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Safari and Chrome hide local IP addresses from WebRTC unless the page has camera access.
 * Asking for the camera once (we need it to scan codes anyway) lets devices connect directly.
 * Returns true if access was granted.
 */
export async function unlockLocalNetwork() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch { return false; }
}

/** Host side, step 1: create the offer. */
export async function createOffer() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('mtg', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = encodeSignal('offer', pc.localDescription.sdp);
  return { pc, dc, code };
}

/** Host side, step 2: accept the guest's answer. Resolves with a Transport when the channel opens. */
export async function acceptAnswer(pc, dc, answerCode) {
  const { kind, sdp } = decodeSignal(answerCode);
  if (kind !== 'answer') throw new Error('That is an offer code. Scan the code shown on the guest device.');
  await pc.setRemoteDescription({ type: 'answer', sdp });
  return openTransport(pc, dc);
}

/** Guest side: accept the host's offer and produce an answer code. */
export async function answerOffer(offerCode) {
  const { kind, sdp } = decodeSignal(offerCode);
  if (kind !== 'offer') throw new Error('That is an answer code. Scan the code shown on the host device.');
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dcP = new Promise((resolve) => { pc.ondatachannel = (e) => resolve(e.channel); });
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const code = encodeSignal('answer', pc.localDescription.sdp);
  const transport = dcP.then((dc) => openTransport(pc, dc));
  return { pc, code, transport };
}

function openTransport(pc, dc) {
  return new Promise((resolve, reject) => {
    const t = new ChannelTransport(pc, dc);
    if (dc.readyState === 'open') return resolve(t);
    const timer = setTimeout(() => reject(new Error('Could not connect. Make sure both devices are on the same Wi-Fi or hotspot.')), 20000);
    dc.addEventListener('open', () => { clearTimeout(timer); t.markOpen(); resolve(t); }, { once: true });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') { clearTimeout(timer); reject(new Error('Connection failed. Both devices must be on the same local network.')); }
    });
  });
}

/** The Transport interface used by the rest of the app. */
export class ChannelTransport {
  constructor(pc, dc) {
    this.pc = pc;
    this.dc = dc;
    this.handlers = new Set();
    this.statusHandlers = new Set();
    this.status = dc.readyState === 'open' ? 'open' : 'connecting';
    this.lastSeen = Date.now();
    this.parts = new Map();
    this.nextId = 1;
    dc.onmessage = (e) => this.receive(e.data);
    dc.onclose = () => this.setStatus('lost');
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.setStatus('lost');
    });
    this.timer = setInterval(() => {
      if (this.status !== 'open') return;
      this.raw({ t: 'ping', ts: Date.now() });
      if (Date.now() - this.lastSeen > LOST_MS) this.setStatus('lost');
    }, PING_MS);
  }

  markOpen() { this.lastSeen = Date.now(); this.setStatus('open'); }

  setStatus(s) {
    if (this.status === s || this.status === 'closed') return;
    this.status = s;
    for (const fn of this.statusHandlers) fn(s);
  }

  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  onStatus(fn) { this.statusHandlers.add(fn); return () => this.statusHandlers.delete(fn); }

  raw(obj) {
    if (this.dc.readyState !== 'open') return false;
    try { this.dc.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  send(msg) {
    const text = JSON.stringify(msg);
    if (text.length <= CHUNK) return this.raw({ t: 'msg', m: msg });
    const id = this.nextId++;
    const n = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < n; i++) this.raw({ t: 'part', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    return true;
  }

  receive(data) {
    this.lastSeen = Date.now();
    if (this.status === 'lost' && this.dc.readyState === 'open') this.setStatus('open');
    let obj;
    try { obj = JSON.parse(data); } catch { return; }
    if (obj.t === 'ping') return;
    if (obj.t === 'msg') return this.deliver(obj.m);
    if (obj.t === 'part') {
      const buf = this.parts.get(obj.id) || [];
      buf[obj.i] = obj.d;
      this.parts.set(obj.id, buf);
      if (buf.filter((x) => x != null).length === obj.n) {
        this.parts.delete(obj.id);
        try { this.deliver(JSON.parse(buf.join(''))); } catch (e) { console.error('bad chunked message', e); }
      }
    }
  }

  deliver(msg) { for (const fn of this.handlers) { try { fn(msg); } catch (e) { console.error(e); } } }

  close() {
    clearInterval(this.timer);
    this.setStatus('closed');
    this.status = 'closed';
    try { this.dc.close(); } catch {}
    try { this.pc.close(); } catch {}
  }
}

/** An in-memory pair of transports, for tests and for local two-player debugging. */
export function memoryPair() {
  const mk = () => ({
    handlers: new Set(), statusHandlers: new Set(), status: 'open', peer: null,
    onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); },
    onStatus(fn) { this.statusHandlers.add(fn); return () => this.statusHandlers.delete(fn); },
    send(msg) { const p = this.peer; const copy = JSON.parse(JSON.stringify(msg)); queueMicrotask(() => p.handlers.forEach((fn) => fn(copy))); return true; },
    close() { this.status = 'closed'; },
  });
  const a = mk(), b = mk();
  a.peer = b; b.peer = a;
  return [a, b];
}
