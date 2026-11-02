// Card rendering: one card, a row of cards (overlapping when collapsed), and a pile.

import { html, useRef, useSize } from './h.js';
import { canSeeFace, zoneKind } from '../engine/view.js';
import { sizeFor, artUrl } from '../storage/db.js';

export const BACK_URL = 'assets/back.svg';
export const RATIO = 63 / 88; // card width / height

/**
 * Which image to show for a card, and whether its face is visible to this viewer.
 * `size` is 'small' | 'normal' | 'large', or a CSS height in px to choose one from.
 */
export function cardImage(ctx, card, zone, override = false, size = 'normal') {
  const visible = override || canSeeFace(ctx.state, card, zone, ctx.viewer);
  const art = ctx.art.get(card.defId);
  if (!visible) return { visible: false, url: BACK_URL };
  const s = typeof size === 'number' ? sizeFor(size) : size;
  if (card.face === 'back') return { visible: true, url: (art?.back && artUrl(art, 'back', s)) || BACK_URL, missing: !art };
  return { visible: true, url: artUrl(art, 'front', s), missing: !art };
}

function Badges({ card, zone, interactive }) {
  const c = card.counters;
  const items = [];
  if (c.plus) items.push(html`<span class="badge plus" data-badge=${interactive ? 'plus' : null} data-card-of=${card.id} data-zone=${zone}>+${c.plus}</span>`);
  if (c.minus) items.push(html`<span class="badge minus" data-badge=${interactive ? 'minus' : null} data-card-of=${card.id} data-zone=${zone}>−${c.minus}</span>`);
  for (const [k, v] of Object.entries(c.labeled)) {
    items.push(html`<span class="badge label" data-badge=${interactive ? 'label' : null} data-label=${k} data-card-of=${card.id} data-zone=${zone}>${k} ${v}</span>`);
  }
  if (!items.length) return null;
  return html`<div class="badges">${items}</div>`;
}

/**
 * One card. `h` is its height in px.
 * @param {{ ctx: any, card: any, zone: string, h: number, override?: boolean, style?: string, interactive?: boolean }} p
 */
export function Card({ ctx, card, zone, h, override, style = '', interactive = true }) {
  const img = cardImage(ctx, card, zone, override, h);
  const w = Math.round(h * RATIO);
  const tapped = card.tapped && (zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands');
  const boxW = tapped ? h : w;
  const markers = [];
  if (card.isToken) markers.push(html`<span class="mark token">T</span>`);
  if (card.faceDown) markers.push(html`<span class="mark fd" title="Face down">FD</span>`);
  if (card.revealed && zoneKind(zone) === 'hand') markers.push(html`<span class="mark rev" title="Revealed">R</span>`);
  if (card.face === 'back' && img.visible) markers.push(html`<span class="mark flip" title="Flipped">↻</span>`);
  return html`
    <div class="card ${tapped ? 'tapped' : ''} ${ctx.pointed === card.id ? 'pointed' : ''}" data-card=${card.id} data-zone=${zone}
         data-card-target=${card.id} style=${`width:${boxW}px;height:${h}px;${style}`}>
      <div class="card-inner" style=${`width:${w}px;height:${h}px`}>
        ${img.url
          ? html`<img class="card-face ${card.faceDown && img.visible ? 'dim' : ''}" src=${img.url} alt=${img.visible ? card.name : 'Card back'} draggable=${false}/>`
          : html`<div class="card-face missing"><span>${card.name}</span></div>`}
        ${img.visible && img.missing ? html`<div class="missing-name">${card.name}</div>` : null}
        <div class="marks">${markers}</div>
        <${Badges} card=${card} zone=${zone} interactive=${interactive}/>
      </div>
    </div>`;
}

/**
 * A horizontal row of cards in a slot. Overlaps cards when they do not fit, unless `open`.
 */
export function Row({ ctx, zone, ids, open, label, extraClass = '', layout = 'row', offset = 0, override = false, emptyText = '' }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const cardH = Math.max(28, h - 14);
  const cardW = cardH * RATIO;
  const widths = ids.map((id) => {
    const c = ctx.state.cards[id];
    const tapped = c?.tapped && (zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands');
    return tapped ? cardH : cardW;
  });
  const gap = 4;
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, ids.length - 1);
  const overflow = total > w - 8 && ids.length > 1;
  const collapsed = overflow && !open;
  let overlap = 0;
  if (collapsed) overlap = (total - (w - 8)) / (ids.length - 1);
  return html`
    <div ref=${ref} class="row ${collapsed ? 'collapsed' : ''} ${open && overflow ? 'open' : ''} ${extraClass}"
         data-drop=${zone} data-layout=${layout} data-offset=${offset} data-collapsed=${collapsed ? '1' : null} data-tap=${'slot'} data-slot=${zone}>
      ${label ? html`<span class="slot-label">${label}${ids.length ? html` <b>${ids.length}</b>` : ''}</span>` : null}
      ${ids.length === 0 && emptyText ? html`<span class="slot-empty">${emptyText}</span>` : null}
      <div class="row-cards" style=${`gap:${collapsed ? 0 : gap}px`}>
        ${h > 0 && ids.map((id, i) => {
          const card = ctx.state.cards[id];
          if (!card) return null;
          const style = collapsed && i > 0 ? `margin-left:${gap - overlap}px` : '';
          return html`<${Card} key=${id} ctx=${ctx} card=${card} zone=${zone} h=${cardH} style=${style} override=${override}/>`;
        })}
      </div>
    </div>`;
}

/** A pile: shows the top card (index 0) and a count. */
export function Pile({ ctx, zone, label, layout = 'pile', topOverride = false, extraClass = '' }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const ids = ctx.state.zones[zone] || [];
  const top = ids[0] ? ctx.state.cards[ids[0]] : null;
  const cardH = Math.max(28, Math.min(h - 18, (w - 6) / RATIO));
  return html`
    <div ref=${ref} class="pile ${extraClass}" data-drop=${zone} data-layout=${layout} data-tap="pile" data-slot=${zone}>
      <span class="slot-label">${label} <b>${ids.length}</b></span>
      ${top && h > 0
        ? html`<div class="pile-card"><${Card} ctx=${ctx} card=${top} zone=${zone} h=${cardH} override=${topOverride}/></div>`
        : html`<div class="pile-empty"></div>`}
      ${layout === 'library' ? html`<span class="drop-hint top">Top</span><span class="drop-hint bottom">Bottom</span>` : null}
    </div>`;
}
