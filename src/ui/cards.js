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
export function Card({ ctx, card, zone, h, override, style = '', interactive = true, tucked = false, attachedN = 0 }) {
  const img = cardImage(ctx, card, zone, override, h);
  const w = Math.round(h * RATIO);
  const tapped = card.tapped && (zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands');
  const boxW = tapped ? h : w;
  const markers = [];
  if (card.isToken) markers.push(html`<span class="mark token">T</span>`);
  if (card.faceDown) markers.push(html`<span class="mark fd" title="Face down">FD</span>`);
  if (card.revealed && zoneKind(zone) === 'hand') markers.push(html`<span class="mark rev" title="Revealed">R</span>`);
  if (card.face === 'back' && img.visible) markers.push(html`<span class="mark flip" title="Flipped">↻</span>`);
  // Combat marks: ⚔n on an attacker, 🛡n on a blocker for each attacker it blocks. Like counters,
  // they can be dragged off the card to remove them.
  const drag = interactive ? (kind) => kind : () => null;
  if (card.attacking) markers.unshift(html`<span class="mark atk" title="Attacking" data-badge=${drag('attack')} data-card-of=${card.id} data-zone=${zone}>⚔${card.attacking}</span>`);
  for (const a of [...(card.blocking || [])].reverse()) {
    const n = ctx.state.cards[a]?.attacking;
    if (n) markers.unshift(html`<span class="mark blk" title="Blocking" data-badge=${drag('block')} data-attacker=${a} data-card-of=${card.id} data-zone=${zone}>🛡${n}</span>`);
  }
  // Top-left stays visible when the next card overlaps this one in a crowded row.
  if (attachedN) markers.unshift(html`<span class="mark att-count" title="${attachedN} attached">+${attachedN}</span>`);
  return html`
    <div class="card ${tapped ? 'tapped' : ''} ${tucked ? 'tucked' : ''} ${ctx.pointed === card.id ? 'pointed' : ''} ${ctx.selected === card.id ? 'selected' : ''}" data-card=${card.id} data-zone=${zone}
         data-card-target=${card.id} data-attached-to=${card.attachedTo || null} style=${`width:${boxW}px;height:${h}px;${style}`}>
      <div class="card-inner" style=${`width:${w}px;height:${h}px`}>
        ${img.url
          ? html`<img class="card-face ${card.faceDown && img.visible ? 'dim' : ''}" src=${img.url} alt=${img.visible ? card.name : 'Card back'} draggable=${false}/>`
          : html`<div class="card-face missing"><span>${card.name}</span></div>`}
        ${img.visible && img.missing ? html`<div class="missing-name">${card.name}</div>` : null}
        ${tucked ? null : html`<${Badges} card=${card} zone=${zone} interactive=${interactive}/>`}
      </div>
      <div class="marks" style=${tapped ? `top:${Math.round((h - w) / 2) + 2}px` : ''}>${markers}</div>
    </div>`;
}

/** How much of an attached card shows from behind the card it is attached to. */
export const PEEK = 0.25;

/**
 * A horizontal row of cards in a slot. Overlaps cards when they do not fit, unless `open`.
 * Attached cards come just before their host in the zone and are drawn tucked behind it,
 * peeking out to its left; an open slot fans each group out instead.
 */
export function Row({ ctx, zone, ids, open, label, extraClass = '', layout = 'row', offset = 0, override = false, emptyText = '' }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const cardH = Math.max(28, h - 14);
  const cardW = cardH * RATIO;
  const cards = ids.map((id) => ctx.state.cards[id]).filter(Boolean);
  const field = zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands';
  const widths = cards.map((c) => (c.tapped && field ? cardH : cardW));
  const groupOf = (c) => (field && c.attachedTo) || c.id;
  const hasGroups = field && cards.some((c) => c.attachedTo);
  const sameGroup = (i) => i > 0 && groupOf(cards[i]) === groupOf(cards[i - 1]);
  const gap = 4, innerGap = 3, groupGap = 14;
  const fanned = open && hasGroups;
  const units = cards.filter((c, i) => !sameGroup(i)).length;
  // Width of the row before any collapsing: tucked attachments show PEEK of their width.
  let natural = 0;
  cards.forEach((c, i) => {
    if (sameGroup(i)) natural += fanned ? innerGap + widths[i] : widths[i] - widths[i - 1] * (1 - PEEK);
    else natural += (i ? (fanned ? groupGap : gap) : 0) + widths[i];
  });
  const overflow = natural > w - 8 && units > 1;
  const collapsed = overflow && !open;
  const overlap = collapsed ? (natural - (w - 8) + gap * (units - 1)) / (units - 1) : 0;
  const scrolls = open && (overflow || natural > w - 8);
  const attachedN = new Map();
  if (field) for (const c of cards) if (c.attachedTo) attachedN.set(c.attachedTo, (attachedN.get(c.attachedTo) || 0) + 1);
  // The label and the open-slot outline sit outside the scroller so they stay put while it scrolls.
  return html`<div class="row-box ${scrolls || fanned ? 'open' : ''}">
    ${label ? html`<span class="slot-label">${label}${ids.length ? html` <b>${ids.length}</b>` : ''}</span>` : null}
    <div ref=${ref} class="row ${collapsed ? 'collapsed' : ''} ${scrolls ? 'open' : ''} ${extraClass}"
         data-drop=${zone} data-layout=${layout} data-offset=${offset} data-collapsed=${collapsed ? '1' : null}
         data-groups=${hasGroups ? '1' : null} data-fanned=${fanned ? '1' : null} data-tap=${'slot'} data-slot=${zone}>
      ${ids.length === 0 && emptyText ? html`<span class="slot-empty">${emptyText}</span>` : null}
      <div class="row-cards">
        ${h > 0 && cards.map((card, i) => {
          let ml = 0;
          if (sameGroup(i)) ml = fanned ? innerGap : -widths[i - 1] * (1 - PEEK);
          else if (i > 0) ml = fanned ? groupGap : collapsed ? gap - overlap : gap;
          const tucked = field && !fanned && !!card.attachedTo;
          return html`<${Card} key=${card.id} ctx=${ctx} card=${card} zone=${zone} h=${cardH} style=${ml ? `margin-left:${ml}px` : ''}
            override=${override} tucked=${tucked} attachedN=${fanned ? 0 : attachedN.get(card.id) || 0}/>`;
        })}
      </div>
    </div></div>`;
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
