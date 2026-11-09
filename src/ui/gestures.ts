// One pointer-event gesture handler for the whole game screen: tap, long-press and drag.
// Elements opt in with data attributes:
//   data-card="id" data-zone="zone"         a card (tap, long-press, drag)
//   data-counter="plus|minus|label"         a counter source in the footer (drag onto a card)
//   data-badge="plus|minus|label"           a counter on a card (drag off to remove)
//   data-token-def="defId"                  a token in the token picker (drag onto a zone)
//   data-tap="name"                         anything else that reacts to a tap
//   data-drop="zone"                        a drop target slot; data-layout="row|pile|library|tray|append"
//   data-trash                              a drop target that removes tokens / counters
// Horizontal scrollers (the footer bar, open slots, trays) are panned here rather than by the
// browser, so scrolling does not depend on touch-action handling: a mostly horizontal movement
// that starts inside one scrolls it (and cancels the tap); any other movement on a card drags it.

const DRAG_PX = 8;
/** A two-finger spread counts once the fingers are this much farther apart (ratio, and at least SPREAD_PX). */
const SPREAD_RATIO = 1.3;
const SPREAD_PX = 30;
/** How much of each attached card shows to the left of its card in a dragged group (as on the board). */
const GROUP_PEEK = 0.25;
const LONG_MS = 480;
/** Width of the text box an ability drags as. */
const TEXT_GHOST_W = 220;

const SOURCE_SEL = '[data-card],[data-counter],[data-badge],[data-token-def],[data-tap]';
const SCROLL_SEL = '.bar, .row.open';
const FRICTION = 0.95; // per 16 ms frame, for the glide after a fling

/** Where a drag ended. */
export type Drop =
  | { trash: true }
  | { cardId: string; zone: string | undefined }
  | { nowhere: true; cardId: string | undefined }
  | { zone: string; index: number | undefined; onCard: string | null; position?: 'top' | 'bottom'; tray?: boolean };

export interface GestureHandlers {
  onTap: (el: HTMLElement, e: PointerEvent) => void;
  onLongPress: (el: HTMLElement) => void;
  onDrop: (src: HTMLElement, drop: Drop) => void;
  canDrag?: (el: HTMLElement) => boolean;
  /**
   * A two-finger spread (zoom-in gesture). `card` is the card the first finger was on (or the one
   * under the fingers' midpoint), `row` the slot it happened in; either may be null.
   */
  onSpread?: (card: HTMLElement | null, row: HTMLElement | null) => void;
}

interface Gesture {
  el: HTMLElement | null;
  sc: HTMLElement | null;
  sl0: number;
  id: number;
  x0: number; y0: number; x: number; y: number;
  dragging: boolean; panning: boolean; long: boolean;
  ghost: HTMLElement | null;
  hover: HTMLElement | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  v: number; t: number;
  gw: number; gh: number;
  /** Pointer position within the ghost. */
  ox: number; oy: number;
  /** Attached cards dragged along with their card. */
  group: HTMLElement[];
}

export interface Gestures {
  /** Remove every listener. */
  detach: () => void;
  /**
   * Take over a pointer that is already moving (from a view with its own pointer handling, such as
   * the full view) as a drag of card element `el`, from (x0, y0) to (x, y). Returns false if the
   * card may not be dragged now.
   */
  adopt: (el: HTMLElement, pointerId: number, x0: number, y0: number, x: number, y: number) => boolean;
}

export function attachGestures(root: HTMLElement, h: GestureHandlers): Gestures {
  let g: Gesture | null = null; // current gesture
  let glide = 0; // animation frame of a running fling
  let swallowClick = false; // the click that follows a pan must not press a button
  // Every finger currently down, for two-finger gestures.
  const pts = new Map<number, { x: number; y: number }>();
  let spread: { a: number; b: number; d0: number; card: HTMLElement | null; row: HTMLElement | null; fired: boolean } | null = null;
  const dist = (a: number, b: number) => {
    const p = pts.get(a), q = pts.get(b);
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : 0;
  };

  const clear = () => {
    if (!g) return;
    clearTimeout(g.timer);
    g.ghost?.remove();
    g.hover?.classList.remove('drop-hover', 'drop-top', 'drop-bottom');
    document.body.classList.remove('dragging');
    g = null;
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.pointerType === 'touch') pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // A second finger: a two-finger gesture, which replaces whatever the first finger began.
    if (pts.size === 2 && !spread) {
      const [a, b] = [...pts.keys()] as [number, number];
      const p = pts.get(a)!, q = pts.get(b)!;
      const mid = document.elementFromPoint((p.x + q.x) / 2, (p.y + q.y) / 2) as HTMLElement | null;
      const first = g?.el?.dataset.card ? g.el : null;
      const card = first || mid?.closest<HTMLElement>('[data-card],[data-token-def]') || null;
      const row = (card || mid)?.closest<HTMLElement>('[data-drop]') || null;
      if (g) { for (const el of [g.el, ...g.group]) el?.classList.remove('drag-source'); clear(); }
      spread = { a, b, d0: Math.max(1, dist(a, b)), card: card && root.contains(card) ? card : null, row: row && root.contains(row) ? row : null, fired: false };
      return;
    }
    if (spread) return;
    const t = e.target as HTMLElement;
    let el = t.closest<HTMLElement>(SOURCE_SEL);
    if (el && !root.contains(el)) el = null;
    let sc = t.closest<HTMLElement>(SCROLL_SEL);
    if (sc && (!root.contains(sc) || sc.scrollWidth <= sc.clientWidth + 1)) sc = null;
    if (!el && !sc) return;
    cancelAnimationFrame(glide);
    if (g) clear();
    g = { el, sc, sl0: sc ? sc.scrollLeft : 0, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
          dragging: false, panning: false, long: false, ghost: null, hover: null, timer: undefined, v: 0, t: e.timeStamp, gw: 0, gh: 0, ox: 0, oy: 0, group: [] };
    // A card, or a token in the Tokens sheet, opens full screen on a long-press.
    if (el?.dataset.card || el?.dataset.tokenDef) {
      g.timer = setTimeout(() => {
        if (g && !g.dragging) { g.long = true; navigator.vibrate?.(15); h.onLongPress(el!); }
      }, LONG_MS);
    }
  };

  const startDrag = (g: Gesture & { el: HTMLElement }) => {
    g.dragging = true;
    clearTimeout(g.timer);
    // A group drags as one, whichever of its cards is grabbed: an attached card brings its card
    // and the rest of the group (only Detach splits a group). The attached cards peek out to the
    // card's left, as on the board.
    const row = g.el.closest<HTMLElement>('[data-drop]');
    const hostId = g.el.dataset.attachedTo;
    const hostEl = hostId && row ? row.querySelector<HTMLElement>(`[data-card="${CSS.escape(hostId)}"]`) : null;
    if (hostEl) g.el = hostEl;
    const face = (el: HTMLElement) => el.querySelector<HTMLElement>('img, .card-face') || el;
    const src = face(g.el);
    const r = src.getBoundingClientRect();
    const w = Math.max(r.width, 40), hgt = Math.max(r.height, 40);
    const id = g.el.dataset.card;
    g.group = id && row ? [...row.querySelectorAll<HTMLElement>(`[data-attached-to="${CSS.escape(id)}"]`)] : [];
    let ghost: HTMLElement;
    // An element that names its drag text (an ability) drags as a box of that text, not a picture.
    const text = g.el.dataset.dragText;
    if (text) {
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost text';
      ghost.textContent = text;
      g.gw = TEXT_GHOST_W;
      g.ox = TEXT_GHOST_W / 2;
    } else if (g.group.length) {
      const peek = Math.round(w * GROUP_PEEK);
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost group';
      const parts = [...g.group, g.el].map((el, i) => {
        const part = face(el).cloneNode(true) as HTMLElement;
        Object.assign(part.style, { position: 'absolute', left: `${i * peek}px`, top: '0', width: `${w}px`, height: `${hgt}px` });
        return part;
      });
      ghost.append(...parts);
      g.gw = w + peek * g.group.length;
      g.ox = peek * g.group.length + w / 2;
    } else {
      ghost = src.cloneNode(true) as HTMLElement;
      ghost.classList.add('drag-ghost');
      g.gw = w;
      g.ox = w / 2;
    }
    Object.assign(ghost.style, { width: `${g.gw}px`, left: `${g.x - g.ox}px` });
    if (!text) ghost.style.height = `${hgt}px`;
    document.body.appendChild(ghost);
    // A text box is as tall as its text; the finger holds it by the middle either way.
    g.gh = text ? ghost.offsetHeight : hgt;
    g.oy = g.gh / 2;
    ghost.style.top = `${g.y - g.oy}px`;
    document.body.classList.add('dragging');
    g.ghost = ghost;
    for (const el of [g.el, ...g.group]) el.classList.add('drag-source');
  };

  // Counters land on cards; everything else lands on slots.
  const targetAt = (x: number, y: number): HTMLElement | null => {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    if (g?.el?.dataset.counter) return hit.closest<HTMLElement>('[data-card-target],[data-trash]');
    return hit.closest<HTMLElement>('[data-drop],[data-trash]');
  };

  const move = (e: PointerEvent) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (spread) {
      if (e.pointerId !== spread.a && e.pointerId !== spread.b) return;
      e.preventDefault();
      const d = dist(spread.a, spread.b);
      if (!spread.fired && d > spread.d0 * SPREAD_RATIO && d - spread.d0 > SPREAD_PX) {
        spread.fired = true;
        h.onSpread?.(spread.card, spread.row);
      }
      return;
    }
    if (!g || e.pointerId !== g.id) return;
    const px = g.x, pt = g.t;
    g.x = e.clientX; g.y = e.clientY; g.t = e.timeStamp;
    const dx = g.x - g.x0, dy = g.y - g.y0;
    if (!g.dragging && !g.panning && !g.long && Math.hypot(dx, dy) > DRAG_PX) {
      // A counter on a card always drags (so it can come off sideways); anything else pans a scroller sideways.
      if (g.sc && !g.el?.dataset.badge && Math.abs(dx) > Math.abs(dy)) { g.panning = true; clearTimeout(g.timer); }
      else if (!g.el || (h.canDrag && !h.canDrag(g.el))) { clearTimeout(g.timer); g.el = null; g.sc = null; return; }
      else startDrag(g as Gesture & { el: HTMLElement });
    }
    if (g.panning) {
      e.preventDefault();
      g.sc!.scrollLeft = g.sl0 - dx;
      const dt = g.t - pt;
      if (dt > 0) g.v = 0.8 * ((px - g.x) / dt) + 0.2 * g.v; // px per ms, scroll direction
      return;
    }
    if (!g.dragging) return;
    e.preventDefault();
    g.ghost!.style.left = `${g.x - g.ox}px`;
    g.ghost!.style.top = `${g.y - g.oy}px`;
    const t = targetAt(g.x, g.y);
    if (t !== g.hover) { g.hover?.classList.remove('drop-hover', 'drop-top', 'drop-bottom'); g.hover = t; t?.classList.add('drop-hover'); }
    if (t?.dataset.layout === 'library') {
      const r = t.getBoundingClientRect();
      const top = g.y < r.top + r.height / 2;
      t.classList.toggle('drop-top', top);
      t.classList.toggle('drop-bottom', !top);
    }
  };

  const endSpread = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (spread && (e.pointerId === spread.a || e.pointerId === spread.b)) {
      spread = null;
      swallowClick = true; setTimeout(() => { swallowClick = false; }, 400);
      return true;
    }
    return false;
  };
  const up = (e: PointerEvent) => {
    if (endSpread(e)) return;
    if (!g || e.pointerId !== g.id) return;
    const cur = g;
    for (const el of [cur.el, ...cur.group]) el?.classList.remove('drag-source');
    if (cur.panning) {
      clear();
      swallowClick = true; setTimeout(() => { swallowClick = false; }, 400);
      fling(cur.sc!, e.timeStamp - cur.t > 80 ? 0 : cur.v);
    } else if (!cur.el) clear();
    else if (cur.dragging) {
      const t = targetAt(e.clientX, e.clientY);
      const drop = t ? describeDrop(t, e.clientX, e.clientY, cur.el) : null;
      cur.ghost?.remove();
      clear();
      if (drop) h.onDrop(cur.el, drop);
      else {
        // Outside every slot; still note the card underneath, so a counter dropped back on its own card stays.
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-card-target]');
        h.onDrop(cur.el, { nowhere: true, cardId: under?.dataset.cardTarget });
      }
    } else if (!cur.long) {
      clear();
      h.onTap(cur.el, e);
    } else clear();
  };

  const fling = (sc: HTMLElement, v: number) => {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 50); last = now;
      v *= Math.pow(FRICTION, dt / 16);
      if (Math.abs(v) < 0.02) return;
      const before = sc.scrollLeft;
      sc.scrollLeft += v * dt;
      if (sc.scrollLeft === before) return; // hit an end
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };
  const click = (e: MouseEvent) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } };

  const cancel = (e: PointerEvent) => { if (endSpread(e)) return; if (g && e.pointerId === g.id) { for (const el of [g.el, ...g.group]) el?.classList.remove('drag-source'); clear(); } };
  const context = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
    if (el && root.contains(el)) { e.preventDefault(); clear(); h.onLongPress(el); }
  };
  // While dragging, stop the page from scrolling under the finger.
  const touchmove = (e: TouchEvent) => { if (g?.dragging || g?.panning || spread) e.preventDefault(); };

  // Stop the browser's own image drag, which would cancel the pointer gesture.
  const nodrag = (e: Event) => e.preventDefault();
  root.addEventListener('dragstart', nodrag);
  root.addEventListener('pointerdown', down);
  root.addEventListener('click', click, true);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  root.addEventListener('contextmenu', context);
  window.addEventListener('touchmove', touchmove, { passive: false });
  const adopt = (el: HTMLElement, pointerId: number, x0: number, y0: number, x: number, y: number) => {
    if (h.canDrag && !h.canDrag(el)) return false;
    cancelAnimationFrame(glide);
    if (g) clear();
    const cur: Gesture & { el: HTMLElement } = { el, sc: null, sl0: 0, id: pointerId, x0, y0, x, y, dragging: false, panning: false, long: false,
      ghost: null, hover: null, timer: undefined, v: 0, t: performance.now(), gw: 0, gh: 0, ox: 0, oy: 0, group: [] };
    g = cur;
    startDrag(cur);
    return true;
  };
  const detach = () => {
    clear();
    root.removeEventListener('dragstart', nodrag);
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('click', click, true);
    cancelAnimationFrame(glide);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    root.removeEventListener('contextmenu', context);
    window.removeEventListener('touchmove', touchmove);
  };
  return { detach, adopt };
}

/** Work out what a drop at (x, y) on target t means. */
function describeDrop(t: HTMLElement, x: number, y: number, srcEl: HTMLElement): Drop | null {
  if (t.hasAttribute('data-trash')) return { trash: true };
  if (t.dataset.cardTarget) return { cardId: t.dataset.cardTarget, zone: t.dataset.zone };
  const zone = t.dataset.drop;
  if (!zone) return null;
  const layout = t.dataset.layout || 'pile';
  const cardEl = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-card]');
  const onCard = cardEl && t.contains(cardEl) ? cardEl.dataset.card ?? null : null;
  if (layout === 'library') {
    const r = t.getBoundingClientRect();
    return { zone, index: y < r.top + r.height / 2 ? 0 : undefined, position: y < r.top + r.height / 2 ? 'top' : 'bottom', onCard };
  }
  if (layout === 'pile') return { zone, index: 0, onCard };
  if (layout === 'append') return { zone, index: undefined, onCard }; // e.g. the other player's hand count: add at the end
  // Row or tray: index = number of cards whose centre is left of the pointer (excluding the dragged card).
  // A dragged host carries its attachments, so they do not count either.
  const cards = [...t.querySelectorAll<HTMLElement>(':scope [data-card]')].filter((el) => el !== srcEl && el.closest('[data-drop]') === t &&
    !(srcEl.dataset.card && el.dataset.attachedTo === srcEl.dataset.card));
  let index = 0;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    if (r.left + r.width / 2 < x) index++;
  }
  const offset = parseInt(t.dataset.offset || '0', 10);
  return { zone, index: index + offset, onCard, tray: layout === 'tray' };
}
