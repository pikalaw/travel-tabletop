// The game screen: board, footer, overlays, and every gesture handler.

import { html, useState, useEffect, useRef, useMemo, toast } from './h.js';
import { Board } from './board.js';
import { cardImage } from './cards.js';
import { saveFile } from './files.js';
import { attachGestures } from './gestures.js';
import { setGameLink } from './link.js';
import { CardSheet, FullCard, CountersSheet, LogSheet, TokensSheet, DiceSheet, MenuSheet, AwaySheet, Sheet, zoneTitle } from './overlays.js';
import { ShowCode, ReadCode } from './pairing.js';
import { zoneKind, zoneOwner, other, handCount, findZone, canSeeFace } from '../engine/view.js';
import { loadArt, listDecks, loadLog } from '../storage/db.js';

const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * @param {{ session: any, onExit: () => void, onRematch?: () => void, pairing?: any }} props
 */
export function Game({ session, onExit, onRematch, pairing }) {
  const same = session.kind === 'same-device';
  const [, setTick] = useState(0);
  const [viewer, setViewer] = useState(same ? 'nobody' : session.me);
  const [persp, setPersp] = useState(same ? (session.state.activePlayer || 'p1') : session.me);
  const [openSlots, setOpenSlots] = useState([]);  // slots opened by the viewer; several may be open at once
  const openSlot = (zone) => setOpenSlots((cur) => (cur.includes(zone) ? cur : [...cur, zone]));
  const closeSlot = (zone) => setOpenSlots((cur) => cur.filter((z) => z !== zone));
  const [lib, setLib] = useState(null);            // library zone whose actions are in the footer
  const [libN, setLibN] = useState(1);
  const [sheet, setSheet] = useState(null);
  const [full, setFull] = useState(null);          // { cardId, zone, anchor }: anchor is the card first opened; its row stays fixed
  const [match, setMatch] = useState(null);        // card id whose combat matchup is highlighted on the board
  const [shown, setShown] = useState(null);        // { actor, cardIds }: the reveal screen
  const [confirmFor, setConfirmFor] = useState(null); // player asked "are you sure you are …?" before unblinding
  const [pointMode, setPointMode] = useState(false);
  const [attaching, setAttaching] = useState(null); // { cardId, zone }: waiting for the card to attach it to
  const [combat, setCombat] = useState(false);       // combat mode: taps mark attackers and blockers
  const [blocker, setBlocker] = useState(null);      // { cardId, zone }: chosen blocker, waiting for its attacker
  const [label, setLabel] = useState('loyalty');
  const [art, setArt] = useState(new Map());
  const [tokenDecks, setTokenDecks] = useState([]);
  const [lines, setLines] = useState([]);
  const [pointer, setPointer] = useState(null);    // { rect, actor }
  const seen = useRef({ p1: 0, p2: 0 });
  const awayLines = useRef([]);
  const rootRef = useRef(null);
  const state = session.state;
  // The address bar names this game, so the page can be bookmarked or reopened from history.
  useEffect(() => { setGameLink(state.gameId); return () => setGameLink(null); }, [state.gameId]);

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
      else if (r.reason === 'invalid' && (r.type === 'attack' || r.type === 'block' || /attack|block/i.test(r.detail || ''))) toast(r.detail, 'info');
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
    // A tap on a counter or combat mark on the board means its card (dragging is what moves the mark).
    if (el.dataset.badge && !el.closest('.full-wrap')) el = el.closest('[data-card]') || el;
    // The matchup highlight stays while you tap its cards; a tap anywhere else clears it.
    if (match && !el.dataset.card) setMatch(null);
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
    if (combat) { combatTap(el); return; }
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
    if (el.dataset.counter === 'attack') { toast('Drag ⚔ Attack onto a creature to mark it attacking; drag the mark off to remove it.', 'info'); return; }
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
      if (row?.dataset.collapsed) { openSlot(zone); return; }
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
      if (openSlots.includes(zone)) closeSlot(zone);
      else if (el.dataset.collapsed || el.dataset.groups) openSlot(zone);
    }
  }

  /**
   * Combat mode. A card on the active player's side toggles attacking. A card on the other side
   * is picked as a blocker; the next tap on an attacker pairs them (tap again to undo the pair).
   */
  function combatTap(el) {
    const zone = el.dataset.zone;
    const k = zoneKind(zone);
    if (!el.dataset.card || el.closest('.sheet') || (k !== 'battlefield' && k !== 'lands')) {
      toast('In combat, tap creatures on the battlefield. Done returns to normal play.', 'info');
      return;
    }
    const row = el.closest('[data-drop]');
    const c = state.cards[el.dataset.card];
    const id = c?.attachedTo && !row?.dataset.fanned ? c.attachedTo : el.dataset.card; // a tucked strip means its card
    if (zoneOwner(zone) === state.activePlayer) {
      if (blocker) {
        if (!state.cards[id]?.attacking) { toast('Mark that creature as attacking first.', 'info'); return; }
        send('block', { cardId: blocker.cardId, from: findZone(state, blocker.cardId) || blocker.zone, attackerId: id, attackerZone: zone });
        setBlocker(null);
      } else send('attack', { cardId: id, from: zone });
      return;
    }
    setBlocker(blocker?.cardId === id ? null : { cardId: id, zone });
  }
  function passTurn() {
    const from = state.players[state.activePlayer].name, to = state.players[other(state.activePlayer)].name;
    if (!window.confirm(`End ${from}’s turn and pass it to ${to}?`)) return;
    send('passTurn', { to: other(state.activePlayer) });
  }
  const hasCombatMarks = Object.values(state.cards).some((c) => c.attacking || c.blocking);
  function endCombat() {
    // One tap clears every mark, so ask first (Undo would bring them back, but it is easy to miss).
    const cards = Object.values(state.cards);
    const nA = cards.filter((c) => c.attacking).length;
    const nB = cards.reduce((n, c) => n + (c.blocking || []).length, 0);
    const what = [nA ? `${nA} attacker${nA > 1 ? 's' : ''}` : '', nB ? `${nB} block${nB > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
    if (what && !window.confirm(`End combat and clear ${what}?`)) return;
    send('endCombat', {}); setBlocker(null); setCombat(false);
  }

  function pileTap(zone) {
    if (zoneKind(zone) === 'library') { setLib(zone); setLibN(1); return; }
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
    setFull({ cardId, zone, anchor: cardId });
  }

  /** Close the full view; a card in combat leaves its matchup highlighted on the board. */
  function closeFull() {
    if (full && matchupIds(state, full.anchor).size) setMatch(full.anchor);
    setFull(null);
  }

  function onDrop(src, d) {
    // A counter dragged off its card is removed wherever it lands, even outside every slot.
    if (src.dataset.badge) {
      const cardId = src.dataset.cardOf;
      // In the full-screen view the card fills most of the screen, so any drag of a counter removes one.
      if (!src.closest('.full-wrap') && (d.onCard === cardId || d.cardId === cardId)) return;
      if (src.dataset.badge === 'attack') { send('attack', { cardId, from: src.dataset.zone, value: false }); return; }
      if (src.dataset.badge === 'block') {
        const atk = src.dataset.attacker;
        send('block', { cardId, from: src.dataset.zone, attackerId: atk, attackerZone: findZone(state, atk), value: false });
        return;
      }
      send('removeCounter', { cardId, from: src.dataset.zone, kind: src.dataset.badge, label: src.dataset.label });
      return;
    }
    if (d.nowhere) return;
    // A counter from the footer onto a card.
    if (src.dataset.counter) {
      if (!d.cardId) return;
      const kind = src.dataset.counter;
      if (kind === 'attack') {
        const k = zoneKind(d.zone);
        if (k !== 'battlefield' && k !== 'lands') { toast('Only a card on the battlefield can attack.', 'info'); return; }
        if (zoneOwner(d.zone) !== state.activePlayer) { toast(`Only ${state.players[state.activePlayer].name}’s creatures can attack this turn.`, 'info'); return; }
        const c = state.cards[d.cardId];
        send('attack', { cardId: c?.attachedTo || d.cardId, from: d.zone, value: true });
        return;
      }
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
  /** Check it is really that player in front of the screen, then unblind. */
  function unblind(pl) { setConfirmFor(pl); }

  function doUnblind(pl) {
    setViewer(pl);
    setPersp(pl);
    setOpenSlots([]);
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
    { label: 'Pass the turn', onClick: () => { setSheet(null); passTurn(); } },
    !same || state.result ? { label: 'Export action log (JSON Lines)', onClick: exportLog } : null,
    session.kind === 'host' && pairing ? { label: 'Re-pair the guest device', onClick: () => setSheet({ kind: 'pair' }) } : null,
    session.kind === 'guest' && pairing ? { label: 'Reconnect to the host', onClick: () => setSheet({ kind: 'pair' }) } : null,
    !state.result && same ? { label: `${state.players.p1.name} concedes`, danger: true, onClick: () => { if (confirm('Concede the game?')) { send('concede', { player: 'p1' }); setSheet(null); } } } : null,
    !state.result && same ? { label: `${state.players.p2.name} concedes`, danger: true, onClick: () => { if (confirm('Concede the game?')) { send('concede', { player: 'p2' }); setSheet(null); } } } : null,
    !state.result && !same ? { label: 'Concede', danger: true, onClick: () => { if (confirm('Concede the game?')) { send('concede', { player: session.me }); setSheet(null); } } } : null,
    onRematch && session.kind !== 'guest' ? { label: 'Rematch with the same decks', onClick: () => { if (confirm('Start a new game with the same decks?')) { setSheet(null); onRematch(); } } } : null,
    { label: 'Leave to home screen', onClick: onExit },
  ];

  const ctx = { state, viewer, art, pointed: null, selected: combat ? blocker?.cardId : null, match: match ? matchupIds(state, match) : null };
  const O = other(P);
  const fullZone = full ? (findZone(state, full.cardId) || full.zone) : null;
  const isOffline = session.kind !== 'same-device' && session.status !== 'open';
  // The full view's row: the anchor's group (host first, then its attachments), then the host's
  // combat cards (an attacker's blockers, or the attackers a blocker blocks). It stays fixed while
  // you move through it.
  let fullRow = null;
  if (full && state.cards[full.cardId]) {
    const has = (r) => r && [...r.group, ...r.partners].includes(full.cardId);
    fullRow = fullRowOf(state, full.anchor);
    if (!has(fullRow)) fullRow = fullRowOf(state, full.cardId); // the shown card left the anchor's row
    if (fullRow.group.length + fullRow.partners.length < 2) fullRow = null;
  }
  const matchSet = ctx.match;

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
      ${(k === 'battlefield' || k === 'lands') && zoneOwner(fullZone) === state.activePlayer
        ? html`<button class="btn" onClick=${() => send('attack', { cardId: card.id, from: fullZone })}>${card.attacking ? 'Stop attacking' : 'Attack'}</button>` : null}
      ${(k === 'battlefield' || k === 'lands') && zoneOwner(fullZone) !== state.activePlayer
        ? html`<button class="btn" onClick=${() => { setCombat(true); setBlocker({ cardId: card.id, zone: fullZone }); setFull(null); setSheet(null); }}>Block</button>` : null}
      ${card.attachedTo
        ? html`<button class="btn" onClick=${() => send('detach', { cardId: card.id, from: fullZone })}>Detach</button>`
        : k !== 'library' ? html`<button class="btn" onClick=${() => { setAttaching({ cardId: card.id, zone: fullZone }); setFull(null); setSheet(null); }}>Attach</button>` : null}
      <${CounterChips} label=${label} attack=${actor === 'table' || actingPlayer === state.activePlayer}/>
      <span class="spacer"></span>
      <button class="btn primary" onClick=${closeFull}>Close</button>
    </div>`;
  } else if (combat) {
    const b = blocker && state.cards[blocker.cardId];
    const bName = b && (canSeeFace(state, b, findZone(state, b.id) || blocker.zone, viewer) ? b.name : 'card');
    footer = html`<div class="bar combat">
      <span class="attach-hint">${b
        ? html`<b>${bName}</b> blocks: tap the attacker`
        : html`Tap ${state.players[state.activePlayer].name}’s attackers, or a blocker then its attacker.`}</span>
      <button class="btn warn" onClick=${endCombat}>End combat</button>
      <button class="btn primary" onClick=${() => { setCombat(false); setBlocker(null); }}>Done</button>
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
      <button class="btn" onClick=${passTurn}>Pass turn</button>
      <button class="btn" onClick=${() => { setCombat(true); setBlocker(null); setPointMode(false); }}>Combat</button>
      ${hasCombatMarks ? html`<button class="btn warn" onClick=${endCombat}>End combat</button>` : null}
      ${matchSet?.size ? html`<button class="btn on" onClick=${() => setMatch(null)}>Clear highlight</button>` : null}
      <${CounterChips} label=${label} attack=${actor === 'table' || actingPlayer === state.activePlayer}/>
      <button class="btn token-btn" data-trash onClick=${() => setSheet({ kind: 'tokens' })} title="Tokens (drop a token here to remove it)">Tokens</button>
      <button class="btn" onClick=${() => setSheet({ kind: 'dice' })}>Dice</button>
      <button class="btn ${pointMode ? 'on' : ''}" onClick=${() => setPointMode(!pointMode)}>${pointMode ? 'Tap a card…' : 'Point'}</button>
      ${openSlots.length ? html`<button class="btn" onClick=${() => setOpenSlots([])}>${openSlots.length > 1 ? 'Close slots' : 'Close slot'}</button>` : null}
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
      <${Board} ctx=${ctx} P=${P} openSlots=${openSlots}/>
      ${full ? html`<div class="full-wrap"><${FullCard} ctx=${ctx} cardId=${full.cardId} zone=${fullZone} row=${fullRow}
          onCounter=${(type, kind, lbl) => send(type, { cardId: full.cardId, from: fullZone, kind, label: lbl })}
          onPick=${(id) => setFull({ cardId: id, zone: findZone(state, id) || fullZone, anchor: full.anchor })}/></div>` : null}
      ${sheetEl}
      ${state.result ? html`<div class="result-banner">${state.result.winner ? `${state.players[state.result.winner].name} wins` : 'Game over'}${state.result.reason === 'concede' ? ' (concession)' : ''} — undo to continue, or use the menu.</div>` : null}
    </div>
    <footer class="footer">
      <div class="ticker">
        <button class="ticker-text ${last?.alert ? 'alert' : ''}" data-tap="ticker">${last ? last.text : `Turn ${state.turn} · ${state.players[state.activePlayer].name}`}</button>
        ${status}
      </div>
      ${footer}
    </footer>
    ${confirmFor ? html`<${ConfirmPlayer} pl=${confirmFor} name=${state.players[confirmFor].name}
        onOk=${() => { const pl = confirmFor; setConfirmFor(null); doUnblind(pl); }} onCancel=${() => setConfirmFor(null)}/>` : null}
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

/** "Are you sure you are …?" before unblinding, in that player's colour (the colour of their button). */
function ConfirmPlayer({ pl, name, onOk, onCancel }) {
  return html`<div class="confirm-screen" role="dialog" aria-label=${`Are you sure you are ${name}?`} onClick=${(e) => { if (e.target === e.currentTarget) onCancel(); }}>
    <div class="confirm-box ${pl}">
      <h3>Are you sure you are ${name}?</h3>
      <p>Your hand will be shown face up.</p>
      <div class="confirm-actions">
        <button class="btn" onClick=${onCancel}>Cancel</button>
        <button class="btn yes" onClick=${onOk} autoFocus>Yes, I’m ${name}</button>
      </div>
    </div>
  </div>`;
}

/** Counter tags for the footer; the ⚔ Attack tag only for the player whose turn it is (or the table). */
function CounterChips({ label, attack = true }) {
  return html`<span class="chips">
    <span class="chip plus" data-counter="plus" title="Drag onto a card">+1/+1</span>
    <span class="chip minus" data-counter="minus" title="Drag onto a card">−1/−1</span>
    <span class="chip label" data-counter="label" title="Drag onto a card; tap to rename">${label}</span>
    ${attack ? html`<span class="chip attack" data-counter="attack" title="Drag onto a creature to mark it attacking">⚔ Attack</span>` : null}
  </span>`;
}

/** The host card of a group: the card itself, or the card it is attached to. */
function hostOf(state, id) { const c = state.cards[id]; return c?.attachedTo && state.cards[c.attachedTo] ? c.attachedTo : id; }

/** Attachments of a battlefield host, closest first (the order the full view shows them). */
function attachmentsIn(state, hostId) {
  const z = findZone(state, hostId);
  return z ? state.zones[z].filter((x) => state.cards[x].attachedTo === hostId).reverse() : [];
}

/**
 * The full view's row for a card: its group, then its host's combat cards.
 * @returns {{ group: string[], partners: string[], role: 'attacker' | 'blocker' | null } | null}
 */
export function fullRowOf(state, id) {
  if (!state.cards[id]) return null;
  const z = findZone(state, id);
  const k = z ? zoneKind(z) : null;
  if (k !== 'battlefield' && k !== 'lands') return { group: [id], partners: [], role: null };
  const h = hostOf(state, id);
  const host = state.cards[h];
  const group = [h, ...attachmentsIn(state, h)];
  if (host.attacking) {
    const blockers = Object.values(state.cards).filter((c) => (c.blocking || []).includes(h)).map((c) => c.id);
    return { group, partners: blockers, role: 'attacker' };
  }
  const attackers = (host.blocking || []).filter((a) => state.cards[a]?.attacking);
  return { group, partners: attackers, role: attackers.length ? 'blocker' : null };
}

/** Every card in the combat matchup(s) a card belongs to: attackers, their blockers, and all their attachments. */
export function matchupIds(state, id) {
  const out = new Set();
  if (!state.cards[id]) return out;
  const h = state.cards[hostOf(state, id)];
  const attackers = h.attacking ? [h.id] : (h.blocking || []).filter((a) => state.cards[a]?.attacking);
  if (!attackers.length) return out;
  const members = new Set(attackers);
  for (const c of Object.values(state.cards)) if ((c.blocking || []).some((a) => attackers.includes(a))) members.add(c.id);
  for (const m of members) { out.add(m); for (const a of attachmentsIn(state, m)) out.add(a); }
  return out;
}
