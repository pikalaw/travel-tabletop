// Card rendering: one card, a row of cards (overlapping when collapsed), and a pile.

import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { useSize } from './hooks';
import { SwordsIcon, HourglassIcon } from './icons';
import { canSeeFace, zoneKind, ptText, heaps } from '../engine/view';
import { sizeFor, artUrl, type Art, type ImageSize } from '../storage/art';
import type { CardInstance, GameState, Viewer, ZoneId } from '../types/state';
import backSvg from '../assets/back.svg';

/** What every card on the board needs to draw itself. */
export interface BoardCtx {
  state: GameState;
  viewer: Viewer;
  art: Map<string, Art>;
  /** A card the other player is pointing at. */
  pointed: string | null;
  /** The blocker picked in combat mode. */
  selected: string | null | undefined;
  /** Cards in the highlighted combat matchup. */
  match: Set<string> | null;
  /** The library the library footer is acting on, outlined so it is clear whose it is. */
  library?: ZoneId | null;
}
export const BACK_URL: string = backSvg;
export const RATIO = 63 / 88; // card width / height

/**
 * Which image to show for a card, and whether its face is visible to this viewer.
 * `size` is 'small' | 'normal' | 'large', or a CSS height in px to choose one from.
 */
export function cardImage(ctx: BoardCtx, card: CardInstance, zone: ZoneId, override = false, size: ImageSize | number = 'normal'): { visible: boolean; url: string | null; missing?: boolean } {
  const visible = override || canSeeFace(ctx.state, card, zone, ctx.viewer);
  const art = ctx.art.get(card.defId);
  if (!visible)
    return {
      visible: false,
      url: BACK_URL,
    };
  const s = typeof size === 'number' ? sizeFor(size) : size;
  if (card.face === 'back')
    return {
      visible: true,
      url: (art?.back && artUrl(art, 'back', s)) || BACK_URL,
      missing: !art,
    };
  return {
    visible: true,
    url: artUrl(art, 'front', s),
    missing: !art,
  };
}
function Badges({ card, zone, interactive }: { card: CardInstance; zone: ZoneId; interactive: boolean }) {
  const c = card.counters;
  const items: JSX.Element[] = [];
  if (c.plus)
    items.push(
      <span class="badge plus" data-badge={interactive ? 'plus' : null} data-card-of={card.id} data-zone={zone}>
        +{c.plus}
      </span>,
    );
  if (c.minus)
    items.push(
      <span class="badge minus" data-badge={interactive ? 'minus' : null} data-card-of={card.id} data-zone={zone}>
        −{c.minus}
      </span>,
    );
  for (const [k, v] of Object.entries(c.labeled)) {
    items.push(
      <span class="badge label" data-badge={interactive ? 'label' : null} data-label={k} data-card-of={card.id} data-zone={zone}>
        {k} {v}
      </span>,
    );
  }
  // Not a counter: the change until end of turn, set in the full view (so it cannot be dragged off).
  if (card.turnPT) items.push(<span class="badge pt" title="Power and toughness change this turn">{ptText(card.turnPT)}</span>);
  if (!items.length) return null;
  return <div class="badges">{items}</div>;
}

/**
 * One card. `h` is its height in px.
 * @param {{ ctx: any, card: any, zone: string, h: number, override?: boolean, style?: string, interactive?: boolean }} p
 */
export interface CardProps {
  ctx: BoardCtx;
  card: CardInstance;
  zone: ZoneId;
  /** Height in px. */
  h: number;
  override?: boolean;
  style?: string;
  interactive?: boolean;
  tucked?: boolean;
  attachedN?: number;
  /** In a fanned group: the width of the gap to the previous card of the group, bridged by a gold bar. */
  linkLeft?: number;
  /** A heap of this many identical cards, drawn as this one (its first) with "×N"; 0 or 1 for a single card. */
  heapN?: number;
}

export function Card({ ctx, card, zone, h, override = false, style = '', interactive = true, tucked = false, attachedN = 0, linkLeft = 0, heapN = 0 }: CardProps) {
  const img = cardImage(ctx, card, zone, override, h);
  const w = Math.round(h * RATIO);
  const tapped = card.tapped && (zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands');
  const boxW = tapped ? h : w;
  // Changed this turn or last: a left border, green if the card entered play, yellow if it was
  // changed in play, for either player; last turn's are thinner. It sits on the card's frame, which never rotates, so a
  // tapped card shows it on its left too, spanning the turned picture's height.
  const inPlay = zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands';
  // A mark from the previous turn is drawn thinner, until the active player's first change clears it.
  const changed = inPlay && card.changed ? `${card.changed.entered ? 'entered' : 'changed'}${card.changed.turn < ctx.state.turn ? ' old' : ''}` : null;
  const markers: JSX.Element[] = [];
  if (card.isToken) markers.push(<span class="mark token">T</span>);
  // An expiring token: the icon of the button that removes it (End combat's swords, Pass turn's hourglass).
  if (card.expires)
    markers.push(
      <span class="mark expiry" title={`Expires at end of ${card.expires}`} aria-label={`expires end of ${card.expires}`}>
        {card.expires === 'combat' ? <SwordsIcon size={11} /> : <HourglassIcon size={11} />}
      </span>,
    );
  if (card.faceDown)
    markers.push(
      <span class="mark fd" title="Face down">
        FD
      </span>,
    );
  if (card.revealed && zoneKind(zone) === 'hand')
    markers.push(
      <span class="mark rev" title="Revealed">
        R
      </span>,
    );
  if (card.face === 'back' && img.visible)
    markers.push(
      <span class="mark flip" title="Flipped">
        ↻
      </span>,
    );
  // Combat marks: ⚔n on an attacker, 🛡n on a blocker for each attacker it blocks. Like counters,
  // they can be dragged off the card to remove them.
  const drag = interactive ? (kind: string) => kind : () => undefined;
  if (card.attacking)
    markers.unshift(
      <span class="mark atk" title="Attacking" data-badge={drag('attack')} data-card-of={card.id} data-zone={zone}>
        ⚔{card.attacking}
      </span>,
    );
  for (const a of [...(card.blocking || [])].reverse()) {
    const n = ctx.state.cards[a]?.attacking;
    if (n)
      markers.unshift(
        <span class="mark blk" title="Blocking" data-badge={drag('block')} data-attacker={a} data-card-of={card.id} data-zone={zone}>
          🛡{n}
        </span>,
      );
  }
  // Top-left stays visible when the next card overlaps this one in a crowded row.
  if (attachedN)
    markers.unshift(
      <span class="mark att-count" title={`${attachedN} attached`}>
        +{attachedN}
      </span>,
    );
  return (
    <div
      class={`card ${tapped ? 'tapped' : ''} ${heapN > 1 ? 'heap' : ''} ${tucked ? 'tucked' : ''} ${ctx.pointed === card.id ? 'pointed' : ''} ${ctx.selected === card.id ? 'selected' : ''} ${ctx.match?.has(card.id) ? 'in-match' : ''}`}
      data-card={card.id}
      data-zone={zone}
      data-card-target={card.id}
      data-attached-to={card.attachedTo || null}
      data-drag-text={card.ability?.text || null}
      style={`width:${boxW}px;height:${h}px;${style}`}
    >
      {linkLeft ? <span class="link-bar" aria-hidden="true" style={`left:${-linkLeft - 8}px;width:${linkLeft + 16}px`} /> : null}
      {changed ? (
        <span
          class={`changed-bar ${changed}`}
          aria-hidden="true"
          style={tapped ? `top:${Math.round((h - w) / 2)}px;height:${w}px` : ''}
        />
      ) : null}
      <div class="card-inner" style={`width:${w}px;height:${h}px`}>
        {heapN > 1 ? <span class="heap-edges" aria-hidden="true" /> : null}
        {img.url ? (
          <img
            class={`card-face ${card.faceDown && img.visible ? 'dim' : ''}`}
            src={img.url}
            alt={img.visible ? card.name : 'Card back'}
            draggable={false}
          />
        ) : (
          <div class="card-face missing">
            <span>{card.name}</span>
          </div>
        )}
        {img.visible && img.missing ? <div class="missing-name">{card.name}</div> : null}
        {card.ability ? (
          <div class="ability-band" title={card.ability.text}>
            <b>Ability</b> {card.ability.text}
          </div>
        ) : null}
        {tucked ? null : <Badges card={card} zone={zone} interactive={interactive} />}
      </div>
      <div class="marks" style={tapped ? `top:${Math.round((h - w) / 2) + 2}px` : ''}>
        {markers}
      </div>
      {/* Top right, where a real card has its mana cost (tokens have none); outside the rotated picture. */}
      {heapN > 1 ? (
        <span class="heap-count" key={heapN} title={`${heapN} identical cards`} style={tapped ? `top:${Math.round((h - w) / 2) + 2}px` : ''}>
          ×{heapN}
        </span>
      ) : null}
    </div>
  );
}

/** How much of an attached card shows from behind the card it is attached to. */
export const PEEK = 0.25;

/**
 * A horizontal row of cards in a slot. Overlaps cards when they do not fit, unless `open`.
 * Attached cards come just before their host in the zone and are drawn tucked behind it,
 * peeking out to its left; an open slot fans each group out instead.
 */
export interface RowProps {
  ctx: BoardCtx;
  zone: ZoneId;
  ids: readonly string[];
  open: boolean;
  label?: ComponentChildren;
  extraClass?: string;
  layout?: 'row' | 'tray';
  offset?: number;
  override?: boolean;
  emptyText?: string;
}

export function Row({ ctx, zone, ids, open, label, extraClass = '', layout = 'row', offset = 0, override = false, emptyText = '' }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const cardH = Math.max(28, h - 14);
  const cardW = cardH * RATIO;
  const field = zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands';
  // Identical cards in play are drawn as one heap, by its first card (see `heaps`).
  const heap = field ? heaps(ctx.state, ids) : null;
  const cards = (heap ? heap.shown : ids).map((id) => ctx.state.cards[id]).filter((c): c is CardInstance => !!c);
  const widths = cards.map((c) => (c.tapped && field ? cardH : cardW));
  const groupOf = (c: CardInstance) => (field && c.attachedTo) || c.id;
  const hasGroups = field && cards.some((c) => c.attachedTo);
  const sameGroup = (i: number) => i > 0 && groupOf(cards[i]!) === groupOf(cards[i - 1]!);
  const gap = 4,
    innerGap = 10,
    groupGap = 14;
  const fanned = open && hasGroups;
  const units = cards.filter((c, i) => !sameGroup(i)).length;
  // Width of the row before any collapsing: tucked attachments show PEEK of their width.
  let natural = 0;
  cards.forEach((c, i) => {
    if (sameGroup(i)) natural += fanned ? innerGap + widths[i]! : widths[i]! - widths[i - 1]! * (1 - PEEK);
    else natural += (i ? (fanned ? groupGap : gap) : 0) + widths[i]!;
  });
  const overflow = natural > w - 8 && units > 1;
  const collapsed = overflow && !open;
  const overlap = collapsed ? (natural - (w - 8) + gap * (units - 1)) / (units - 1) : 0;
  const scrolls = open && (overflow || natural > w - 8);
  const attachedN = new Map<string, number>();
  if (field) for (const c of cards) if (c.attachedTo) attachedN.set(c.attachedTo, (attachedN.get(c.attachedTo) || 0) + 1);
  useSlideIn(ref, w, h, heap);
  // The label and the open-slot outline sit outside the scroller so they stay put while it scrolls.
  return (
    <div class={`row-box ${scrolls || fanned ? 'open' : ''}`}>
      {label ? (
        <span class="slot-label">
          <span class="slot-name">{label}</span>
          {ids.length ? <b>{ids.length}</b> : null}
        </span>
      ) : null}
      <div
        ref={ref}
        class={`row ${collapsed ? 'collapsed' : ''} ${collapsed || (hasGroups && !open) ? 'can-open' : ''} ${scrolls ? 'open' : ''} ${extraClass}`}
        data-drop={zone}
        data-layout={layout}
        data-offset={offset}
        data-collapsed={collapsed ? '1' : null}
        data-groups={hasGroups ? '1' : null}
        data-fanned={fanned ? '1' : null}
        data-tap={'slot'}
        data-slot={zone}
      >
        {ids.length === 0 && emptyText ? <span class="slot-empty">{emptyText}</span> : null}
        <div class="row-cards">
          {h > 0 &&
            cards.map((card, i) => {
              let ml = 0;
              if (sameGroup(i)) ml = fanned ? innerGap : -widths[i - 1]! * (1 - PEEK);
              else if (i > 0) ml = fanned ? groupGap : collapsed ? gap - overlap : gap;
              const tucked = field && !fanned && !!card.attachedTo;
              return (
                <Card
                  key={card.id}
                  ctx={ctx}
                  card={card}
                  zone={zone}
                  h={cardH}
                  style={ml ? `margin-left:${ml}px` : ''}
                  override={override}
                  tucked={tucked}
                  attachedN={fanned ? 0 : attachedN.get(card.id) || 0}
                  linkLeft={fanned && sameGroup(i) ? innerGap : 0}
                  heapN={heap?.members.get(card.id)?.length ?? 0}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}

/** How long a card takes to slide to its new place in a row (it turns, if tapped, over the same time). */
const SLIDE_MS = 180;

/**
 * Cards that move within a row slide to their new place instead of jumping (FLIP: note where each
 * card was drawn, and after the next render start it there and let it glide back to none). A card
 * that comes out of a heap starts where its heap was drawn, so a tap on a heap shows which card
 * left it. Only changes to the cards move anything: a resize just redraws.
 */
function useSlideIn(ref: { current: HTMLDivElement | null }, w: number, h: number, heap: ReturnType<typeof heaps> | null) {
  const last = useRef<{ rects: Map<string, DOMRect>; heapOf: Map<string, string>; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const rects = new Map<string, DOMRect>();
    for (const el of row.querySelectorAll<HTMLElement>('.row-cards > .card')) rects.set(el.dataset.card!, el.getBoundingClientRect());
    const heapOf = new Map<string, string>();
    if (heap) for (const [first, m] of heap.members) for (const id of m) heapOf.set(id, first);
    const prev = last.current;
    last.current = { rects, heapOf, w, h };
    if (!prev || prev.w !== w || prev.h !== h) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of row.querySelectorAll<HTMLElement>('.row-cards > .card')) {
      const id = el.dataset.card!, now = rects.get(id)!;
      // Where it was drawn: itself, or the heap it was in (drawn by that heap's first card).
      const was = prev.rects.get(id) ?? prev.rects.get(prev.heapOf.get(id) ?? '');
      if (!was) continue;
      const dx = was.left - now.left, dy = was.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'ease' });
    }
  });
}

/** A pile: shows the top card (index 0) and a count. */
export interface PileProps {
  ctx: BoardCtx;
  zone: ZoneId;
  label: string;
  /**
   * Draw every card, stacked under the top one (the stack: the full view steps through it, and
   * dragging any item up from there hands the board's element for it to a drag).
   */
  all?: boolean;
  layout?: 'pile' | 'library';
  topOverride?: boolean;
  }

export function Pile({ ctx, zone, label, layout = 'pile', topOverride = false, all = false }: PileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const ids = ctx.state.zones[zone] || [];
  const top = ids[0] ? ctx.state.cards[ids[0]] : null;
  // Never taller than the space under the label, so a short cell (a phone held sideways) shrinks the card rather than cutting it off.
  const cardH = Math.min(h, Math.max(28, Math.min(h - 18, (w - 6) / RATIO)));
  return (
    <div ref={ref} class={`pile ${ctx.library === zone ? 'picked' : ''}`} data-drop={zone} data-layout={layout} data-tap="pile" data-slot={zone}>
      <span class="slot-label">
        <span class="slot-name">{label}</span>
        <b>{ids.length}</b>
      </span>
      {h > 0 ? (
        <div class="pile-card" style={`--card-h:${cardH}px`}>
          {top ? <Card ctx={ctx} card={top} zone={zone} h={cardH} override={topOverride} style={all ? `z-index:${ids.length}` : ''} /> : <div class="pile-empty" style={`width:${cardH * RATIO}px;height:${cardH}px`} />}
          {all
            ? ids.slice(1).map((id, i) => {
                const c = ctx.state.cards[id];
                return c ? <Card key={id} ctx={ctx} card={c} zone={zone} h={cardH} style={`position:absolute;left:0;top:0;z-index:${ids.length - 1 - i}`} /> : null;
              })
            : null}
        </div>
      ) : null}
      {layout === 'library' ? (
        <>
          <span class="drop-hint top">Top</span>
          <span class="drop-hint bottom">Bottom</span>
        </>
      ) : null}
    </div>
  );
}
