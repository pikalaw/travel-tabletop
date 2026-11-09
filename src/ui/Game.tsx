// The game screen: board, footer, overlays, and every gesture handler.

import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { toast } from './toast';
import { useOutsideTap } from './hooks';
import { confirmBox, promptBox } from './Dialogs';
import { Board } from './Board';
import { cardImage, type BoardCtx } from './Cards';
import { saveFile } from './files';
import { attachGestures, type Drop, type GestureHandlers, type Gestures } from './gestures';
import { setGameLink } from './link';
import {
  CardSheet, FullCard, CountersSheet, LogSheet, TokensSheet, DiceSheet, MenuSheet, AwaySheet, Sheet, zoneTitle, gameTokens,
  type FullRow, type LogLine, type MenuItem,
} from './Overlays';
import { initialUi, uiReducer, type SheetState } from './gameUi';
import { fullModel } from './fullModel';
import { CardViewer, type CardView } from './CardViewer';
import { zoneKind, zoneOwner, other, findZone, canSeeFace, isZone } from '../engine/view';
import { listDecks, loadLog } from '../storage/db';
import { loadArt, type Art } from '../storage/art';
import type { Session } from '../client/session';
import type { Notice } from '../types/commands';
import type { Actor, CardInstance, GameState, PlayerId, Viewer, ZoneId } from '../types/state';
import type { Deck, LogManifest } from '../types/storage';

const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Re-pairing from inside a game (host: re-pair the guest; guest: reconnect to the host). */
export interface PairingControl { render(close: () => void): ComponentChildren }

export interface GameProps {
  session: Session;
  onExit: () => void;
  onRematch?: (() => void) | undefined;
  pairing?: PairingControl | null | undefined;
}

type PointerRing = { key: number; rect: DOMRect; actor: Actor };

export function Game({ session, onExit, onRematch, pairing }: GameProps) {
  const same = session.kind === 'same-device';
  const [, setTick] = useState(0);
  const [ui, dispatch] = useReducer(uiReducer, undefined, () => initialUi(same, session.me, session.state.activePlayer || 'p1'));
  const { viewer, persp, openSlots, mode, sheet, full, match, shown, confirmFor, label } = ui;
  const setSheet = (s: SheetState | null) => dispatch({ type: 'sheet', sheet: s });
  const openSlot = (zone: ZoneId) => dispatch({ type: 'openSlot', zone });
  const closeSlot = (zone: ZoneId) => dispatch({ type: 'closeSlot', zone });
  const toNormal = () => dispatch({ type: 'mode', mode: { kind: 'normal' } });
  const [art, setArt] = useState(new Map<string, Art>());
  const [tokenDecks, setTokenDecks] = useState<Deck[]>([]);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [pointer, setPointer] = useState<PointerRing | null>(null);
  const seen = useRef<Record<PlayerId, number>>({ p1: 0, p2: 0 });
  // One device: every action, by actor, for the "while you were away" list on unblinding.
  const awayLines = useRef<{ actor: Actor; text: string; alert: boolean }[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const state = session.state;
  // The address bar names this game, so the page can be bookmarked or reopened from history.
  useEffect(() => { setGameLink(state.gameId); return () => setGameLink(null); }, [state.gameId]);

  // Whose side is at the bottom. One device: the unblinded player's; while blinded, the active
  // player's, so passing the turn turns the board to the next player (and undoing the pass turns
  // it back, since this follows the game state). Two devices: always this device's player.
  const P: PlayerId = same ? (viewer === 'nobody' ? state.activePlayer : persp) : session.me;
  const actor: Actor = same ? (viewer === 'nobody' ? 'table' : viewer) : session.me;
  // A blinded table acts for the player the board faces.
  const actingPlayer: PlayerId = actor === 'table' ? P : (actor as PlayerId);
  // Only the active (attacking) player passes the turn; a blinded table may too, so the attacker
  // does not have to unblind just to pass.
  const canPass = actor === 'table' || actor === state.activePlayer;
  const send = (type: string, payload: object) => session.send(type, payload, actor);
  const combat = mode.kind === 'combat' ? mode : null;
  const attaching = mode.kind === 'attach' ? mode : null;
  const lib = mode.kind === 'library' ? mode.zone : null;
  const libN = mode.kind === 'library' ? mode.n : 1;
  const pointMode = mode.kind === 'point';

  // ----- art: load images for every card and token in play -----
  useEffect(() => {
    listDecks().then((ds) => setTokenDecks(ds.filter((d) => d.kind === 'token')));
  }, []);
  // The Tokens sheet's list, and the token shown full screen from it (long-press or spread).
  const tokens = useMemo(() => gameTokens(state, tokenDecks, art), [state, tokenDecks, art]);
  const [tokenView, setTokenView] = useState<CardView | null>(null);
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
    const addLine = (text: string, alert: boolean | undefined) => setLines((ls) => [...ls.slice(-199), { text, alert: !!alert, time: timeNow() }]);
    const offState = session.subscribe((info) => {
      setTick((t) => t + 1);
      if (info?.text) {
        addLine(info.text, info.alert);
        // Two devices: the opponent's alerts pop up. One device: every action goes to the "while you
        // were away" list instead (the ticker's wording, which already hides cards not both could see).
        if (info.alert && !same && info.actor !== session.me) toast(info.text, 'warn');
        if (same && info.actor) awayLines.current.push({ actor: info.actor, text: info.text, alert: !!info.alert });
      }
    });
    const offNotice = session.onNotice((n: Notice) => {
      const text = n.text || '';
      addLine(text, n.alert);
      const mine = !same && n.actor === session.me;
      if (n.kind === 'point') showPointer(n.actor, n.payload.cardId ?? null, n.payload.zone ?? null);
      // Two devices: the opponent's revealed card pops up full screen here.
      else if (n.kind === 'showCard') { if (!same && n.actor !== session.me && (n.actor === 'p1' || n.actor === 'p2')) dispatch({ type: 'shown', shown: { actor: n.actor, cardIds: [n.payload.cardId] } }); }
      else if (n.kind === 'revealTop') setSheet({ kind: 'reveal', zone: n.payload.zone, ids: n.payload.ids || [] });
      else if (n.kind === 'randomPick') { toast(text, 'info', 5000); showPointer(n.actor, n.payload.cardId ?? null, n.payload.zone); }
      else if (n.kind === 'coinFlip' || n.kind === 'rollDie') toast(text, 'big', 5000);
      else if (n.alert && !mine && !same) toast(text, 'warn');
      // Pointing means nothing after the fact, so it stays out of the away list.
      if (same && text && n.kind !== 'point') awayLines.current.push({ actor: n.actor, text, alert: !!n.alert });
    });
    const offReject = session.onReject((r) => {
      if (r.reason === 'stale') toast('That card had already moved — your action was undone.', 'warn');
      else if (r.reason === 'offline') toast(r.detail || '', 'warn');
      else if (r.reason === 'invalid' && (r.type === 'attack' || r.type === 'block' || /attack|block/i.test(r.detail || ''))) toast(r.detail || '', 'info');
      else if (r.detail) toast(r.detail, 'warn');
    });
    return () => { offState(); offNotice(); offReject(); };
  }, [session]);

  // ----- keep the screen awake during play -----
  useEffect(() => {
    let lock: WakeLockSentinel | null | undefined = null;
    const req = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or refused */ } };
    const vis = () => { if (document.visibilityState === 'visible') void req(); };
    void req();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release?.(); };
  }, []);

  // ----- pointer highlight -----
  function showPointer(who: Actor, cardId: string | null, zone: ZoneId | null) {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      let el: Element | null = cardId ? root.querySelector(`.board [data-card="${cardId}"], .sheet [data-card="${cardId}"]`) : null;
      if (!el && zone) el = root.querySelector(`[data-slot="${zone}"]`);
      if (!el && cardId) {
        const z = findZone(session.state, cardId);
        if (z) el = root.querySelector(`[data-slot="${z}"]`);
      }
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const key = Date.now();
      setPointer({ key, rect, actor: who });
      setTimeout(() => setPointer((cur) => (cur?.key === key ? null : cur)), 3000);
    });
  }

  // ----- gestures -----
  const handlers = useRef<Required<GestureHandlers> | null>(null);
  handlers.current = { onTap, onLongPress, onDrop, canDrag, onSpread };
  const gestures = useRef<Gestures | null>(null);
  useEffect(() => {
    const root = rootRef.current!;
    gestures.current = attachGestures(root, {
      onTap: (el, e) => handlers.current!.onTap(el, e),
      onLongPress: (el) => handlers.current!.onLongPress(el),
      onDrop: (el, d) => handlers.current!.onDrop(el, d),
      canDrag: (el) => handlers.current!.canDrag(el),
      onSpread: (card, row) => handlers.current!.onSpread(card, row),
    });
    return () => { gestures.current?.detach(); gestures.current = null; };
  }, []);

  function canDrag(_el: HTMLElement): boolean {
    if (session.status && session.status !== 'open' && session.kind === 'guest') return false;
    if (state.result) return false;
    return true;
  }

  const zoneAttr = (el: HTMLElement): ZoneId | null => {
    const z = el.dataset.zone;
    return isZone(z) ? z : null;
  };

  /**
   * Opening and closing slots works the same in every mode: a tap on a slot itself (its empty part
   * or its "tap to open" / "tap to close" strip) opens or closes it, and a tap on a card in a
   * crowded (collapsed) slot only opens it, so the next tap lands on the card meant. Returns true
   * if the tap was used for that.
   */
  function slotTap(el: HTMLElement): boolean {
    if (el.closest('.sheet')) return false;
    const slot = el.dataset.slot;
    if (el.dataset.tap === 'slot' && isZone(slot)) {
      if (openSlots.includes(slot)) closeSlot(slot);
      else if (el.dataset.collapsed || el.dataset.groups) openSlot(slot);
      return true;
    }
    const row = el.dataset.card && !el.closest('.pile') ? el.closest<HTMLElement>('[data-drop]') : null;
    const zone = row?.dataset.drop;
    if (row?.dataset.collapsed && isZone(zone)) { openSlot(zone); return true; }
    return false;
  }

  function onTap(el: HTMLElement) {
    // A tap on a counter or combat mark on the board means its card (dragging is what moves the mark).
    if (el.dataset.badge && !el.closest('.full-wrap')) el = el.closest<HTMLElement>('[data-card]') || el;
    // The matchup highlight stays while you tap its cards; a tap anywhere else clears it.
    if (match && !el.dataset.card) dispatch({ type: 'match', cardId: null });
    if ((attaching || combat) && slotTap(el)) return;
    if (attaching) {
      const targetId = el.dataset.card;
      const zone = zoneAttr(el);
      if (!targetId || !zone || el.closest('.sheet')) { toast('Tap a card on the battlefield to attach to, or Cancel.', 'info'); return; }
      if (targetId === attaching.cardId) { toNormal(); return; }
      const k = zoneKind(zone);
      if (k !== 'battlefield' && k !== 'lands') { toast('Cards can only be attached to a card on the battlefield.', 'info'); return; }
      send('attach', { cardId: attaching.cardId, from: findZone(state, attaching.cardId) || attaching.zone, toCardId: targetId, toZone: zone });
      toNormal();
      return;
    }
    if (combat) { combatTap(el, combat.blocker); return; }
    if (pointMode) {
      const cardId = el.dataset.card || null;
      const zone = el.dataset.zone || el.dataset.slot || el.closest<HTMLElement>('[data-slot]')?.dataset.slot || null;
      if (cardId || zone) send('point', { cardId, zone });
      toNormal();
      return;
    }
    // A token is created only by dragging it onto a slot, never by a tap.
    if (el.dataset.tokenDef) { toast('Drag a token onto a battlefield to create it.', 'info'); return; }
    if (el.dataset.counter === 'attack') { toast('Drag ⚔ Attack onto a creature to mark it attacking; drag the mark off to remove it.', 'info'); return; }
    if (el.dataset.counter === 'label') {
      void promptBox({ title: 'Labeled counter', body: 'Name for the labeled counter tag, e.g. loyalty, lore, charge, time.', value: label, ok: 'Use' })
        .then((v) => { if (v && v.trim()) dispatch({ type: 'label', label: v.trim().slice(0, 16) }); });
      return;
    }
    const tap = el.dataset.tap;
    if (tap === 'counters') { setSheet({ kind: 'counters' }); return; }
    if (tap === 'ticker') { setSheet({ kind: 'log' }); return; }
    if (el.dataset.card) {
      const zone = zoneAttr(el);
      if (!zone) return;
      const inSheet = !!el.closest('.sheet');
      if (inSheet) return;
      if (el.closest('.pile')) { pileTap(zone); return; }
      if (slotTap(el)) return;
      const row = el.closest<HTMLElement>('[data-drop]');
      const k = zoneKind(zone);
      // A tucked attachment is a thin strip: a tap on it is meant for the card it is attached to.
      const c = state.cards[el.dataset.card];
      const target = c?.attachedTo && !row?.dataset.fanned ? c.attachedTo : el.dataset.card;
      if (k === 'battlefield' || k === 'lands') send('tap', { cardId: target, from: zone });
      return;
    }
    const slot = el.dataset.slot;
    if (tap === 'pile' && isZone(slot)) { pileTap(slot); return; }
    slotTap(el);
  }

  /**
   * Combat mode. A card on the active player's side toggles attacking. A card on the other side
   * is picked as a blocker; the next tap on an attacker pairs them (tap again to undo the pair).
   */
  function combatTap(el: HTMLElement, blocker: { cardId: string; zone: ZoneId } | null) {
    const zone = zoneAttr(el);
    const k = zone ? zoneKind(zone) : null;
    if (!el.dataset.card || !zone || el.closest('.sheet') || (k !== 'battlefield' && k !== 'lands')) {
      toast('In combat, tap creatures on the battlefield. Done returns to normal play.', 'info');
      return;
    }
    const row = el.closest<HTMLElement>('[data-drop]');
    const c = state.cards[el.dataset.card];
    const id = c?.attachedTo && !row?.dataset.fanned ? c.attachedTo : el.dataset.card; // a tucked strip means its card
    if (zoneOwner(zone) === state.activePlayer) {
      if (blocker) {
        if (!state.cards[id]?.attacking) { toast('Mark that creature as attacking first.', 'info'); return; }
        send('block', { cardId: blocker.cardId, from: findZone(state, blocker.cardId) || blocker.zone, attackerId: id, attackerZone: zone });
        dispatch({ type: 'mode', mode: { kind: 'combat', blocker: null } });
      } else send('attack', { cardId: id, from: zone });
      return;
    }
    dispatch({ type: 'mode', mode: { kind: 'combat', blocker: blocker?.cardId === id ? null : { cardId: id, zone } } });
  }

  function passTurn() {
    const from = state.players[state.activePlayer].name, to = state.players[other(state.activePlayer)].name;
    void confirmBox({ title: `End ${from}’s turn?`, body: `The turn passes to ${to}, whose cards untap.`, ok: `Pass to ${to}` })
      .then((yes) => {
        if (!yes) return;
        send('passTurn', { to: other(state.activePlayer) });
        // One device: the screen goes to the next player, so the hand that was showing is hidden.
        if (same) blind();
      });
  }
  const hasCombatMarks = Object.values(state.cards).some((c) => c.attacking || c.blocking);
  function endCombat() {
    // One tap clears every mark, so ask first (Undo would bring them back, but it is easy to miss).
    const cards = Object.values(state.cards);
    const nA = cards.filter((c) => c.attacking).length;
    const nB = cards.reduce((n, c) => n + (c.blocking || []).length, 0);
    const what = [nA ? `${nA} attacker${nA > 1 ? 's' : ''}` : '', nB ? `${nB} block${nB > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
    const finish = () => { send('endCombat', {}); toNormal(); };
    if (!what) { finish(); return; }
    void confirmBox({ title: 'End combat?', body: `This clears ${what}.`, ok: 'Clear marks', cancel: 'Keep fighting' })
      .then((yes) => { if (yes) finish(); });
  }

  function pileTap(zone: ZoneId) {
    if (zoneKind(zone) === 'library') { dispatch({ type: 'mode', mode: { kind: 'library', zone, n: 1 } }); return; }
    // The stack opens in the full view on its top item; swipes step down it. An empty stack does nothing.
    if (zone === 'stack') {
      const top = state.zones.stack[0];
      if (top) dispatch({ type: 'full', full: { cardId: top, zone, anchor: top } });
      return;
    }
    setSheet({ kind: 'zone', zone });
  }

  function onLongPress(el: HTMLElement) {
    const token = el.dataset.tokenDef;
    if (token) {
      const i = tokens.indexOf(token);
      if (i >= 0) setTokenView({ i, back: false });
      return;
    }
    const cardId = el.dataset.card;
    const zone = zoneAttr(el);
    if (!cardId || !zone) return;
    const card = state.cards[cardId];
    if (!card) return;
    const inPrivateTray = !!el.closest('.sheet') && !!sheet && ['peek', 'search', 'inspect', 'reveal'].includes(sheet.kind);
    const visible = inPrivateTray || canSeeFace(state, card, zone, viewer) || (card.faceDown && viewer === card.owner);
    if (!visible) { toast('You can’t see that card’s face.', 'info'); return; }
    dispatch({ type: 'full', full: { cardId, zone, anchor: cardId } });
  }

  /**
   * Dragging the full view's card up: back to the board with the card's group under the finger,
   * to drop on any slot. The board's own element for the card (or the tray's) is what drags.
   */
  function dragOutOfFull(cardId: string, zone: ZoneId, e: PointerEvent, x0: number, y0: number) {
    const root = rootRef.current;
    const els = root ? [...root.querySelectorAll<HTMLElement>(`[data-card="${CSS.escape(cardId)}"]`)].filter((el) => !el.closest('.full-wrap')) : [];
    const el = els.find((x) => x.dataset.zone === zone) || els[0];
    if (!el || !gestures.current) { toast('Close the full view to move this card.', 'info'); return; }
    closeFull();
    gestures.current.adopt(el, e.pointerId, x0, y0, e.clientX, e.clientY);
  }

  /**
   * Two-finger spread on the board: the full view, like a long-press. On a collapsed slot it opens
   * the slot's first card (the lead of its first group); otherwise the card under the fingers.
   */
  function onSpread(cardEl: HTMLElement | null, rowEl: HTMLElement | null) {
    if (cardEl?.dataset.tokenDef) { onLongPress(cardEl); return; }
    if (full || sheet) return;
    const zone = rowEl?.dataset.drop;
    if (rowEl?.dataset.collapsed && isZone(zone)) {
      const first = state.zones[zone][0];
      if (!first) return;
      const lead = hostOf(state, first);
      const el = rowEl.querySelector<HTMLElement>(`[data-card="${CSS.escape(lead)}"]`);
      if (el) onLongPress(el);
      return;
    }
    if (cardEl) onLongPress(cardEl);
  }

  /** Close the full view; a card in combat leaves its matchup highlighted on the board. */
  function closeFull() {
    if (full && matchupIds(state, full.anchor).size) dispatch({ type: 'match', cardId: full.anchor });
    dispatch({ type: 'full', full: null });
  }

  function onDrop(src: HTMLElement, d: Drop) {
    const dz = 'zone' in d && isZone(d.zone) ? d.zone : null;
    const dCard = 'cardId' in d ? d.cardId : undefined;
    const onCard = 'onCard' in d ? d.onCard : undefined;
    // A counter dragged off its card is removed wherever it lands, even outside every slot.
    if (src.dataset.badge) {
      const cardId = src.dataset.cardOf;
      // In the full-screen view the card fills most of the screen, so any drag of a counter removes one.
      if (!src.closest('.full-wrap') && (onCard === cardId || dCard === cardId)) return;
      if (src.dataset.badge === 'attack') { send('attack', { cardId, from: src.dataset.zone, value: false }); return; }
      if (src.dataset.badge === 'block') {
        const atk = src.dataset.attacker;
        send('block', { cardId, from: src.dataset.zone, attackerId: atk, attackerZone: atk ? findZone(state, atk) : null, value: false });
        return;
      }
      send('removeCounter', { cardId, from: src.dataset.zone, kind: src.dataset.badge, label: src.dataset.label });
      return;
    }
    // An ability line from the full view: onto the Stack it goes on top; anywhere else, nothing.
    if (src.dataset.abilityOf) {
      if (dz === 'stack') send('putAbility', { cardId: src.dataset.abilityOf, from: src.dataset.zone, text: src.dataset.abilityText });
      return;
    }
    if ('nowhere' in d) return;
    // A counter from the footer onto a card.
    if (src.dataset.counter) {
      if (!dCard || !dz) return;
      const kind = src.dataset.counter;
      if (kind === 'attack') {
        const k = zoneKind(dz);
        if (k !== 'battlefield' && k !== 'lands') { toast('Only a card on the battlefield can attack.', 'info'); return; }
        if (zoneOwner(dz) !== state.activePlayer) { toast(`Only ${state.players[state.activePlayer].name}’s creatures can attack this turn.`, 'info'); return; }
        const c = state.cards[dCard];
        send('attack', { cardId: c?.attachedTo || dCard, from: dz, value: true });
        return;
      }
      send('addCounter', { cardId: dCard, from: dz, kind, label: kind === 'label' ? label : undefined });
      return;
    }
    // A token from the token picker.
    if (src.dataset.tokenDef) {
      if (!dz) return;
      send('createToken', { defId: src.dataset.tokenDef, name: src.dataset.tokenName, to: dz, toIndex: 'index' in d ? d.index : undefined, owner: zoneOwner(dz) || actingPlayer });
      return;
    }
    // A card.
    const cardId = src.dataset.card;
    const from = src.dataset.zone;
    if (!cardId || !from) return;
    const card = state.cards[cardId];
    if ('trash' in d) {
      if (card?.isToken) send('removeToken', { cardId, from });
      else toast('Only tokens can be removed. Drag cards to a graveyard or exile instead.', 'info');
      return;
    }
    if (!('index' in d) || !dz) return;
    let toIndex = d.index;
    if (d.tray) toIndex = trayIndex(dz, cardId, d.index ?? 0);
    send('move', { cardId, from, to: dz, toIndex });
  }

  /** Map a drop position among the tray's cards to an index in the library. */
  function trayIndex(zone: ZoneId, cardId: string, displayIndex: number): number {
    const libIds = state.zones[zone].filter((id) => id !== cardId);
    const tray = sheet?.kind === 'peek' || sheet?.kind === 'reveal' ? sheet : null;
    const visible = tray ? libIds.filter((id) => tray.ids.includes(id)) : libIds;
    if (!visible.length) return 0;
    if (displayIndex < visible.length) return libIds.indexOf(visible[displayIndex]!);
    return libIds.indexOf(visible[visible.length - 1]!) + 1;
  }

  // ----- library actions -----
  const libOwner = lib ? zoneOwner(lib) : null;
  const libTop = (z: ZoneId, n: number) => state.zones[z].slice(0, n);
  const libActions = lib && libOwner ? {
    draw: () => send('draw', { player: libOwner, n: libN }),
    mill: () => send('mill', { player: libOwner, n: libN }),
    peek: () => {
      if (viewer === 'nobody') { toast('Unblind your hand first — peeking is private.', 'info'); return; }
      const ids = libTop(lib, libN);
      send('peek', { zone: lib, n: ids.length });
      setSheet({ kind: 'peek', zone: lib, ids });
    },
    reveal: () => { const ids = libTop(lib, libN); send('revealTop', { zone: lib, n: ids.length, ids }); },
    search: () => {
      if (viewer === 'nobody') { toast('Unblind your hand first — searching is private.', 'info'); return; }
      if (libOwner === actingPlayer) { send('searchOpen', { zone: lib }); setSheet({ kind: 'search', zone: lib }); }
      else { send('inspect', { zone: lib }); setSheet({ kind: 'inspect', zone: lib }); }
    },
    shuffle: () => send('shuffle', { zone: lib }),
    topUp: () => send('setLibraryTopFaceUp', { player: libOwner, value: !state.players[libOwner].libraryTopFaceUp }),
  } : null;

  function closeSheet() {
    if (sheet?.kind === 'search') send('searchClose', { zone: sheet.zone });
    setSheet(null);
  }

  // ----- same-device blind / unblind -----
  /** Check it is really that player in front of the screen, then unblind. */
  function unblind(pl: PlayerId) { dispatch({ type: 'confirmFor', player: pl }); }

  function doUnblind(pl: PlayerId) {
    const away = awayLines.current.slice(seen.current[pl]).filter((l) => l.actor !== pl).map((l) => ({ text: l.text, alert: l.alert }));
    seen.current[pl] = awayLines.current.length;
    dispatch({ type: 'unblind', player: pl, away: away.length ? { name: state.players[pl].name, lines: away } : null });
  }

  /**
   * Reveal a hand card: a one-time event, logged, not a lasting card state.
   * Two devices: it pops up on the opponent's device. One device: blind the hand first,
   * then show only this card; it is hidden again when the reveal screen closes.
   */
  function revealCard(card: CardInstance, zone: ZoneId) {
    send('showCard', { cardId: card.id, zone });
    dispatch({ type: 'full', full: null });
    if (same) {
      blind();
      dispatch({ type: 'shown', shown: { actor: card.owner, cardIds: [card.id] } });
    }
  }

  /**
   * Enter combat mode (optionally with a blocker picked). One device: the hand is blinded first, so
   * both players can look at the board together while attackers and blockers are marked.
   */
  function startCombat(blocker: { cardId: string; zone: ZoneId } | null) {
    if (same && viewer !== 'nobody') blind();
    dispatch({ type: 'mode', mode: { kind: 'combat', blocker } });
  }

  function blind() {
    if (viewer !== 'nobody') seen.current[viewer] = awayLines.current.length;
    dispatch({ type: 'blind' });
  }

  // ----- export log -----
  async function exportLog() {
    if (same && !state.result) { toast('The log shows both hands, so in a one-device game it can be exported once the game ends.', 'info', 5000); return; }
    if (session.kind === 'guest') { toast('The full log is kept on the host device. Export it there.', 'info'); return; }
    const entries = await loadLog(state.gameId);
    const manifest: LogManifest = { kind: 'manifest', gameId: state.gameId, mode: state.mode, players: { p1: state.players.p1.name, p2: state.players.p2.name }, exportedAt: new Date().toISOString(), schemaVersion: state.schemaVersion };
    const body = [manifest, ...entries].map((e) => JSON.stringify(e)).join('\n') + '\n';
    await saveFile(new Blob([body], { type: 'application/x-ndjson' }), `mtg-game-${state.gameId}.jsonl`);
  }

  // ----- menu -----
  async function concede(pl: PlayerId) {
    if (await confirmBox({ title: `${state.players[pl].name} concedes?`, body: 'The game ends. Undo can bring it back.', ok: 'Concede', danger: true })) {
      send('concede', { player: pl }); setSheet(null);
    }
  }
  const menuItems: (MenuItem | null)[] = [
    same && viewer !== 'nobody' ? { label: 'Blind my hand', onClick: () => { blind(); setSheet(null); } } : null,
    canPass ? { label: 'Pass the turn', onClick: () => { setSheet(null); passTurn(); } } : null,
    !same || state.result ? { label: 'Export action log (JSON Lines)', onClick: () => void exportLog() } : null,
    session.kind === 'host' && pairing ? { label: 'Re-pair the guest device', onClick: () => setSheet({ kind: 'pair' }) } : null,
    session.kind === 'guest' && pairing ? { label: 'Reconnect to the host', onClick: () => setSheet({ kind: 'pair' }) } : null,
    !state.result && same ? { label: `${state.players.p1.name} concedes`, danger: true, onClick: () => void concede('p1') } : null,
    !state.result && same ? { label: `${state.players.p2.name} concedes`, danger: true, onClick: () => void concede('p2') } : null,
    !state.result && !same ? { label: 'Concede', danger: true, onClick: () => void concede(session.me) } : null,
    onRematch && session.kind !== 'guest' ? { label: 'Rematch with the same decks', onClick: async () => { if (await confirmBox({ title: 'Rematch?', body: 'Starts a new game with the same decks.', ok: 'Start rematch' })) { setSheet(null); onRematch(); } } } : null,
    { label: 'Leave to home screen', onClick: onExit },
  ];

  const ctx: BoardCtx = { state, viewer, art, pointed: null, selected: combat ? combat.blocker?.cardId : null, match: match ? matchupIds(state, match) : null };
  const fullZone: ZoneId | null = full ? (findZone(state, full.cardId) || full.zone) : null;
  const isOffline = session.kind !== 'same-device' && session.status !== 'open';
  // The full view's row: the anchor's group (host first, then its attachments), then the host's
  // combat cards (an attacker's blockers, or the attackers a blocker blocks). It stays fixed while
  // you move through it.
  let fullRow: FullRow | null = null;
  if (full && state.cards[full.cardId]) {
    const has = (r: FullRow | null) => !!r && [...r.group, ...r.partners].includes(full.cardId);
    fullRow = fullRowOf(state, full.anchor);
    if (!has(fullRow)) fullRow = fullRowOf(state, full.cardId); // the shown card left the anchor's row
    if (fullRow && fullRow.group.length + fullRow.partners.length < 2) fullRow = null;
  }
  const fullStep = full && fullZone ? slotSteps(state, full.cardId, fullZone, viewer, sheet) : null;
  const model = full && fullZone ? fullModel(state, full.cardId, fullZone, viewer) : null;
  const matchSet = ctx.match;
  const showAttack = actor === 'table' || actingPlayer === state.activePlayer;

  // ----- footer -----
  let footer;
  if (model) {
    const { card, zone: fullZone, actions: a } = model;
    const hostId = card.attachedTo || card.id;
    const groupSize = a.detachAll;
    const detachAll = () => {
      const host = state.cards[hostId];
      if (!host) return;
      const hostName = canSeeFace(state, host, fullZone, viewer) ? host.name : 'this card';
      void confirmBox({
        title: 'Detach all?',
        body: `This detaches ${groupSize === 1 ? 'the 1 card' : `all ${groupSize} cards`} attached to ${hostName}. Undo brings them back.`,
        ok: 'Detach all',
      }).then((yes) => { if (yes) send('detachAll', { cardId: hostId, from: fullZone }); });
    };
    footer = (
      <div class="bar">
        {a.flip ? <button class="btn" onClick={() => send('flip', { cardId: card.id, from: fullZone })}>Flip</button> : null}
        {a.faceDown ? <button class="btn" onClick={() => send('setFaceDown', { cardId: card.id, from: fullZone, value: !card.faceDown })}>{card.faceDown ? 'Face up' : 'Face down'}</button> : null}
        {a.reveal ? <button class="btn" onClick={() => revealCard(card, fullZone)}>Reveal</button> : null}
        {a.tap ? <button class="btn" onClick={() => send('tap', { cardId: card.id, from: fullZone })}>{card.tapped ? 'Untap' : 'Tap'}</button> : null}
        {a.attack ? <button class="btn" onClick={() => send('attack', { cardId: card.id, from: fullZone })}>{card.attacking ? 'Stop attacking' : 'Attack'}</button> : null}
        {a.block ? <button class="btn" onClick={() => { startCombat({ cardId: card.id, zone: fullZone }); dispatch({ type: 'full', full: null }); setSheet(null); }}>Block</button> : null}
        {a.detach ? <button class="btn" onClick={() => send('detach', { cardId: card.id, from: fullZone })}>Detach</button> : null}
        {a.attach ? <button class="btn" onClick={() => { dispatch({ type: 'mode', mode: { kind: 'attach', cardId: card.id, zone: fullZone } }); dispatch({ type: 'full', full: null }); setSheet(null); }}>Attach</button> : null}
        {a.makeLead ? <button class="btn" onClick={() => send('setLead', { cardId: card.id, from: fullZone })}>Make lead</button> : null}
        {groupSize > 0 ? <button class="btn" onClick={detachAll}>Detach all</button> : null}
        {a.counters ? <CounterChips label={label} attack={showAttack} /> : null}
        <span class="spacer" />
        <button class="btn primary" onClick={closeFull}>Close</button>
      </div>
    );
  } else if (combat) {
    const blocker = combat.blocker;
    const b = blocker ? state.cards[blocker.cardId] : undefined;
    const bName = b && blocker && (canSeeFace(state, b, findZone(state, b.id) || blocker.zone, viewer) ? b.name : 'card');
    footer = (
      <div class="bar combat">
        <span class="attach-hint">{b
          ? <><b>{bName}</b> blocks: tap the attacker</>
          : <>Tap {state.players[state.activePlayer].name}’s attackers, or a blocker then its attacker.</>}</span>
        <button class="btn warn" onClick={endCombat}>End combat</button>
        <button class="btn primary" onClick={toNormal}>Done</button>
      </div>
    );
  } else if (attaching && state.cards[attaching.cardId]) {
    const c = state.cards[attaching.cardId]!;
    footer = (
      <div class="bar">
        <span class="attach-hint">Attach <b>{canSeeFace(state, c, findZone(state, c.id) || attaching.zone, viewer) ? c.name : 'card'}</b>: tap the card to attach it to</span>
        <span class="spacer" />
        <button class="btn primary" onClick={toNormal}>Cancel</button>
      </div>
    );
  } else if (lib && libOwner && libActions) {
    const mine = libOwner === actingPlayer;
    const setN = (n: number) => dispatch({ type: 'libraryN', n });
    footer = (
      <div class="bar lib">
        <span class="lib-counts">{zoneTitle(state, lib)}: <b>{state.zones[lib].length}</b> · other: {state.zones[`${other(libOwner)}.library`].length}</span>
        <span class="stepper"><button class="btn round" onClick={() => setN(libN - 1)}>−</button><b>{libN}</b><button class="btn round" onClick={() => setN(libN + 1)}>+</button></span>
        {mine ? <button class="btn" onClick={libActions.draw}>Draw {libN}</button> : null}
        <button class="btn" onClick={libActions.mill}>Mill {libN}</button>
        <button class="btn" onClick={libActions.peek}>Look at top {libN}</button>
        <button class="btn" onClick={libActions.reveal}>Reveal top {libN}</button>
        <button class="btn" onClick={libActions.search}>{mine ? 'Search' : 'Look through'}</button>
        <button class="btn" onClick={libActions.shuffle}>Shuffle</button>
        <button class={`btn ${state.players[libOwner].libraryTopFaceUp ? 'on' : ''}`} onClick={libActions.topUp}>Top face up</button>
        <span class="spacer" />
        <button class="btn primary" onClick={toNormal}>Done</button>
      </div>
    );
  } else {
    footer = (
      <div class="bar">
        <button class="btn" onClick={() => send('undo', {})} title="Undo the last action">Undo</button>
        <button class="btn" onClick={() => send('untapAll', { player: actingPlayer })}>Untap all</button>
        {canPass ? <button class="btn" onClick={passTurn}>Pass turn</button> : null}
        <button class="btn" onClick={() => startCombat(null)}>Combat</button>
        {hasCombatMarks ? <button class="btn warn" onClick={endCombat}>End combat</button> : null}
        {matchSet?.size ? <button class="btn on" onClick={() => dispatch({ type: 'match', cardId: null })}>Clear highlight</button> : null}
        <CounterChips label={label} attack={showAttack} />
        <button class="btn token-btn" data-trash onClick={() => setSheet({ kind: 'tokens' })} title="Tokens (drop a token here to remove it)">Tokens</button>
        <button class="btn" onClick={() => setSheet({ kind: 'dice' })}>Dice</button>
        <button class={`btn ${pointMode ? 'on' : ''}`} onClick={() => dispatch({ type: 'mode', mode: pointMode ? { kind: 'normal' } : { kind: 'point' } })}>{pointMode ? 'Tap a card…' : 'Point'}</button>
        {openSlots.length ? <button class="btn" onClick={() => dispatch({ type: 'closeSlots' })}>{openSlots.length > 1 ? 'Close slots' : 'Close slot'}</button> : null}
        {same && viewer !== 'nobody' ? <button class="btn warn" onClick={blind}>Blind my hand</button> : null}
        {same && viewer === 'nobody' ? (
          <>
            <button class="btn p1c" onClick={() => unblind('p1')}>Unblind to {state.players.p1.name}</button>
            <button class="btn p2c" onClick={() => unblind('p2')}>Unblind to {state.players.p2.name}</button>
          </>
        ) : null}
        <span class="spacer" />
        <button class="btn" onClick={() => setSheet({ kind: 'menu' })} aria-label="Menu">☰</button>
      </div>
    );
  }

  // ----- sheet -----
  let sheetEl = null;
  if (sheet) {
    const close = closeSheet;
    switch (sheet.kind) {
      case 'zone': case 'peek': case 'search': case 'inspect': case 'reveal':
        sheetEl = <CardSheet ctx={ctx} sheet={sheet} onClose={close} onRandom={(z) => send('randomPick', { zone: z })} />; break;
      case 'counters': sheetEl = <CountersSheet ctx={ctx} P={P} send={send} onClose={close} />; break;
      case 'log': sheetEl = <LogSheet lines={lines} onClose={close} onExport={() => void exportLog()} />; break;
      case 'tokens': sheetEl = <TokensSheet ctx={ctx} tokens={tokens} onClose={close} />; break;
      case 'dice': sheetEl = <DiceSheet ctx={ctx} P={P} send={send} onClose={close} />; break;
      case 'menu': sheetEl = <MenuSheet items={menuItems} onClose={close} />; break;
      case 'away': sheetEl = <AwaySheet name={sheet.name} lines={sheet.lines} onClose={close} />; break;
      case 'pair':
        if (pairing) sheetEl = <Sheet title={session.kind === 'host' ? 'Re-pair the guest' : 'Reconnect to the host'} onClose={close} tall>{pairing.render(() => setSheet(null))}</Sheet>;
        break;
    }
  }

  const last = lines[lines.length - 1];
  const status = session.kind === 'same-device' ? null
    : session.status === 'open' ? <span class="status ok">Connected</span>
    : session.status === 'waiting' ? <span class="status">Waiting for guest</span>
    : <button class="status bad" onClick={() => { if (pairing) setSheet({ kind: 'pair' }); }}>{session.kind === 'guest' ? 'Reconnecting — read-only' : 'Guest disconnected — tap to re-pair'}</button>;

  return (
    <div class={`game ${isOffline && session.kind === 'guest' ? 'readonly' : ''} ${pointMode ? 'pointing' : ''}`} ref={rootRef}>
      <div class="board-wrap">
        <Board ctx={ctx} P={P} openSlots={openSlots} />
        {full && fullZone && model ? (
          <div class="full-wrap">
            <FullCard ctx={ctx} model={model} row={fullRow}
              onCounter={(type, kind, lbl) => send(type, { cardId: full.cardId, from: fullZone, kind, label: lbl })}
              onPick={(id) => dispatch({ type: 'full', full: { cardId: id, zone: findZone(state, id) || fullZone, anchor: full.anchor } })}
              step={fullStep} onStep={(id) => dispatch({ type: 'full', full: { cardId: id, zone: fullZone, anchor: id } })}
              onDragOut={(e, x0, y0) => dragOutOfFull(full.cardId, fullZone, e, x0, y0)} onClose={closeFull}
              onToggleTap={() => send('tap', { cardId: full.cardId, from: fullZone })}
              onAbility={(text) => send('putAbility', { cardId: full.cardId, from: fullZone, text })}
              onAbilityDrag={(el, e, x0, y0) => {
                if (!gestures.current) return;
                closeFull();
                gestures.current.adopt(el, e.pointerId, x0, y0, e.clientX, e.clientY);
              }} />
          </div>
        ) : null}
        {sheetEl}
        {tokenView && tokens.length ? (
          <CardViewer art={art} order={tokens} counts={NO_COUNTS} view={{ ...tokenView, i: Math.min(tokenView.i, tokens.length - 1) }} setView={setTokenView}
            onDragOut={(defId, e, x0, y0) => {
              // As from the full view: back to the board with the token under the finger, to drop
              // on a slot. The sheet's own element for the token is what drags.
              const el = rootRef.current?.querySelector<HTMLElement>(`.sheet [data-token-def="${CSS.escape(defId)}"]`);
              if (!el || !gestures.current) return;
              setTokenView(null);
              gestures.current.adopt(el, e.pointerId, x0, y0, e.clientX, e.clientY);
            }} />
        ) : null}
        {state.result ? (
          <div class="result-banner">
            {state.result.winner ? `${state.players[state.result.winner].name} wins` : 'Game over'}{state.result.reason === 'concede' ? ' (concession)' : ''} — undo to continue, or use the menu.
          </div>
        ) : null}
      </div>
      <footer class="footer">
        <div class="ticker">
          <button class={`ticker-text ${last?.alert ? 'alert' : ''}`} data-tap="ticker">{last ? last.text : `Turn ${state.turn} · ${state.players[state.activePlayer].name}`}</button>
          {status}
        </div>
        {footer}
      </footer>
      {confirmFor ? (
        <ConfirmPlayer pl={confirmFor} name={state.players[confirmFor].name}
          onOk={() => { const pl = confirmFor; dispatch({ type: 'confirmFor', player: null }); doUnblind(pl); }}
          onCancel={() => dispatch({ type: 'confirmFor', player: null })} />
      ) : null}
      {shown ? <RevealScreen ctx={ctx} shown={shown} onClose={() => dispatch({ type: 'shown', shown: null })} /> : null}
      {pointer ? (
        <div class={`pointer-ring ${pointer.actor}`}
          style={`left:${pointer.rect.left - 4}px;top:${pointer.rect.top - 4}px;width:${pointer.rect.width + 8}px;height:${pointer.rect.height + 8}px`} />
      ) : null}
    </div>
  );
}

/** Opaque screen showing only the revealed card(s); covers the board and footer. */
function RevealScreen({ ctx, shown, onClose }: { ctx: BoardCtx; shown: { actor: PlayerId; cardIds: string[] }; onClose: () => void }) {
  const st = ctx.state;
  const cards = shown.cardIds.map((id) => st.cards[id]).filter((c): c is CardInstance => !!c);
  if (!cards.length) return null;
  const who = st.players[shown.actor]?.name || 'A player';
  return (
    <div class="reveal-screen" onClick={onClose} role="dialog" aria-label={`${who} reveals`}>
      <div class="reveal-title">{who} reveals</div>
      <div class="reveal-cards">
        {cards.map((c) => {
          const img = cardImage(ctx, c, findZone(st, c.id) || `${c.owner}.hand`, true, 'large');
          return img.url ? <img src={img.url} alt={c.name} draggable={false} /> : <div class="card-face missing big"><span>{c.name}</span></div>;
        })}
      </div>
      <div class="reveal-hint">Tap anywhere to close</div>
    </div>
  );
}

/** "Are you sure you are …?" before unblinding, in that player's colour (the colour of their button). */
function ConfirmPlayer({ pl, name, onOk, onCancel }: { pl: PlayerId; name: string; onOk: () => void; onCancel: () => void }) {
  const outside = useOutsideTap(onCancel);
  return (
    <div class="confirm-screen" role="dialog" aria-label={`Are you sure you are ${name}?`} {...outside}>
      <div class={`confirm-box ${pl}`}>
        <h3>Are you sure you are {name}?</h3>
        <p>Your hand will be shown face up.</p>
        <div class="confirm-actions">
          <button class="btn" onClick={onCancel}>Cancel</button>
          <button class="btn yes" onClick={onOk} autoFocus>Yes, I’m {name}</button>
        </div>
      </div>
    </div>
  );
}

/** Counter tags for the footer; the ⚔ Attack tag only for the player whose turn it is (or the table). */
function CounterChips({ label, attack = true }: { label: string; attack?: boolean }) {
  return (
    <span class="chips">
      <span class="chip plus" data-counter="plus" title="Drag onto a card">+1/+1</span>
      <span class="chip minus" data-counter="minus" title="Drag onto a card">−1/−1</span>
      <span class="chip label" data-counter="label" title="Drag onto a card; tap to rename">{label}</span>
      {attack ? <span class="chip attack" data-counter="attack" title="Drag onto a creature to mark it attacking">⚔ Attack</span> : null}
    </span>
  );
}

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/** The host card of a group: the card itself, or the card it is attached to. */
function hostOf(state: GameState, id: string): string {
  const c = state.cards[id];
  return c?.attachedTo && state.cards[c.attachedTo] ? c.attachedTo : id;
}

/**
 * The ← and → targets of the full view: the cards of the shown card's slot, in board order,
 * with each group counted once (by its host). Only cards whose face this viewer may see count;
 * in a private library tray (peek, reveal, search, inspect), the cards the tray shows.
 */
export function slotSteps(state: GameState, cardId: string, zone: ZoneId, viewer: Viewer, sheet: SheetState | null): { prev: string | null; next: string | null } {
  const tray = sheet && sheet.kind !== 'zone' && 'zone' in sheet && sheet.zone === zone && ['peek', 'reveal', 'search', 'inspect'].includes(sheet.kind);
  const all = state.zones[zone] || [];
  const ids = tray && 'ids' in sheet ? all.filter((id) => sheet.ids.includes(id)) : all;
  const units: string[] = [];
  for (const id of ids) {
    const h = hostOf(state, id);
    if (units.includes(h) || !state.cards[h]) continue;
    const c = state.cards[h]!;
    // On the stack every item counts, hidden or not, so positions match "Stack 2 of 3".
    if (zone === 'stack' || tray || canSeeFace(state, c, zone, viewer) || (c.faceDown && viewer === c.owner)) units.push(h);
  }
  const at = units.indexOf(hostOf(state, cardId));
  if (at < 0) return { prev: null, next: null };
  return { prev: units[at - 1] ?? null, next: units[at + 1] ?? null };
}

/** Attachments of a battlefield host, closest first (the order the full view shows them). */
function attachmentsIn(state: GameState, hostId: string): string[] {
  const z = findZone(state, hostId);
  return z ? state.zones[z].filter((x) => state.cards[x]?.attachedTo === hostId).reverse() : [];
}

/** The full view's row for a card: its group, then its host's combat cards. */
export function fullRowOf(state: GameState, id: string): FullRow | null {
  if (!state.cards[id]) return null;
  const z = findZone(state, id);
  const k = z ? zoneKind(z) : null;
  if (k !== 'battlefield' && k !== 'lands') return { group: [id], partners: [], role: null };
  const h = hostOf(state, id);
  const host = state.cards[h]!;
  const group = [h, ...attachmentsIn(state, h)];
  if (host.attacking) {
    const blockers = Object.values(state.cards).filter((c) => (c.blocking || []).includes(h)).map((c) => c.id);
    return { group, partners: blockers, role: 'attacker' };
  }
  const attackers = (host.blocking || []).filter((a) => state.cards[a]?.attacking);
  return { group, partners: attackers, role: attackers.length ? 'blocker' : null };
}

/** Every card in the combat matchup(s) a card belongs to: attackers, their blockers, and all their attachments. */
export function matchupIds(state: GameState, id: string): Set<string> {
  const out = new Set<string>();
  if (!state.cards[id]) return out;
  const h = state.cards[hostOf(state, id)]!;
  const attackers = h.attacking ? [h.id] : (h.blocking || []).filter((a) => state.cards[a]?.attacking);
  if (!attackers.length) return out;
  const members = new Set(attackers);
  for (const c of Object.values(state.cards)) if ((c.blocking || []).some((a) => attackers.includes(a))) members.add(c.id);
  for (const m of members) { out.add(m); for (const a of attachmentsIn(state, m)) out.add(a); }
  return out;
}
