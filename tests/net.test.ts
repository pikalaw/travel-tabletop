// Ported from v1's tests/net.test.js (codec, host and guest over a transport), plus the v2
// message guards, framing, and the handshake.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeSignal, decodeSignal } from '../src/transport/codec';
import { memoryPair, frames, Reassembler } from '../src/transport/transport';
import { Host } from '../src/host/host';
import { LocalSession, GuestSession, type Rejection } from '../src/client/session';
import { asGuestMessage, asHostMessage, buildHello, guestHandshake, hostHandshake } from '../src/client/net';
import { putDef, putDeck } from '../src/storage/db';
import { APP_VERSION } from '../src/version';
import type { HelloMessage } from '../src/types/protocol';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('pairing codec', () => {
  it('round-trips an SDP and rejects junk', () => {
    const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0\r\na=ice-ufrag:abcd\r\na=ice-pwd:0123456789abcdefghijklmn\r\na=fingerprint:sha-256 AA:BB\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\n';
    const code = encodeSignal('offer', sdp);
    expect(code.startsWith('MTG1o')).toBe(true);
    const back = decodeSignal(`  ${code}\n`);
    expect(back.kind).toBe('offer');
    expect(back.sdp).toContain('typ host');
    expect(() => decodeSignal('hello')).toThrow();
    expect(() => decodeSignal('MTG1oAAAA')).toThrow();
  });
});

describe('framing', () => {
  it('splits long messages into parts and reassembles them in any order', () => {
    fc.assert(fc.property(fc.string({ maxLength: 3000 }), fc.integer({ min: 10, max: 400 }), fc.integer(), (text, chunk, seed) => {
      const msg = { type: 'state', text };
      const fs = frames(msg, 7, chunk).map((f) => JSON.stringify(f));
      // shuffle deterministically
      const order = fs.map((f, i) => [Math.sin(seed + i), f] as const).sort((a, b) => a[0] - b[0]).map(([, f]) => f);
      const r = new Reassembler();
      const out = order.map((f) => r.push(f)).filter(Boolean);
      expect(out).toEqual([{ message: msg }]);
    }), { numRuns: 100 });
  });
  it('drops pings, junk and malformed parts', () => {
    const r = new Reassembler();
    for (const raw of ['nope', '{"t":"ping","ts":1}', '{"t":"part","id":1,"i":5,"n":2,"d":"x"}', '{"t":"part","id":1,"i":0,"n":1e9,"d":"x"}', '42', 'null']) {
      expect(r.push(raw)).toBeUndefined();
    }
  });
});

describe('message guards', () => {
  it('accept the messages each side sends and drop anything else', () => {
    expect(asGuestMessage({ type: 'command', cmd: { type: 'tap', payload: {}, clientSeq: 1 } })?.type).toBe('command');
    expect(asGuestMessage({ type: 'command', cmd: 'tap' })).toBeNull();
    expect(asGuestMessage({ type: 'state', state: {} })).toBeNull(); // a guest cannot send state
    expect(asGuestMessage({ type: 'hello', protocolVersion: 1, appVersion: '0.1.0', name: 'G', spec: { cards: [] }, gameId: null })?.type).toBe('hello');
    expect(asGuestMessage({ type: 'hello', name: 'G' })).toBeNull();
    expect(asHostMessage({ type: 'state', version: 1, state: { nope: true } })).toBeNull();
    expect(asHostMessage({ type: 'rejected', reason: 'stale' })?.type).toBe('rejected');
    expect(asHostMessage({ type: 'command', cmd: { type: 'tap' } })).toBeNull(); // a host does not send commands
    fc.assert(fc.property(fc.anything(), (x) => { asGuestMessage(x); asHostMessage(x); }));
  });
});

describe('host and guest over a transport', () => {
  function setup() {
    const host = new Host({ random: (n) => Array.from({ length: n }, (_, i) => ((i * 7919) % 1000) / 1000) });
    host.dispatch({ type: 'startGame', actor: 'host', payload: { gameId: 'g', mode: 'networked', players: {
      p1: { name: 'H', cards: Array.from({ length: 20 }, (_, i) => ({ defId: 'a', name: `a${i}` })) },
      p2: { name: 'G', cards: Array.from({ length: 20 }, (_, i) => ({ defId: 'b', name: `b${i}` })) },
    } } });
    const hs = new LocalSession(host, { mode: 'host', me: 'p1' });
    const [ht, gt] = memoryPair();
    hs.attach(ht);
    const gs = new GuestSession(gt, { me: 'p2', state: host.state, version: host.version });
    return { host, hs, gs };
  }

  it('guest commands apply on the host with the guest as actor, and state flows back', async () => {
    const { host, gs } = setup();
    const id = gs.state.zones['p2.hand'][0];
    gs.send('move', { cardId: id, from: 'p2.hand', to: 'p2.battlefield' });
    await tick(); await tick();
    expect(host.state.zones['p2.battlefield']).toEqual([id]);
    expect(gs.state.zones['p2.battlefield']).toEqual([id]);
    expect(gs.lastText).toContain('G');
  });

  it('a stale guest command is rejected and the guest is told', async () => {
    const { hs, gs } = setup();
    const id = gs.state.zones['p2.hand'][0];
    hs.send('move', { cardId: id, from: 'p2.hand', to: 'p2.graveyard' }, 'p1');
    const rejects: Rejection[] = [];
    gs.onReject((r) => rejects.push(r));
    gs.send('move', { cardId: id, from: 'p2.hand', to: 'p2.battlefield' }); // guest has not seen the move yet
    await tick(); await tick(); await tick();
    expect(rejects[0]?.reason).toBe('stale');
    expect(gs.state.zones['p2.graveyard']).toContain(id);
  });

  it('notices reach the other side', async () => {
    const { hs, gs } = setup();
    const seen: string[] = [];
    hs.onNotice((n) => seen.push(n.kind));
    gs.send('peek', { zone: 'p2.library', n: 2 });
    await tick(); await tick();
    expect(seen).toContain('peek');
  });

  it('the host sets the actor of every guest command to the guest', async () => {
    const { host, gs } = setup();
    const actors: string[] = [];
    host.on('state', (_s, info) => actors.push(info.actor));
    gs.send('draw', { player: 'p2', n: 1 });
    gs.send('undo', {});
    await tick(); await tick(); await tick();
    expect(actors).toEqual(['p2', 'p2']);
  });
});

describe('handshake', () => {
  it('a guest with the decks joins; the welcome carries the state; a guest missing cards is refused', async () => {
    await putDef({ id: 'b', name: 'Bear', front: 'f', back: null });
    await putDeck({ id: 'gd', name: 'Guest deck', kind: 'deck', cards: ['b', 'b'], createdAt: 1 });
    const host = new Host({ random: (n) => Array.from({ length: n }, () => 0.5) });
    const hs = new LocalSession(host, { mode: 'host' });
    const [ht, gt] = memoryPair();
    const errors: string[] = [];
    let readyName = '';
    hostHandshake(hs, ht, {
      startNew: async (hello) => {
        host.dispatch({ type: 'startGame', actor: 'host', payload: { gameId: 'g2', mode: 'networked', players: { p1: { name: 'H', cards: [] }, p2: { name: hello.name, cards: hello.spec.cards } } } });
      },
      onReady: (hello) => { readyName = hello.name; },
      onError: (m) => errors.push(m),
    });
    const hello = await buildHello({ name: 'Claire', decks: [{ id: 'gd', name: 'Guest deck', kind: 'deck', cards: ['b', 'b'], createdAt: 1 }] });
    expect(hello).toMatchObject({ type: 'hello', appVersion: APP_VERSION, name: 'Claire', gameId: null });
    const welcome = await guestHandshake(gt, hello);
    expect(welcome.player).toBe('p2');
    expect(welcome.state.zones['p2.hand']).toHaveLength(2);
    expect(readyName).toBe('Claire');
    expect(errors).toEqual([]);

    const [ht2, gt2] = memoryPair();
    hostHandshake(new LocalSession(new Host(), { mode: 'host' }), ht2, { startNew: async () => {}, onReady: () => {}, onError: (m) => errors.push(m) });
    const bad: HelloMessage = { ...hello, spec: { cards: [{ defId: 'zzz', name: 'Missing Card', deckId: 'x' }], commanders: [] } };
    await expect(guestHandshake(gt2, bad)).rejects.toThrow(/missing 1 of your cards/);
    expect(errors[0]).toContain('Missing Card');

    const [ht3, gt3] = memoryPair();
    hostHandshake(new LocalSession(new Host(), { mode: 'host' }), ht3, { startNew: async () => {}, onReady: () => {}, onError: () => {} });
    await expect(guestHandshake(gt3, { ...hello, appVersion: '9.9.9' })).rejects.toThrow(/Update both devices/);

    const [ht4, gt4] = memoryPair();
    hostHandshake(new LocalSession(new Host(), { mode: 'host' }), ht4, { startNew: async () => {}, onReady: () => {}, onError: () => {} });
    await expect(guestHandshake(gt4, { ...hello, protocolVersion: 1 })).rejects.toThrow(/different builds/);
  });
});

describe('reachability', () => {
  it('counts direct addresses and hidden .local names in a code’s candidates', async () => {
    const { reachability } = await import('../src/transport/webrtc');
    const sdp = [
      'a=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0',
      'a=candidate:2 1 udp 2122260223 fe80::1 54322 typ host generation 0',
      'a=candidate:3 1 udp 2122260223 6b1f2a3c-0d4e-4f5a-9b8c-7d6e5f4a3b2c.local 54323 typ host generation 0',
      'a=candidate:4 1 udp 1686052607 203.0.113.9 54324 typ srflx raddr 0.0.0.0 rport 0',
    ].join('\r\n');
    expect(reachability(sdp)).toEqual({ direct: 2, hidden: 1 });
  });
});
