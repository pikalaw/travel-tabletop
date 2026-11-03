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
 * Safari and Chrome hide local IP addresses from WebRTC unless the page has camera access.
 * Asking for the camera once (we need it to scan codes anyway) lets devices connect directly.
 * Returns true if access was granted.
 */
export async function unlockLocalNetwork(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch { return false; }
}

/** Host side, step 1: create the offer. */
export async function createOffer(): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel; code: string }> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('mtg', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = encodeSignal('offer', pc.localDescription!.sdp);
  return { pc, dc, code };
}

/** Host side, step 2: accept the guest's answer. Resolves with a Transport when the channel opens. */
export async function acceptAnswer(pc: RTCPeerConnection, dc: RTCDataChannel, answerCode: string): Promise<ChannelTransport> {
  const { kind, sdp } = decodeSignal(answerCode);
  if (kind !== 'answer') throw new Error('That is an offer code. Scan the code shown on the guest device.');
  await pc.setRemoteDescription({ type: 'answer', sdp });
  return openTransport(pc, dc);
}

/** Guest side: accept the host's offer and produce an answer code. */
export async function answerOffer(offerCode: string): Promise<{ pc: RTCPeerConnection; code: string; transport: Promise<ChannelTransport> }> {
  const { kind, sdp } = decodeSignal(offerCode);
  if (kind !== 'offer') throw new Error('That is an answer code. Scan the code shown on the host device.');
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dcP = new Promise<RTCDataChannel>((resolve) => { pc.ondatachannel = (e) => resolve(e.channel); });
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const code = encodeSignal('answer', pc.localDescription!.sdp);
  const transport = dcP.then((dc) => openTransport(pc, dc));
  return { pc, code, transport };
}

function openTransport(pc: RTCPeerConnection, dc: RTCDataChannel): Promise<ChannelTransport> {
  return new Promise((resolve, reject) => {
    const t = new ChannelTransport(pc, dc);
    if (dc.readyState === 'open') { resolve(t); return; }
    const timer = setTimeout(() => reject(new Error('Could not connect. Make sure both devices are on the same Wi-Fi or hotspot.')), 20000);
    dc.addEventListener('open', () => { clearTimeout(timer); t.markOpen(); resolve(t); }, { once: true });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') { clearTimeout(timer); reject(new Error('Connection failed. Both devices must be on the same local network.')); }
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
