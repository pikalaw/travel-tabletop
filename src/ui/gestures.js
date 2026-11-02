// One pointer-event gesture handler for the whole game screen: tap, long-press and drag.
// Elements opt in with data attributes:
//   data-card="id" data-zone="zone"         a card (tap, long-press, drag)
//   data-counter="plus|minus|label"         a counter source in the footer (drag onto a card)
//   data-badge="plus|minus|label"           a counter on a card (drag off to remove)
//   data-token-def="defId"                  a token in the token picker (drag onto a zone)
//   data-tap="name"                         anything else that reacts to a tap
//   data-drop="zone"                        a drop target slot; data-layout="row|pile|library|tray"
//   data-trash                              a drop target that removes tokens / counters
// Scrollable open slots use `touch-action: pan-x`, so a horizontal swipe scrolls (the browser
// takes over and sends pointercancel) while a vertical-ish movement starts a drag.

const DRAG_PX = 8;
const LONG_MS = 480;

const SOURCE_SEL = '[data-card],[data-counter],[data-badge],[data-token-def],[data-tap]';

/**
 * @param {HTMLElement} root
 * @param {{ onTap: (el: HTMLElement, e: PointerEvent) => void,
 *           onLongPress: (el: HTMLElement) => void,
 *           onDrop: (src: HTMLElement, drop: any) => void,
 *           canDrag?: (el: HTMLElement) => boolean }} h
 */
export function attachGestures(root, h) {
  let g = null; // current gesture

  const clear = () => {
    if (!g) return;
    clearTimeout(g.timer);
    g.ghost?.remove();
    g.hover?.classList.remove('drop-hover', 'drop-top', 'drop-bottom');
    document.body.classList.remove('dragging');
    g = null;
  };

  const down = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = /** @type {HTMLElement} */ (e.target).closest(SOURCE_SEL);
    if (!el || !root.contains(el)) return;
    if (g) clear();
    g = { el, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dragging: false, long: false, ghost: null, hover: null, timer: 0 };
    if (el.dataset.card) {
      g.timer = setTimeout(() => {
        if (g && !g.dragging) { g.long = true; navigator.vibrate?.(15); h.onLongPress(el); }
      }, LONG_MS);
    }
  };

  const startDrag = () => {
    g.dragging = true;
    clearTimeout(g.timer);
    const src = g.el.querySelector('img, .card-face') || g.el;
    const r = src.getBoundingClientRect();
    const ghost = /** @type {HTMLElement} */ (src.cloneNode(true));
    ghost.classList.add('drag-ghost');
    const w = Math.max(r.width, 40), hgt = Math.max(r.height, 40);
    Object.assign(ghost.style, { width: `${w}px`, height: `${hgt}px`, left: `${g.x - w / 2}px`, top: `${g.y - hgt / 2}px` });
    g.gw = w; g.gh = hgt;
    document.body.appendChild(ghost);
    document.body.classList.add('dragging');
    g.ghost = ghost;
    g.el.classList.add('drag-source');
  };

  // Counters land on cards; everything else lands on slots.
  const targetAt = (x, y) => {
    const hit = /** @type {HTMLElement | null} */ (document.elementFromPoint(x, y));
    if (!hit) return null;
    if (g?.el.dataset.counter) return hit.closest('[data-card-target],[data-trash]');
    return hit.closest('[data-drop],[data-trash]');
  };

  const move = (e) => {
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX; g.y = e.clientY;
    const dist = Math.hypot(g.x - g.x0, g.y - g.y0);
    if (!g.dragging && !g.long && dist > DRAG_PX) {
      if (h.canDrag && !h.canDrag(g.el)) { clearTimeout(g.timer); return; }
      startDrag();
    }
    if (!g.dragging) return;
    e.preventDefault();
    g.ghost.style.left = `${g.x - g.gw / 2}px`;
    g.ghost.style.top = `${g.y - g.gh / 2}px`;
    const t = targetAt(g.x, g.y);
    if (t !== g.hover) { g.hover?.classList.remove('drop-hover', 'drop-top', 'drop-bottom'); g.hover = t; t?.classList.add('drop-hover'); }
    if (t?.dataset.layout === 'library') {
      const r = t.getBoundingClientRect();
      const top = g.y < r.top + r.height / 2;
      t.classList.toggle('drop-top', top);
      t.classList.toggle('drop-bottom', !top);
    }
  };

  const up = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const cur = g;
    g.el.classList.remove('drag-source');
    if (cur.dragging) {
      const t = targetAt(e.clientX, e.clientY);
      const drop = t ? describeDrop(t, e.clientX, e.clientY, cur.el) : null;
      cur.ghost?.remove();
      clear();
      if (drop) h.onDrop(cur.el, drop);
      else h.onDrop(cur.el, { nowhere: true });
    } else if (!cur.long) {
      clear();
      h.onTap(cur.el, e);
    } else clear();
  };

  const cancel = (e) => { if (g && e.pointerId === g.id) { g.el.classList.remove('drag-source'); clear(); } };
  const context = (e) => {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-card]');
    if (el && root.contains(el)) { e.preventDefault(); clear(); h.onLongPress(el); }
  };
  // While dragging, stop the page from scrolling under the finger.
  const touchmove = (e) => { if (g?.dragging) e.preventDefault(); };

  // Stop the browser's own image drag, which would cancel the pointer gesture.
  const nodrag = (e) => e.preventDefault();
  root.addEventListener('dragstart', nodrag);
  root.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  root.addEventListener('contextmenu', context);
  window.addEventListener('touchmove', touchmove, { passive: false });
  return () => {
    clear();
    root.removeEventListener('dragstart', nodrag);
    root.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    root.removeEventListener('contextmenu', context);
    window.removeEventListener('touchmove', touchmove);
  };
}

/** Work out what a drop at (x, y) on target t means. */
function describeDrop(t, x, y, srcEl) {
  if (t.hasAttribute('data-trash')) return { trash: true };
  if (t.dataset.cardTarget) return { cardId: t.dataset.cardTarget, zone: t.dataset.zone };
  const zone = t.dataset.drop;
  const layout = t.dataset.layout || 'pile';
  const cardEl = /** @type {HTMLElement | null} */ (document.elementFromPoint(x, y))?.closest('[data-card]');
  const onCard = cardEl && t.contains(cardEl) ? cardEl.dataset.card : null;
  if (layout === 'library') {
    const r = t.getBoundingClientRect();
    return { zone, index: y < r.top + r.height / 2 ? 0 : undefined, position: y < r.top + r.height / 2 ? 'top' : 'bottom', onCard };
  }
  if (layout === 'pile') return { zone, index: 0, onCard };
  // Row or tray: index = number of cards whose centre is left of the pointer (excluding the dragged card).
  const cards = [...t.querySelectorAll(':scope [data-card]')].filter((el) => el !== srcEl && el.closest('[data-drop]') === t);
  let index = 0;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    if (r.left + r.width / 2 < x) index++;
  }
  const offset = parseInt(t.dataset.offset || '0', 10);
  return { zone, index: index + offset, onCard, tray: layout === 'tray' };
}
