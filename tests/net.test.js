import { describe, it, expect } from 'vitest';
import { encodeSignal, decodeSignal } from '../src/transport/codec.js';
import { memoryPair } from '../src/transport/webrtc.js';
import { parseDecklist } from '../src/storage/scryfall.js';
import { Host } from '../src/host/host.js';
import { LocalSession, GuestSession } from '../src/client/session.js';

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

describe('decklist parser', () => {
  it('reads common export formats and sections', () => {
    const { entries } = parseDecklist(`Deck
4 Lightning Bolt
4x Counterspell
1 Delver of Secrets (ISD) 51
1 Sol Ring *F*
Sideboard
2 Duress

Commander
1 Krenko, Mob Boss`);
    expect(entries.map((e) => [e.count, e.name, e.section])).toEqual([
      [4, 'Lightning Bolt', 'main'],
      [4, 'Counterspell', 'main'],
      [1, 'Delver of Secrets', 'main'],
      [1, 'Sol Ring', 'main'],
      [2, 'Duress', 'sideboard'],
      [1, 'Krenko, Mob Boss', 'commander'],
    ]);
    expect(entries[2]).toMatchObject({ set: 'isd', number: '51' });
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
    const rejects = [];
    gs.onReject((r) => rejects.push(r));
    gs.send('move', { cardId: id, from: 'p2.hand', to: 'p2.battlefield' }); // guest has not seen the move yet
    await tick(); await tick(); await tick();
    expect(rejects[0]?.reason).toBe('stale');
    expect(gs.state.zones['p2.graveyard']).toContain(id);
  });

  it('notices reach the other side', async () => {
    const { hs, gs } = setup();
    const seen = [];
    hs.onNotice((n) => seen.push(n.kind));
    gs.send('peek', { zone: 'p2.library', n: 2 });
    await tick(); await tick();
    expect(seen).toContain('peek');
  });
});

import { sha256Bytes } from '../src/storage/sha256.js';
import { createHash } from 'node:crypto';
describe('sha256 fallback', () => {
  it('matches node crypto across lengths', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70000]) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
      const mine = Buffer.from(sha256Bytes(data)).toString('hex');
      expect(mine).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });
});

import { listSignature } from '../src/storage/scryfall.js';
describe('list signature', () => {
  it('ignores order, case, printings and split counts', () => {
    const a = listSignature('4 Lightning Bolt\n2 Mountain (DSK) 280\n1 Sol Ring');
    const b = listSignature('1 sol ring\n2 Mountain\n2 Lightning Bolt\n2x Lightning Bolt');
    expect(a).toBe(b);
    expect(listSignature('3 Lightning Bolt')).not.toBe(listSignature('4 Lightning Bolt'));
    expect(listSignature('Sideboard\n4 Duress')).toBe('');
  });
});
