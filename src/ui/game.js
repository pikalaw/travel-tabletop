// The game screen: board, footer, overlays, and every gesture handler.

import { html, useState, useEffect, useRef, useMemo, toast } from './h.js';
import { Board } from './board.js';
import { cardImage } from './cards.js';
import { saveFile } from './files.js';
import { attachGestures } from './gestures.js';
import { CardSheet, FullCard, CountersSheet, LogSheet, TokensSheet, DiceSheet, MenuSheet, AwaySheet, Sheet, zoneTitle } from './overlays.js';
import { ShowCode, ReadCode } from './pairing.js';
import { zoneKind, zoneOwner, other, handCount, findZone, canSeeFace } from '../engine/view.js';
import { loadArt, listDecks, loadLog } from '../storage/db.js';

const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * @param {{ session: any, onExit: () => void, onRematch?: () => void, pairing?: any }} props
 */
export function Game({ session, onExit, onRematch, pairing, lock }) {
  const same = session.kind === 'same-device';
  const [, setTick] = useState(0);
  const [viewer, setViewer] = useState(same ? 'nobody' : session.me);
  const [persp, setPersp] = useState(same ? (session.state.activePlayer || 'p1') : session.me);
  const [openSlot, setOpenSlot] = useState(null);
  const [lib, setLib] = useState(null);            // library zone whose actions are in the footer
  const [libN, setLibN] = useState(1);
  const [sheet, setSheet] = useState(null);
  const [full, setFull] = useState(null);          // { cardId }
  const [shown, setShown] = useState(null);        // { actor, cardIds }: the reveal screen
  const [pinFor, setPinFor] = useState(null);      // player asked for their code before unblinding
  const [pointMode, setPointMode] = useState(false);
  const [attaching, setAttaching] = useState(null); // { cardId, zone }: waiting for the card to attach it to
  const [label, setLabel] = useState('loyalty');
  const [art, setArt] = useState(new Map());
  const [tokenDecks, setTokenDecks] = useState([]);
  const [lines, setLines] = useState([]);
  const [pointer, setPointer] = useState(null);    // { rect, actor }
  const seen = useRef({ p1: 0, p2: 0 });
  const awayLines = useRef([]);
  const rootRef = useRef(null);
  const state = session.state;

  const P = same ? persp : session.me;
  const actor = same ? (viewer === 'nobody' ? 'table' : viewer) : session.me;
  const actingPlayer = actor === 'table' ? persp : actor;
  const send = (type, payload) => session.send(type, payload, actor);

  // ----- art: load images for every card and token in play -----
  useEffect(() => {
    listDecks().then((ds) => setTokenDecks(ds.filter((d) => d.kind === 'token')));
  }, []);
  const defIds = useMemo(() => {
    const ids = new Set(Object.values(state.cards).map((c) => c.defId));
    for (const d of tokenDecks) d.cards.forEach((id) => ids.add(id));
    return [...ids].sort().join(',');
  }, [state, tokenDecks]);
  useEffect(() => {
    const ids = defIds.split(',').filter((id) => id && !art.has(id));
    if (ids.length) loadArt(ids).then((m) => setArt((prev) => new Map([...prev, ...m])));
  }, [defIds]);

  // ----- session events -----
  useEffect(() => {
    const addLine = (text, alert) => setLines((ls) => [...ls.slice(-199), { text, alert, time: timeNow() }]);
    const offState = session.subscribe((info) => {
      setTick((t) => t + 1);
      if (info?.text) {
        addLine(info.text, info.alert);
        // Same device: alerts go to the "while you were away" list instead of a toast.
        if (info.alert && !same && info.actor !== session.me) toast(info.text, 'warn');
        if (same && info.alert) awayLines.current.push({ actor: info.actor, text: info.text });
      }
    });
    const offNotice = session.onNotice((n) => {
      addLine(n.text, n.alert);
      const mine = !same && n.actor === session.me;
      if (n.kind === 'point') showPointer(n);
      // Two devices: the opponent's revealed card pops up full screen here.
      else if (n.kind === 'showCard') { if (!same && n.actor !== session.me) setShown({ actor: n.actor, cardIds: [n.payload.cardId] }); }
      else if (n.kind === 'revealTop') setSheet({ kind: 'reveal', zone: n.payload.zone, ids: n.payload.ids || [] });
      else if (n.kind === 'randomPick') { toast(n.text, 'info', 5000); showPointer({ actor: n.actor, payload: { cardId: n.payload.cardId, zone: n.payload.zone } }); }
      else if (n.kind === 'coinFlip' || n.kind === 'rollDie') toast(n.text, 'big', 5000);
      else if (n.alert && !mine && !same) toast(n.text, 'warn');
      if (same && n.alert) awayLines.current.push({ actor: n.actor, text: n.text });
    });
    const offReject = session.onReject((r) => {
      if (r.reason === 'stale') toast('That card had already moved — your action was undone.', 'warn');
      else if (r.reason === 'offline') toast(r.detail, 'warn');
      else if (r.detail) toast(r.detail, 'warn');
    });
    return () => { offState(); offNotice(); offReject(); };
  }, [session]);

  // ----- keep the screen awake during play -----
  useEffect(() => {
    let lock = null;
    const req = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch {} };
    const vis = () => { if (document.visibilityState === 'visible') req(); };
    req();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, []);

  // ----- pointer highlight -----
  function showPointer(n) {
    const p = n.payload || {};
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      let el = p.cardId ? root.querySelector(`.board [data-card="${p.cardId}"], .sheet [data-card="${p.cardId}"]`) : null;
      if (!el && p.zone) el = root.querySelector(`[data-slot="${p.zone}"]`);
      if (!el && p.cardId) {
        const z = findZone(session.state, p.cardId);
        if (z) el = root.querySelector(`[data-slot="${z}"]`);
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      const key = Date.now();
      setPointer({ key, rect: r, actor: n.actor });
      setTimeout(() => setPointer((cur) => (cur?.key === key ? null : cur)), 3000);
    });
  }

  // ----- gestures -----
  const handlers = useRef(null);
  handlers.current = { onTap, onLongPress, onDrop, canDrag };
  useEffect(() => {
    const root = rootRef.current;
    return attachGestures(root, {
      onTap: (el, e) => handlers.current.onTap(el, e),
      onLongPress: (el) => handlers.current.onLongPress(el),
      onDrop: (el, d) => handlers.current.onDrop(el, d),
      canDrag: (el) => handlers.current.canDrag(el),
    });
  }, []);

  function canDrag(el) {
    if (session.status && session.status !== 'open' && session.kind === 'guest') return false;
    if (state.result) return false;
    return true;
  }

  function slotOf(el) { return el.closest('[data-slot]'); }

  function onTap(el) {
    if (attaching) {
      const targetId = el.dataset.card;
      const zone = el.dataset.zone;
      if (!targetId || el.closest('.sheet')) { toast('Tap a card on the battlefield to attach to, or Cancel.', 'info'); return; }
      if (targetId === attaching.cardId) { setAttaching(null); return; }
      const k = zoneKind(zone);
      if (k !== 'battlefield' && k !== 'lands') { toast('Cards can only be attached to a card on the battlefield.', 'info'); return; }
      send('attach', { cardId: attaching.cardId, from: findZone(state, attaching.cardId) || attaching.zone, toCardId: targetId, toZone: zone });
      setAttaching(null);
      return;
    }
    if (pointMode) {
      const cardId = el.dataset.card || null;
      const zone = el.dataset.zone || el.dataset.slot || slotOf(el)?.dataset.slot || null;
      if (cardId || zone) send('point', { cardId, zone });
      setPointMode(false);
      return;
    }
    if (el.dataset.tokenDef) {
      send('createToken', { defId: el.dataset.tokenDef, name: el.dataset.tokenName, to: `${actingPlayer}.battlefield`, owner: actingPlayer });
      return;
    }
    if (el.dataset.counter === 'label') {
      const v = window.prompt('Counter name for the labeled counter (e.g. loyalty, lore, charge, time):', label);
      if (v && v.trim()) setLabel(v.trim().slice(0, 16));
      return;
    }
    const tap = el.dataset.tap;
    if (tap === 'counters') { setSheet({ kind: 'counters' }); return; }
    if (tap === 'ticker') { setSheet({ kind: 'log' }); return; }
    if (el.dataset.card) {
      const zone = el.dataset.zone;
      const inSheet = !!el.closest('.sheet');
      if (inSheet) return;
      if (el.closest('.pile')) return pileTap(zone);
      const row = el.closest('[data-drop]');
      if (row?.dataset.collapsed) { setOpenSlot(zone); return; }
      const k = zoneKind(zone);
      // A tucked attachment is a thin strip: a tap on it is meant for the card it is attached to.
      const c = state.cards[el.dataset.card];
      const target = c?.attachedTo && !row?.dataset.fanned ? c.attachedTo : el.dataset.card;
      if (k === 'battlefield' || k === 'lands') send('tap', { cardId: target, from: zone });
      return;
    }
    if (tap === 'pile') return pileTap(el.dataset.slot);
    if (tap === 'slot') {
      const zone = el.dataset.slot;
      if (el.closest('.sheet')) return;
      if (openSlot === zone) setOpenSlot(null);
      else if (el.dataset.collapsed || el.dataset.groups) setOpenSlot(zone);
    }
  }

  function pileTap(zone) {
    if (zoneKind(zone) === 'library') { setLib(zone); setLibN(1); setOpenSlot(null); return; }
    setSheet({ kind: 'zone', zone });
  }

  function onLongPress(el) {
    const cardId = el.dataset.card;
    if (!cardId) return;
    const zone = el.dataset.zone;
    const card = state.cards[cardId];
    if (!card) return;
    const inPrivateTray = !!el.closest('.sheet') && sheet && ['peek', 'search', 'inspect', 'reveal'].includes(sheet.kind);
    const visible = inPrivateTray || canSeeFace(state, card, zone, viewer) || (card.faceDown && viewer === card.owner);
    if (!visible) { toast('You can’t see that card’s face.', 'info'); return; }
    setFull({ cardId, zone });
  }

  function onDrop(src, d) {
    // A counter dragged off its card is removed wherever it lands, even outside every slot.
    if (src.dataset.badge) {
      const cardId = src.dataset.cardOf;
      if (d.onCard === cardId || d.cardId === cardId) return;
      send('removeCounter', { cardId, from: src.dataset.zone, kind: src.dataset.badge, label: src.dataset.label });
      return;
    }
    if (d.nowhere) return;
    // A counter from the footer onto a card.
    if (src.dataset.counter) {
      if (!d.cardId) return;
      const kind = src.dataset.counter;
      send('addCounter', { cardId: d.cardId, from: d.zone, kind, label: kind === 'label' ? label : undefined });
      return;
    }
    // A token from the token picker.
    if (src.dataset.tokenDef) {
      if (!d.zone) return;
      send('createToken', { defId: src.dataset.tokenDef, name: src.dataset.tokenName, to: d.zone, toIndex: d.index, owner: zoneOwner(d.zone) || actingPlayer });
      return;
    }
    // A card.
    const cardId = src.dataset.card;
    const from = src.dataset.zone;
    if (!cardId || !from) return;
    const card = state.cards[cardId];
    if (d.trash) {
      if (card?.isToken) send('removeToken', { cardId, from });
      else toast('Only tokens can be removed. Drag cards to a graveyard or exile instead.', 'info');
      return;
    }
    let toIndex = d.index;
    if (d.tray) toIndex = trayIndex(d.zone, cardId, d.index);
    send('move', { cardId, from, to: d.zone, toIndex });
  }

  /** Map a drop position among the tray's cards to an index in the library. */
  function trayIndex(zone, cardId, displayIndex) {
    const libIds = state.zones[zone].filter((id) => id !== cardId);
    const shown = sheet?.kind === 'peek' || sheet?.kind === 'reveal' ? libIds.filter((id) => sheet.ids.includes(id)) : libIds;
    if (!shown.length) return 0;
    if (displayIndex < shown.length) return libIds.indexOf(shown[displayIndex]);
    return libIds.indexOf(shown[shown.length - 1]) + 1;
  }

  // ----- library actions -----
  const libOwner = lib ? zoneOwner(lib) : null;
  const libTop = (n) => state.zones[lib].slice(0, n);
  const libActions = {
    draw: () => send('draw', { player: libOwner, n: libN }),
    mill: () => send('mill', { player: libOwner, n: libN }),
    peek: () => {
      if (viewer === 'nobody') { toast('Unblind your hand first — peeking is private.', 'info'); return; }
      const ids = libTop(libN);
      send('peek', { zone: lib, n: ids.length });
      setSheet({ kind: 'peek', zone: lib, ids });
    },
    reveal: () => { const ids = libTop(libN); send('revealTop', { zone: lib, n: ids.length, ids }); },
    search: () => {
      if (viewer === 'nobody') { toast('Unblind your hand first — searching is private.', 'info'); return; }
      if (libOwner === actingPlayer) { send('searchOpen', { zone: lib }); setSheet({ kind: 'search', zone: lib }); }
      else { send('inspect', { zone: lib }); setSheet({ kind: 'inspect', zone: lib }); }
    },
    shuffle: () => send('shuffle', { zone: lib }),
    topUp: () => send('setLibraryTopFaceUp', { player: libOwner, value: !state.players[libOwner].libraryTopFaceUp }),
  };

  function closeSheet() {
    if (sheet?.kind === 'search') send('searchClose', { zone: sheet.zone });
    setSheet(null);
  }

  // ----- same-device blind / unblind -----
  /** Ask for the player's code (if the game has codes), then unblind. */
  function unblind(pl) {
    if (lock) { setPinFor(pl); return; }
    doUnblind(pl);
  }

  function doUnblind(pl) {
    setViewer(pl);
    setPersp(pl);
    setOpenSlot(null);
    setLib(null);
    const lines = awayLines.current.slice(seen.current[pl]).filter((l) => l.actor !== pl).map((l) => l.text);
    seen.current[pl] = awayLines.current.length;
    if (lines.length) setSheet({ kind: 'away', name: state.players[pl].name, lines });
    else setSheet(null);
  }
  /**
   * Reveal a hand card: a one-time event, logged, not a lasting card state.
   * Two devices: it pops up on the opponent's device. One device: blind the hand first,
   * then show only this card; it is hidden again when the reveal screen closes.
   */
  function revealCard(card, zone) {
    send('showCard', { cardId: card.id, zone });
    setFull(null);
    if (same) {
      blind();
      setShown({ actor: card.owner, cardIds: [card.id] });
    }
  }

  function blind() {
    if (viewer !== 'nobody') seen.current[viewer] = awayLines.current.length;
    setViewer('nobody');
    setSheet((s) => (s && ['peek', 'search', 'inspect'].includes(s.kind) ? null : s));
  }

  // ----- export log -----
  async function exportLog() {
    if (same && !state.result) { toast('The log shows both hands, so in a one-device game it can be exported once the game ends.', 'info', 5000); return; }
    if (session.kind === 'guest') { toast('The full log is kept on the host device. Export it there.', 'info'); return; }
    const entries = await loadLog(state.gameId);
    const manifest = { kind: 'manifest', gameId: state.gameId, mode: state.mode, players: { p1: state.players.p1.name, p2: state.players.p2.name }, exportedAt: new Date().toISOString(), schemaVersion: state.schemaVersion };
    const body = [manifest, ...entries].map((e) => JSON.stringify(e)).join('\n') + '\n';
    await saveFile(new Blob([body], { type: 'application/x-ndjson' }), `mtg-game-${state.gameId}.jsonl`);
  }

  // ----- menu -----
  const menuItems = [
    same && viewer !== 'nobody' ? { label: 'Blind my hand', onClick: () => { blind(); setSheet(null); } } : null,
    { label: 'Pass the turn', onClick: () => { send('passTurn', { to: other(state.activePlayer) }); setSheet(null); } },
    !same || state.result ? { label: 'Export action log (JSON Lines)', onClick: exportLog } : null,
    session.kind === 'host' && pairing ? { label: 'Re-pair the guest device', onClick: () => setSheet({ kind: 'pair' }) } : null,
    session.kind === 'guest' && pairing ? { label: 'Reconnect to the host', onClick: () => setSheet({ kind: 'pair' }) } : null,
    !state.result && same ? { label: `${state.players.p1.name} concedes`, danger: true, onClick: () => { if (confirm('Concede the game?')) { send('concede', { player: 'p1' }); setSheet(null); } } } : null,
    !state.result && same ? { label: `${state.players.p2.name} concedes`, danger: true, onClick: () => { if (confirm('Concede the game?')) { send('concede', { player: 'p2' }); setSheet(null); } } } : null,
    !state.result && !same ? { label: 'Concede', danger: true, onClick: () => { if (confirm('Concede the game?')) { send('concede', { player: session.me }); setSheet(null); } } } : null,
    onRematch && session.kind !== 'guest' ? { label: 'Rematch with the same decks', onClick: () => { if (confirm('Start a new game with the same decks?')) { setSheet(null); onRematch(); } } } : null,
    { label: 'Leave to home screen', onClick: onExit },
  ];

  const ctx = { state, viewer, art, pointed: null };
  const O = other(P);
  const fullZone = full ? (findZone(state, full.cardId) || full.zone) : null;
  const isOffline = session.kind !== 'same-device' && session.status !== 'open';
  // The full view of a card in a group shows the whole group: the host first, then its attachments.
  let fullGroup = null;
  if (full && state.cards[full.cardId] && (zoneKind(fullZone) === 'battlefield' || zoneKind(fullZone) === 'lands')) {
    const c = state.cards[full.cardId];
    const host = c.attachedTo || c.id;
    const atts = state.zones[fullZone].filter((id) => state.cards[id].attachedTo === host).reverse();
    if (atts.length) fullGroup = [host, ...atts];
  }

  // ----- footer -----
  let footer;
  if (full && state.cards[full.cardId]) {
    const card = state.cards[full.cardId];
    const k = zoneKind(fullZone);
    footer = html`<div class="bar">
      <button class="btn" onClick=${() => send('flip', { cardId: card.id, from: fullZone })}>Flip</button>
      <button class="btn" onClick=${() => send('setFaceDown', { cardId: card.id, from: fullZone, value: !card.faceDown })}>${card.faceDown ? 'Face up' : 'Face down'}</button>
      ${k === 'hand' ? html`<button class="btn" onClick=${() => revealCard(card, fullZone)}>Reveal</button>` : null}
      ${k === 'battlefield' || k === 'lands' ? html`<button class="btn" onClick=${() => send('tap', { cardId: card.id, from: fullZone })}>${card.tapped ? 'Untap' : 'Tap'}</button>` : null}
      ${card.attachedTo
        ? html`<button class="btn" onClick=${() => send('detach', { cardId: card.id, from: fullZone })}>Detach</button>`
        : k !== 'library' ? html`<button class="btn" onClick=${() => { setAttaching({ cardId: card.id, zone: fullZone }); setFull(null); setSheet(null); }}>Attach</button>` : null}
      <${CounterChips} label=${label}/>
      <span class="spacer"></span>
      <button class="btn primary" onClick=${() => setFull(null)}>Close</button>
    </div>`;
  } else if (attaching && state.cards[attaching.cardId]) {
    const c = state.cards[attaching.cardId];
    footer = html`<div class="bar">
      <span class="attach-hint">Attach <b>${canSeeFace(state, c, findZone(state, c.id) || attaching.zone, viewer) ? c.name : 'card'}</b>: tap the card to attach it to</span>
      <span class="spacer"></span>
      <button class="btn primary" onClick=${() => setAttaching(null)}>Cancel</button>
    </div>`;
  } else if (lib) {
    const mine = libOwner === actingPlayer;
    footer = html`<div class="bar lib">
      <span class="lib-counts">${zoneTitle(state, lib)}: <b>${state.zones[lib].length}</b> · other: ${state.zones[`${other(libOwner)}.library`].length}</span>
      <span class="stepper"><button class="btn round" onClick=${() => setLibN(Math.max(1, libN - 1))}>−</button><b>${libN}</b><button class="btn round" onClick=${() => setLibN(Math.min(99, libN + 1))}>+</button></span>
      ${mine ? html`<button class="btn" onClick=${libActions.draw}>Draw ${libN}</button>` : null}
      <button class="btn" onClick=${libActions.mill}>Mill ${libN}</button>
      <button class="btn" onClick=${libActions.peek}>Look at top ${libN}</button>
      <button class="btn" onClick=${libActions.reveal}>Reveal top ${libN}</button>
      <button class="btn" onClick=${libActions.search}>${mine ? 'Search' : 'Look through'}</button>
      <button class="btn" onClick=${libActions.shuffle}>Shuffle</button>
      <button class="btn ${state.players[libOwner].libraryTopFaceUp ? 'on' : ''}" onClick=${libActions.topUp}>Top face up</button>
      <span class="spacer"></span>
      <button class="btn primary" onClick=${() => setLib(null)}>Done</button>
    </div>`;
  } else {
    footer = html`<div class="bar">
      <button class="btn" onClick=${() => send('undo', {})} title="Undo the last action">Undo</button>
      <button class="btn" onClick=${() => send('untapAll', { player: actingPlayer })}>Untap all</button>
      <button class="btn" onClick=${() => send('passTurn', { to: other(state.activePlayer) })}>Pass turn</button>
      <${CounterChips} label=${label}/>
      <button class="btn token-btn" data-trash onClick=${() => setSheet({ kind: 'tokens' })} title="Tokens (drop a token here to remove it)">Tokens</button>
      <button class="btn" onClick=${() => setSheet({ kind: 'dice' })}>Dice</button>
      <button class="btn ${pointMode ? 'on' : ''}" onClick=${() => setPointMode(!pointMode)}>${pointMode ? 'Tap a card…' : 'Point'}</button>
      ${openSlot ? html`<button class="btn" onClick=${() => setOpenSlot(null)}>Close slot</button>` : null}
      ${same && viewer !== 'nobody' ? html`<button class="btn warn" onClick=${blind}>Blind my hand</button>` : null}
      ${same && viewer === 'nobody' ? html`
        <button class="btn p1c" onClick=${() => unblind('p1')}>Unblind to ${state.players.p1.name}</button>
        <button class="btn p2c" onClick=${() => unblind('p2')}>Unblind to ${state.players.p2.name}</button>` : null}
      <span class="spacer"></span>
      <button class="btn" onClick=${() => setSheet({ kind: 'menu' })} aria-label="Menu">☰</button>
    </div>`;
  }

  // ----- sheet -----
  let sheetEl = null;
  if (sheet) {
    const close = closeSheet;
    if (['zone', 'peek', 'search', 'inspect', 'reveal'].includes(sheet.kind)) {
      sheetEl = html`<${CardSheet} ctx=${ctx} sheet=${sheet} onClose=${close} onRandom=${(z) => send('randomPick', { zone: z })}/>`;
    } else if (sheet.kind === 'counters') sheetEl = html`<${CountersSheet} ctx=${ctx} P=${P} send=${send} onClose=${close}/>`;
    else if (sheet.kind === 'log') sheetEl = html`<${LogSheet} lines=${lines} onClose=${close} onExport=${exportLog}/>`;
    else if (sheet.kind === 'tokens') sheetEl = html`<${TokensSheet} ctx=${ctx} tokenDecks=${tokenDecks} onClose=${close}/>`;
    else if (sheet.kind === 'dice') sheetEl = html`<${DiceSheet} ctx=${ctx} P=${P} send=${send} onClose=${close}/>`;
    else if (sheet.kind === 'menu') sheetEl = html`<${MenuSheet} items=${menuItems} onClose=${close}/>`;
    else if (sheet.kind === 'away') sheetEl = html`<${AwaySheet} name=${sheet.name} lines=${sheet.lines} onClose=${close}/>`;
    else if (sheet.kind === 'pair' && pairing) sheetEl = html`<${Sheet} title=${session.kind === 'host' ? 'Re-pair the guest' : 'Reconnect to the host'} onClose=${close} tall>${pairing.render(() => setSheet(null))}</${Sheet}>`;
  }

  const last = lines[lines.length - 1];
  const status = session.kind === 'same-device' ? null
    : session.status === 'open' ? html`<span class="status ok">Connected</span>`
    : session.status === 'waiting' ? html`<span class="status">Waiting for guest</span>`
    : html`<button class="status bad" onClick=${() => pairing && setSheet({ kind: 'pair' })}>${session.kind === 'guest' ? 'Reconnecting — read-only' : 'Guest disconnected — tap to re-pair'}</button>`;

  return html`<div class="game ${isOffline && session.kind === 'guest' ? 'readonly' : ''} ${pointMode ? 'pointing' : ''}" ref=${rootRef}>
    <div class="board-wrap">
      <${Board} ctx=${ctx} P=${P} openSlot=${openSlot}/>
      ${full ? html`<div class="full-wrap"><${FullCard} ctx=${ctx} cardId=${full.cardId} zone=${fullZone} group=${fullGroup} onPick=${(id) => setFull({ cardId: id, zone: fullZone })}/></div>` : null}
      ${sheetEl}
      ${state.result ? html`<div class="result-banner">${state.result.winner ? `${state.players[state.result.winner].name} wins` : 'Game over'}${state.result.reason === 'concede' ? ' (concession)' : ''} — undo to continue, or use the menu.</div>` : null}
    </div>
    <footer class="footer">
      <div class="ticker">
        <button class="ticker-text ${last?.alert ? 'alert' : ''}" data-tap="ticker">${last ? last.text : `Turn ${state.turn} · ${state.players[state.activePlayer].name}`}</button>
        <span class="turn-tag ${state.activePlayer}">T${state.turn} · ${state.players[state.activePlayer].name}</span>
        <span class="opp-hand">${state.players[O].name}: ${handCount(state, O)} in hand</span>
        ${same ? html`<span class="viewer-tag ${viewer}">${viewer === 'nobody' ? 'Hands blinded' : `${state.players[viewer].name} viewing`}</span>` : null}
        ${status}
      </div>
      ${footer}
    </footer>
    ${pinFor ? html`<${PinDialog} name=${state.players[pinFor].name} otherName=${state.players[other(pinFor)].name}
        check=${(code) => lock.check(pinFor, code)} reset=${(otherCode, code) => lock.reset(pinFor, otherCode, code)}
        onOk=${() => { const pl = pinFor; setPinFor(null); doUnblind(pl); }} onCancel=${() => setPinFor(null)}/>` : null}
    ${shown ? html`<${RevealScreen} ctx=${ctx} shown=${shown} onClose=${() => setShown(null)}/>` : null}
    ${pointer ? html`<div class="pointer-ring ${pointer.actor}" style=${`left:${pointer.rect.left - 4}px;top:${pointer.rect.top - 4}px;width:${pointer.rect.width + 8}px;height:${pointer.rect.height + 8}px`}></div>` : null}
  </div>`;
}

/** Opaque screen showing only the revealed card(s); covers the board and footer. */
function RevealScreen({ ctx, shown, onClose }) {
  const st = ctx.state;
  const cards = shown.cardIds.map((id) => st.cards[id]).filter(Boolean);
  if (!cards.length) return null;
  const who = st.players[shown.actor]?.name || 'A player';
  return html`<div class="reveal-screen" onClick=${onClose} role="dialog" aria-label=${`${who} reveals`}>
    <div class="reveal-title">${who} reveals</div>
    <div class="reveal-cards">
      ${cards.map((c) => {
        const img = cardImage(ctx, c, findZone(st, c.id) || `${c.owner}.hand`, true, 'large');
        return img.url ? html`<img src=${img.url} alt=${c.name} draggable=${false}/>` : html`<div class="card-face missing big"><span>${c.name}</span></div>`;
      })}
    </div>
    <div class="reveal-hint">Tap anywhere to close</div>
  </div>`;
}

/** Code entry before unblinding a hand, with a reset that needs the other player's code. */
function PinDialog({ name, otherName, check, reset, onOk, onCancel }) {
  const [mode, setMode] = useState('enter');
  const [code, setCode] = useState('');
  const [otherCode, setOtherCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [err, setErr] = useState('');
  const digits = (v) => v.replace(/\D/g, '').slice(0, 4);
  const tryCode = async (v) => {
    setCode(v); setErr('');
    if (v.length < 4) return;
    if (await check(v)) onOk();
    else { setErr('Wrong code.'); setCode(''); }
  };
  const doReset = async (e) => {
    e.preventDefault();
    const problem = await reset(otherCode, newCode);
    if (problem) { setErr(problem); setOtherCode(''); return; }
    onOk();
  };
  const field = (value, onInput, label, autofocus) => html`<label>${label}
    <input class="code-input" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="••••"
      autoFocus=${autofocus} value=${value} onInput=${(e) => { const v = digits(e.currentTarget.value); e.currentTarget.value = v; onInput(v); }}/>
  </label>`;
  return html`<div class="pin-screen" role="dialog" aria-label=${`Code for ${name}`}>
    ${mode === 'enter' ? html`<div class="pin-box">
      <h3>${name}, enter your code</h3>
      ${field(code, tryCode, '', true)}
      ${err ? html`<p class="error">${err}</p>` : null}
      <div class="pin-actions">
        <button class="btn ghost" onClick=${() => { setMode('reset'); setErr(''); }}>Forgot code?</button>
        <button class="btn" onClick=${onCancel}>Cancel</button>
      </div>
    </div>` : html`<form class="pin-box" onSubmit=${doReset}>
      <h3>Set a new code for ${name}</h3>
      <p class="muted small">${otherName} confirms with their code, then ${name} picks a new one.</p>
      ${field(otherCode, setOtherCode, `${otherName}'s code`, true)}
      ${field(newCode, setNewCode, `New code for ${name}`, false)}
      ${err ? html`<p class="error">${err}</p>` : null}
      <div class="pin-actions">
        <button class="btn ghost" type="button" onClick=${() => { setMode('enter'); setErr(''); }}>Back</button>
        <button class="btn primary" type="submit" disabled=${otherCode.length < 4 || newCode.length < 4}>Set code and unblind</button>
      </div>
    </form>`}
  </div>`;
}

function CounterChips({ label }) {
  return html`<span class="chips">
    <span class="chip plus" data-counter="plus" title="Drag onto a card">+1/+1</span>
    <span class="chip minus" data-counter="minus" title="Drag onto a card">−1/−1</span>
    <span class="chip label" data-counter="label" title="Drag onto a card; tap to rename">${label}</span>
  </span>`;
}
