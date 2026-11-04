// Peer-to-peer transport over one reliable, ordered WebRTC data channel, paired by
// exchanging one offer and one answer (QR code or pasted text). No STUN/TURN: LAN only.

import { encodeSignal, decodeSignal } from './codec';
import { Reassembler, frames, type Transport, type TransportStatus } from './transport';

const PING_MS = 2000;
const LOST_MS = 7000;

/** Wait for ICE gathering to finish so one blob carries every candidate (no trickle). */
function gathered(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(t); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Browsers hide a device's local IP addresses from WebRTC (they offer a random "….local" name
 * instead) unless the page may use the camera; Safari is stricter and shows them only while the
 * camera is actually running. Two devices on a shared network often can't resolve each other's
 * ".local" names, so the pairing code is built while a camera stream is open.
 */
async function openCamera(ask: boolean): Promise<MediaStream | null> {
  try {
    if (!ask) {
      // Without asking: only when the camera is already allowed (no prompt appears).
      const p = await navigator.permissions?.query({ name: 'camera' as PermissionName }).catch(() => null);
      if (p?.state !== 'granted') return null;
    }
    return await navigator.mediaDevices.getUserMedia({ video: true });
  } catch { return null; }
}

const stopCamera = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

/** What a pairing code tells the other device about how to reach this one. */
export interface Reachability {
  /** IP addresses the other device can try directly. */
  direct: number;
  /** Hidden ".local" names, which only work where the network passes mDNS. */
  hidden: number;
  /** The direct addresses themselves (local network addresses, for diagnosing). */
  addresses: string[];
}

export function reachability(sdp: string): Reachability {
  let direct = 0, hidden = 0;
  const addresses: string[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    const m = /^a=candidate:\S+ \d+ (\S+) \d+ (\S+) \d+ typ host/i.exec(line);
    if (!m) continue;
    if (m[2]!.toLowerCase().endsWith('.local')) hidden++;
    else { direct++; addresses.push(`${m[2]} ${m[1]!.toLowerCase()}`); }
  }
  return { direct, hidden, addresses };
}

export const describeReachability = (r: Reachability) =>
  `${r.direct} direct address${r.direct === 1 ? '' : 'es'}${r.addresses.length ? ` (${r.addresses.join(', ')})` : ''}, ${r.hidden} hidden (.local)`;

/** Connectivity checks seen while connecting: address pairs tried and ICE check counts. */
interface Checks { pairs: number; succeeded: number; sent: number; answered: number; received: number }

async function readChecks(pc: RTCPeerConnection): Promise<Checks | null> {
  try {
    const c: Checks = { pairs: 0, succeeded: 0, sent: 0, answered: 0, received: 0 };
    (await pc.getStats()).forEach((r: { type?: string; state?: string; requestsSent?: number; responsesReceived?: number; requestsReceived?: number }) => {
      if (r.type !== 'candidate-pair') return;
      c.pairs++;
      c.sent += r.requestsSent || 0;
      c.answered += r.responsesReceived || 0;
      c.received += r.requestsReceived || 0;
      if (r.state === 'succeeded') c.succeeded++;
    });
    return c;
  } catch { return null; }
}

/** The most checks seen in either reading (a failed connection may drop its stats). */
const most = (a: Checks | null, b: Checks | null): Checks | null =>
  !a ? b : !b ? a : { pairs: Math.max(a.pairs, b.pairs), succeeded: Math.max(a.succeeded, b.succeeded), sent: Math.max(a.sent, b.sent), answered: Math.max(a.answered, b.answered), received: Math.max(a.received, b.received) };

const describeChecks = (c: Checks | null) => (c
  ? `${c.pairs} address pair${c.pairs === 1 ? '' : 's'} tried, ${c.succeeded} worked; checks sent ${c.sent}, answered ${c.answered}, received ${c.received}`
  : 'no connection statistics');

/** Host side, step 1: create the offer. With `camera`, the camera runs while it is built. */
export async function createOffer(camera = false): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel; code: string; reach: Reachability }> {
  const cam = await openCamera(camera);
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const dc = pc.createDataChannel('mtg', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const sdp = pc.localDescription!.sdp;
    return { pc, dc, code: encodeSignal('offer', sdp), reach: reachability(sdp) };
  } finally { stopCamera(cam); }
}

/** Host side, step 2: accept the guest's answer. Resolves with a Transport when the channel opens. */
export async function acceptAnswer(pc: RTCPeerConnection, dc: RTCDataChannel, answerCode: string): Promise<ChannelTransport> {
  const { kind, sdp } = decodeSignal(answerCode);
  if (kind !== 'answer') throw new Error('That is an offer code. Scan the code shown on the guest device.');
  await pc.setRemoteDescription({ type: 'answer', sdp });
  return openTransport(pc, dc, reachability(sdp));
}

/** Guest side: accept the host's offer and produce an answer code. */
export async function answerOffer(offerCode: string): Promise<{ pc: RTCPeerConnection; code: string; reach: Reachability; transport: Promise<ChannelTransport> }> {
  const { kind, sdp } = decodeSignal(offerCode);
  if (kind !== 'offer') throw new Error('That is an answer code. Scan the code shown on the host device.');
  const cam = await openCamera(false);
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const dcP = new Promise<RTCDataChannel>((resolve) => { pc.ondatachannel = (e) => resolve(e.channel); });
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    const mine = pc.localDescription!.sdp;
    // Watch from now, not from when the channel arrives: a failure must show here too.
    const transport = openTransport(pc, dcP, reachability(sdp), null);
    return { pc, code: encodeSignal('answer', mine), reach: reachability(mine), transport };
  } finally { stopCamera(cam); }
}

/** Live connection progress while pairing, for the pairing screens. */
export interface ConnectionProgress { state: string; checks: Checks | null }

/** Call `fn` every second with the connection's state and checks until the returned stop(). */
export function watchConnection(pc: RTCPeerConnection, fn: (p: ConnectionProgress) => void): () => void {
  let seen: Checks | null = null;
  const tick = () => void readChecks(pc).then((c) => { seen = most(seen, c); fn({ state: pc.iceConnectionState, checks: seen }); });
  tick();
  const t = setInterval(tick, 1000);
  return () => clearInterval(t);
}

export const describeProgress = (p: ConnectionProgress) => `connection ${p.state}; ${describeChecks(p.checks)}`;

/**
 * Resolve with a Transport when the data channel opens, or fail with a report. `timeoutMs` null
 * waits as long as it takes (the guest waits for the host to scan its code).
 */
function openTransport(pc: RTCPeerConnection, channel: RTCDataChannel | Promise<RTCDataChannel>, other: Reachability, timeoutMs: number | null = 20000): Promise<ChannelTransport> {
  return new Promise((resolve, reject) => {
    const states = [pc.iceConnectionState as string];
    pc.addEventListener('iceconnectionstatechange', () => states.push(pc.iceConnectionState));
    let checks: Checks | null = null;
    const poll = setInterval(() => void readChecks(pc).then((c) => { checks = most(checks, c); }), 1000);
    // What to show when it fails: how each side said it could be reached, and how far ICE got.
    let done = false;
    const fail = async (message: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      const mine = reachability(pc.localDescription?.sdp || '');
      checks = most(checks, await readChecks(pc));
      reject(new Error(`${message} (Details: this device offered ${describeReachability(mine)}; the other device offered ${describeReachability(other)}; states ${states.join(' → ')}; ${describeChecks(checks)}.)`));
    };
    const timer = timeoutMs === null ? undefined : setTimeout(() => void fail('Could not connect. Make sure both devices are on the same Wi-Fi. A hotspot must come from a third device, not one of the two playing, and the network must let its devices reach each other.'), timeoutMs);
    void Promise.resolve(channel).then((dc) => {
      if (done) return;
      const t = new ChannelTransport(pc, dc);
      const opened = () => { if (done) return; done = true; clearTimeout(timer); clearInterval(poll); t.markOpen(); resolve(t); };
      if (dc.readyState === 'open') opened();
      else dc.addEventListener('open', opened, { once: true });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') void fail('Connection failed. Both devices must be on the same local network.');
    });
  });
}

/** The Transport over a data channel, with keep-alive pings and chunking of long messages. */
export class ChannelTransport implements Transport {
  status: TransportStatus;
  private handlers = new Set<(msg: unknown) => void>();
  private statusHandlers = new Set<(s: TransportStatus) => void>();
  private lastSeen = Date.now();
  private reassembler = new Reassembler();
  private nextId = 1;
  private timer: ReturnType<typeof setInterval>;

  constructor(private pc: RTCPeerConnection, private dc: RTCDataChannel) {
    this.status = dc.readyState === 'open' ? 'open' : 'connecting';
    dc.onmessage = (e: MessageEvent) => this.receive(e.data);
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

  markOpen(): void { this.lastSeen = Date.now(); this.setStatus('open'); }

  private setStatus(s: TransportStatus): void {
    if (this.status === s || this.status === 'closed') return;
    this.status = s;
    for (const fn of this.statusHandlers) fn(s);
  }

  onMessage(fn: (msg: unknown) => void) { this.handlers.add(fn); return () => { this.handlers.delete(fn); }; }
  onStatus(fn: (s: TransportStatus) => void) { this.statusHandlers.add(fn); return () => { this.statusHandlers.delete(fn); }; }

  private raw(obj: unknown): boolean {
    if (this.dc.readyState !== 'open') return false;
    try { this.dc.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  send(msg: unknown): boolean {
    for (const f of frames(msg, this.nextId++)) this.raw(f);
    return true;
  }

  private receive(data: unknown): void {
    this.lastSeen = Date.now();
    if (this.status === 'lost' && this.dc.readyState === 'open') this.setStatus('open');
    const got = this.reassembler.push(data);
    if (got) for (const fn of this.handlers) { try { fn(got.message); } catch (e) { console.error(e); } }
  }

  close(): void {
    clearInterval(this.timer);
    this.setStatus('closed');
    this.status = 'closed';
    try { this.dc.close(); } catch { /* already closed */ }
    try { this.pc.close(); } catch { /* already closed */ }
  }
}
