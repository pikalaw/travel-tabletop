// One pointer-event gesture handler for the whole game screen: tap, long-press and drag.
// Elements opt in with data attributes:
//   data-card="id" data-zone="zone"         a card (tap, long-press, drag)
//   data-counter="plus|minus|label"         a counter source in the footer (drag onto a card)
//   data-badge="plus|minus|label"           a counter on a card (drag off to remove)
//   data-token-def="defId"                  a token in the token picker (drag onto a zone)
//   data-tap="name"                         anything else that reacts to a tap
//   data-drop="zone"                        a drop target slot; data-layout="row|pile|library|tray"
//   data-trash                              a drop target that removes tokens / counters
// Horizontal scrollers (the footer bar, open slots, trays) are panned here rather than by the
// browser, so scrolling does not depend on touch-action handling: a mostly horizontal movement
// that starts inside one scrolls it (and cancels the tap); any other movement on a card drags it.

const DRAG_PX = 8;
const LONG_MS = 480;

const SOURCE_SEL = '[data-card],[data-counter],[data-badge],[data-token-def],[data-tap]';
const SCROLL_SEL = '.bar, .row.open';
const FRICTION = 0.95; // per 16 ms frame, for the glide after a fling

/**
 * @param {HTMLElement} root
 * @param {{ onTap: (el: HTMLElement, e: PointerEvent) => void,
 *           onLongPress: (el: HTMLElement) => void,
 *           onDrop: (src: HTMLElement, drop: any) => void,
 *           canDrag?: (el: HTMLElement) => boolean }} h
 */
export function attachGestures(root, h) {
  let g = null; // current gesture
  let glide = 0; // animation frame of a running fling
  let swallowClick = false; // the click that follows a pan must not press a button

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
    const t = /** @type {HTMLElement} */ (e.target);
    let el = t.closest(SOURCE_SEL);
    if (el && !root.contains(el)) el = null;
    let sc = /** @type {HTMLElement | null} */ (t.closest(SCROLL_SEL));
    if (sc && (!root.contains(sc) || sc.scrollWidth <= sc.clientWidth + 1)) sc = null;
    if (!el && !sc) return;
    cancelAnimationFrame(glide);
    if (g) clear();
    g = { el, sc, sl0: sc ? sc.scrollLeft : 0, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
          dragging: false, panning: false, long: false, ghost: null, hover: null, timer: 0, v: 0, t: e.timeStamp };
    if (el?.dataset.card) {
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
    const px = g.x, pt = g.t;
    g.x = e.clientX; g.y = e.clientY; g.t = e.timeStamp;
    const dx = g.x - g.x0, dy = g.y - g.y0;
    if (!g.dragging && !g.panning && !g.long && Math.hypot(dx, dy) > DRAG_PX) {
      if (g.sc && Math.abs(dx) > Math.abs(dy)) { g.panning = true; clearTimeout(g.timer); }
      else if (!g.el || (h.canDrag && !h.canDrag(g.el))) { clearTimeout(g.timer); g.el = null; g.sc = null; return; }
      else startDrag();
    }
    if (g.panning) {
      e.preventDefault();
      g.sc.scrollLeft = g.sl0 - dx;
      const dt = g.t - pt;
      if (dt > 0) g.v = 0.8 * ((px - g.x) / dt) + 0.2 * g.v; // px per ms, scroll direction
      return;
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
    cur.el?.classList.remove('drag-source');
    if (cur.panning) {
      clear();
      swallowClick = true; setTimeout(() => { swallowClick = false; }, 400);
      fling(cur.sc, e.timeStamp - cur.t > 80 ? 0 : cur.v);
    } else if (!cur.el) clear();
    else if (cur.dragging) {
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

  const fling = (sc, v) => {
    let last = performance.now();
    const step = (now) => {
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
  const click = (e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } };

  const cancel = (e) => { if (g && e.pointerId === g.id) { g.el?.classList.remove('drag-source'); clear(); } };
  const context = (e) => {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-card]');
    if (el && root.contains(el)) { e.preventDefault(); clear(); h.onLongPress(el); }
  };
  // While dragging, stop the page from scrolling under the finger.
  const touchmove = (e) => { if (g?.dragging || g?.panning) e.preventDefault(); };

  // Stop the browser's own image drag, which would cancel the pointer gesture.
  const nodrag = (e) => e.preventDefault();
  root.addEventListener('dragstart', nodrag);
  root.addEventListener('pointerdown', down);
  root.addEventListener('click', click, true);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  root.addEventListener('contextmenu', context);
  window.addEventListener('touchmove', touchmove, { passive: false });
  return () => {
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
  // A dragged host carries its attachments, so they do not count either.
  const cards = [...t.querySelectorAll(':scope [data-card]')].filter((el) => el !== srcEl && el.closest('[data-drop]') === t &&
    !(srcEl.dataset.card && el.dataset.attachedTo === srcEl.dataset.card));
  let index = 0;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    if (r.left + r.width / 2 < x) index++;
  }
  const offset = parseInt(t.dataset.offset || '0', 10);
  return { zone, index: index + offset, onCard, tray: layout === 'tray' };
}
