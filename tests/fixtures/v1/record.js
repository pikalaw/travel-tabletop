// Records the v1 regression fixtures. Runs in a browser page of the v1 app (tag `v1`),
// driven by record.py. It plays one scripted same-device game through v1's real Host,
// touching every command, notice, rejection and undo, then returns the exported log,
// the final state and a backup of the two sample decks.
//
// The fixtures prove the TypeScript port behaves like v1; they are not a promise to
// keep reading v1 data.

export async function record() {
  const { Host } = await import('/src/host/host.js');
  const { gamePersistence, listDecks, loadLog, db } = await import('/src/storage/db.js');
  const { deckSpec } = await import('/src/client/net.js');
  const { ensureFixtures } = await import('/src/storage/fixtures.js');
  const { exportBackup } = await import('/src/storage/backup.js');
  const { replay } = await import('/src/host/replay.js');

  await ensureFixtures();
  const decks = await listDecks();
  const ember = decks.find((d) => d.id === 'sample-ember');
  const grove = decks.find((d) => d.id === 'sample-grove');
  const tokens = decks.find((d) => d.id === 'builtin-tokens');
  const e = await deckSpec([ember]);
  const g = await deckSpec([grove]);

  const gameId = '2026-11-02-fixturev1game0000';
  const host = new Host({ persist: gamePersistence({ mode: 'same-device', role: 'host', setup: {} }) });
  const results = [];
  const send = (type, payload, actor = 'p1') => {
    const r = host.dispatch({ type, actor, payload });
    results.push({ type, actor, ok: r.ok, error: r.error });
    return r;
  };
  const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error} ${r.detail || ''}`); return r; };
  const z = () => host.state.zones;

  // --- start: p2 has one commander so the command zone is used
  must(send('startGame', {
    gameId, mode: 'same-device', startingLife: 20,
    players: {
      p1: { name: 'Lawrence', cards: e.cards, commanders: [] },
      p2: { name: 'Claire', cards: g.cards.slice(1), commanders: [g.cards[0]] },
    },
  }, 'host'), 'startGame');

  // --- draws and plays
  must(send('draw', { player: 'p1', n: 2 }), 'draw');
  const h1 = () => z()['p1.hand'];
  const h2 = () => z()['p2.hand'];
  const A = h1()[0], B = h1()[1], L = h1()[2], H = h1()[3];
  must(send('move', { cardId: A, from: 'p1.hand', to: 'p1.battlefield' }), 'move A');
  must(send('move', { cardId: B, from: 'p1.hand', to: 'p1.battlefield', toIndex: 0 }), 'move B');
  must(send('move', { cardId: L, from: 'p1.hand', to: 'p1.lands' }), 'move L');
  const X = h2()[0], Y = h2()[1];
  must(send('move', { cardId: X, from: 'p2.hand', to: 'p2.battlefield' }, 'p2'), 'move X');
  must(send('move', { cardId: Y, from: 'p2.hand', to: 'p2.battlefield' }, 'table'), 'move Y');
  must(send('move', { cardId: A, from: 'p1.battlefield', to: 'p1.battlefield', toIndex: 0 }), 'reorder');

  // --- card state
  must(send('tap', { cardId: L, from: 'p1.lands', value: true }), 'tap');
  must(send('tap', { cardId: A, from: 'p1.battlefield' }), 'tap toggle');
  must(send('untapAll', { player: 'p1' }), 'untapAll');
  must(send('flip', { cardId: B, from: 'p1.battlefield' }), 'flip');
  must(send('setFaceDown', { cardId: B, from: 'p1.battlefield', value: true }), 'facedown');
  must(send('setFaceDown', { cardId: B, from: 'p1.battlefield', value: false }), 'faceup');
  must(send('reveal', { cardId: H, from: 'p1.hand', value: true }), 'reveal');
  must(send('reveal', { cardId: H, from: 'p1.hand', value: false }), 'unreveal');

  // --- counters
  must(send('addCounter', { cardId: A, from: 'p1.battlefield', kind: 'plus' }), '+1');
  must(send('addCounter', { cardId: A, from: 'p1.battlefield', kind: 'plus', n: 2 }), '+2');
  must(send('addCounter', { cardId: A, from: 'p1.battlefield', kind: 'minus' }), '-1');
  must(send('addCounter', { cardId: B, from: 'p1.battlefield', kind: 'label', label: 'loyalty', n: 3 }), 'loyalty');
  must(send('removeCounter', { cardId: A, from: 'p1.battlefield', kind: 'plus' }), 'remove +1');
  must(send('removeCounter', { cardId: B, from: 'p1.battlefield', kind: 'label', label: 'loyalty', n: 3 }), 'remove loyalty');

  // --- tokens
  const tok = tokens.cards[0];
  must(send('createToken', { defId: tok, name: 'Token', to: 'p1.battlefield' }), 'token 1');
  const T1 = z()['p1.battlefield'].at(-1);
  must(send('createToken', { defId: tok, name: 'Token', to: 'p2.battlefield', owner: 'p2' }, 'p2'), 'token 2');
  const T2 = z()['p2.battlefield'].at(-1);
  must(send('removeToken', { cardId: T1, from: 'p1.battlefield' }), 'removeToken');
  must(send('move', { cardId: T2, from: 'p2.battlefield', to: 'p2.graveyard' }, 'p2'), 'token leaves play');

  // --- libraries
  must(send('mill', { player: 'p2', n: 2 }, 'p2'), 'mill');
  must(send('shuffle', { zone: 'p1.library' }), 'shuffle');
  must(send('setLibraryTopFaceUp', { player: 'p1', value: true }), 'top up');
  must(send('setLibraryTopFaceUp', { player: 'p1', value: false }), 'top down');
  const top = z()['p1.library'][0];
  must(send('move', { cardId: top, from: 'p1.library', to: 'p1.hand' }), 'library to hand');
  must(send('move', { cardId: h1().at(-1), from: 'p1.hand', to: 'p1.library', toIndex: 0 }), 'hand to library top');
  must(send('move', { cardId: h1().at(-1), from: 'p1.hand', to: 'p1.library' }), 'hand to library bottom');

  // --- player counters
  must(send('setPlayerCounter', { player: 'p2', key: 'life', value: 17 }), 'life');
  must(send('addPlayerCounter', { player: 'p1', key: 'poison', value: 1 }), 'add poison');
  must(send('setPlayerCounter', { player: 'p1', key: 'poison', value: 2.6 }), 'set poison (rounds)');
  must(send('removePlayerCounter', { player: 'p1', key: 'poison' }), 'remove poison');

  // --- attachments
  const AU = h1()[0];
  must(send('attach', { cardId: AU, from: 'p1.hand', toCardId: A, toZone: 'p1.battlefield' }), 'attach');
  must(send('move', { cardId: A, from: 'p1.battlefield', to: 'p1.battlefield', toIndex: 2 }), 'move host with attachment');

  // --- combat (p1 active)
  must(send('attack', { cardId: A, from: 'p1.battlefield' }), 'attack A');
  must(send('attack', { cardId: B, from: 'p1.battlefield' }), 'attack B');
  must(send('block', { cardId: X, from: 'p2.battlefield', attackerId: A, attackerZone: 'p1.battlefield' }, 'p2'), 'block');
  must(send('block', { cardId: X, from: 'p2.battlefield', attackerId: B, attackerZone: 'p1.battlefield' }, 'p2'), 'double block');
  must(send('block', { cardId: X, from: 'p2.battlefield', attackerId: B, attackerZone: 'p1.battlefield' }, 'p2'), 'unblock B');
  must(send('attack', { cardId: B, from: 'p1.battlefield', value: false }), 'stop attacking B');
  must(send('endCombat', {}), 'endCombat');
  must(send('attack', { cardId: A, from: 'p1.battlefield' }), 'attack again');
  must(send('block', { cardId: Y, from: 'p2.battlefield', attackerId: A, attackerZone: 'p1.battlefield' }, 'p2'), 'block again');
  // a change of control removes the blocker from combat
  must(send('move', { cardId: Y, from: 'p2.battlefield', to: 'p1.battlefield' }), 'steal blocker');

  // --- notices
  must(send('peek', { zone: 'p1.library', n: 3 }), 'peek');
  must(send('revealTop', { zone: 'p1.library', n: 2, ids: z()['p1.library'].slice(0, 2) }), 'revealTop');
  must(send('searchOpen', { zone: 'p1.library' }), 'searchOpen');
  must(send('searchClose', { zone: 'p1.library' }), 'searchClose (+shuffle)');
  must(send('inspect', { zone: 'p2.library' }), 'inspect');
  must(send('point', { cardId: X }), 'point card');
  must(send('point', { zone: 'stack' }, 'p2'), 'point zone');
  must(send('showCard', { cardId: h1()[0], zone: 'p1.hand' }), 'showCard');
  must(send('coinFlip', {}), 'coin');
  must(send('rollDie', { sides: 20 }), 'die');
  must(send('rollDie', { sides: 5000 }), 'die clamped');
  must(send('randomPick', { zone: 'p1.hand' }), 'randomPick');
  must(send('info', { text: 'fixture note' }), 'info');

  // --- other zones and the turn
  must(send('move', { cardId: B, from: 'p1.battlefield', to: 'p1.exile' }), 'exile');
  must(send('move', { cardId: h1()[0], from: 'p1.hand', to: 'stack' }), 'cast');
  must(send('move', { cardId: z().stack[0], from: 'stack', to: 'p1.graveyard' }), 'resolve');
  must(send('move', { cardId: z()['p2.command'][0], from: 'p2.command', to: 'p2.battlefield' }, 'p2'), 'commander out');
  must(send('detach', { cardId: AU, from: 'p1.battlefield' }), 'detach');
  must(send('passTurn', { to: 'p2' }), 'passTurn');
  must(send('attack', { cardId: X, from: 'p2.battlefield' }, 'p2'), 'p2 attacks');
  must(send('move', { cardId: X, from: 'p2.battlefield', to: 'p1.battlefield' }), 'steal attacker');

  // --- rejections (logged, change nothing)
  send('move', { cardId: A, from: 'p2.hand', to: 'p1.graveyard' }); // stale
  send('removeCounter', { cardId: A, from: 'p1.battlefield', kind: 'plus', n: 99 }); // invalid
  send('attack', { cardId: A, from: 'p1.battlefield' }); // not the active player's side
  send('removeToken', { cardId: A, from: 'p1.battlefield' }); // not a token

  // --- undo, game end
  must(send('tap', { cardId: L, from: 'p1.lands' }), 'tap before undo');
  must(send('undo', {}), 'undo 1');
  must(send('undo', {}), 'undo 2');
  must(send('concede', { player: 'p1' }), 'concede');
  send('draw', { player: 'p2', n: 1 }); // rejected: game over
  must(send('undo', {}), 'undo concede');
  must(send('endGame', { winner: 'p2' }), 'endGame');

  await host.flush();
  const entries = await loadLog(gameId);
  const manifest = { kind: 'manifest', gameId, mode: 'same-device', players: { p1: 'Lawrence', p2: 'Claire' }, exportedAt: '2026-11-02T00:00:00.000Z', schemaVersion: host.state.schemaVersion };
  const jsonl = [manifest, ...entries].map((x) => JSON.stringify(x)).join('\n') + '\n';
  const replayed = replay(entries);
  const same = JSON.stringify(replayed) === JSON.stringify(host.state);

  const backup = await exportBackup(['sample-ember', 'sample-grove', 'builtin-tokens']);
  const bytes = new Uint8Array(await backup.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

  // the stored records, for the typed readers in v2
  const d = await db();
  const records = {};
  for (const store of ['decks', 'defs', 'games', 'meta']) records[store] = await d.getAll(store);
  records.snapshots = (await d.getAll('snapshots')).map((s) => ({ gameId: s.gameId, key: s.key }));

  return {
    jsonl, finalState: host.state, replayMatches: same, results,
    kinds: [...new Set(entries.map((x) => x.kind))],
    commandTypes: [...new Set(entries.filter((x) => x.command).map((x) => x.command.type))].sort(),
    noticeKinds: [...new Set(entries.filter((x) => x.notice).map((x) => x.notice.kind))].sort(),
    backupB64: btoa(bin), backupInfo: { decks: backup.decks, cards: backup.cards, images: backup.images },
    records,
  };
}
