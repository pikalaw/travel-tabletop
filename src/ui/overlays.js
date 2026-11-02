// Overlays on the game screen: card viewer sheets, full-screen card, counters, log, tokens,
// dice, menu.

import { html, useState, useRef } from './h.js';
import { Row, cardImage, BACK_URL } from './cards.js';
import { zoneKind, zoneOwner, other, canSeeFace } from '../engine/view.js';
import { artUrl, sizeFor } from '../storage/db.js';

const ZONE_TITLE = { library: 'Library', hand: 'Hand', battlefield: 'Battlefield', lands: 'Lands', graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone', stack: 'Stack' };

export function zoneTitle(state, zone) {
  const owner = zoneOwner(zone);
  const k = ZONE_TITLE[zoneKind(zone)] || zone;
  return owner ? `${state.players[owner].name} · ${k}` : k;
}

/** A panel over the opponent's half of the board. */
export function Sheet({ title, onClose, children, actions, tall = false }) {
  return html`<div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-label=${title}>
    <div class="sheet-head">
      <span class="sheet-title">${title}</span>
      <span class="sheet-actions">${actions}</span>
      <button class="btn ghost" onClick=${onClose}>Done</button>
    </div>
    <div class="sheet-body">${children}</div>
  </div>`;
}

/** Zone viewer, peek tray, search and reveal. */
export function CardSheet({ ctx, sheet, onClose, onRandom }) {
  const st = ctx.state;
  const zone = sheet.zone;
  const lib = st.zones[zone] || [];
  let ids, layout = 'row', override = false, title = zoneTitle(st, zone), hint = '';
  if (sheet.kind === 'peek') {
    ids = lib.filter((id) => sheet.ids.includes(id));
    layout = 'tray'; override = true;
    title = `Top ${sheet.ids.length} of ${zoneTitle(st, zone)} (only you see these)`;
    hint = 'Drag cards anywhere. Drop back here to reorder; drop on the library pile for top or bottom.';
  } else if (sheet.kind === 'search') {
    ids = lib; layout = 'tray'; override = true;
    title = `Searching ${zoneTitle(st, zone)}`;
    hint = 'Take what you need. Done shuffles the library.';
  } else if (sheet.kind === 'inspect') {
    ids = lib; layout = 'tray'; override = true;
    title = `Looking at ${zoneTitle(st, zone)}`;
  } else if (sheet.kind === 'reveal') {
    ids = lib.filter((id) => sheet.ids.includes(id));
    layout = 'tray'; override = true;
    title = `Revealed: top of ${zoneTitle(st, zone)}`;
  } else {
    ids = lib;
  }
  const trayDrop = layout === 'tray' ? 'tray' : 'row';
  return html`<${Sheet} title=${title} onClose=${onClose} tall
      actions=${ids.length > 1 && sheet.kind === 'zone' ? html`<button class="btn ghost" onClick=${() => onRandom(zone)}>Random card</button>` : null}>
    ${hint ? html`<div class="sheet-hint">${hint}</div>` : null}
    <div class="sheet-row">
      <${Row} ctx=${ctx} zone=${zone} ids=${ids} open=${true} layout=${trayDrop} override=${override} emptyText="Empty"/>
    </div>
  </${Sheet}>`;
}

/** Full-screen view of one card. */
export function FullCard({ ctx, cardId, zone, group = null, onPick = (id) => {}, onCounter = null }) {
  const swipe = useRef(null);
  const card = ctx.state.cards[cardId];
  if (!card) return null;
  const img = cardImage(ctx, card, zone, card.faceDown && ctx.viewer === card.owner, 'large');
  const c = card.counters;
  const art = ctx.art.get(card.defId);
  const at = group ? group.indexOf(cardId) : -1;
  const host = card.attachedTo ? ctx.state.cards[card.attachedTo] : null;
  const nameOf = (x) => (canSeeFace(ctx.state, x, zone, ctx.viewer) || (x.faceDown && ctx.viewer === x.owner) ? x.name : 'a hidden card');
  // Swipe sideways on the card to move through its group.
  const down = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const s0 = swipe.current; swipe.current = null;
    if (!group || !s0 || e.target.closest('[data-badge]')) return;
    const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    const next = at + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < group.length) onPick(group[next]);
  };
  return html`<div class="fullcard ${group ? 'grouped' : ''}">
    <div class="fullcard-inner" data-card-target=${card.id} data-zone=${zone} onPointerDown=${down} onPointerUp=${up}>
      ${img.url ? html`<img src=${img.url} alt=${card.name} draggable=${false}/>` : html`<div class="card-face missing big"><span>${card.name}</span></div>`}
      <div class="full-badges">
        ${[
          c.plus ? { kind: 'plus', text: `+1/+1 × ${c.plus}` } : null,
          c.minus ? { kind: 'minus', text: `−1/−1 × ${c.minus}` } : null,
          ...Object.entries(c.labeled).map(([k, v]) => ({ kind: 'label', label: k, text: `${k} ${v}` })),
        ].filter(Boolean).map((b) => html`<span class="ctr-group">
          ${onCounter ? html`<button class="btn round ctr-step" aria-label="Remove one" onClick=${() => onCounter('removeCounter', b.kind, b.label)}>−</button>` : null}
          <span class="badge ${b.kind} big" data-badge=${b.kind} data-label=${b.label} data-card-of=${card.id} data-zone=${zone}>${b.text}</span>
          ${onCounter ? html`<button class="btn round ctr-step" aria-label="Add one" onClick=${() => onCounter('addCounter', b.kind, b.label)}>+</button>` : null}
        </span>`)}
      </div>
    </div>
    <div class="fullcard-meta">
      <b>${img.visible ? card.name : 'Hidden card'}</b>
      <span>${zoneTitle(ctx.state, zone)}${card.tapped ? ' · tapped' : ''}${card.faceDown ? ' · face down' : ''}${card.revealed ? ' · revealed' : ''}${card.face === 'back' ? ' · back face' : ''}${card.isToken ? ' · token' : ''}${art?.back ? ' · double-faced' : ''}</span>
      ${host ? html`<span>Attached to ${nameOf(host)}</span>` : null}
      ${group && !host ? html`<span>${group.length - 1} attached</span>` : null}
      ${group ? html`<div class="full-thumbs">
        ${group.map((id, i) => {
          const x = ctx.state.cards[id];
          const t = cardImage(ctx, x, zone, x.faceDown && ctx.viewer === x.owner, 'small');
          const sum = x.counters.plus + x.counters.minus + Object.values(x.counters.labeled).reduce((a, b) => a + b, 0);
          return html`<button class="thumb ${id === cardId ? 'on' : ''}" onClick=${() => onPick(id)} aria-label=${i === 0 ? 'Host card' : `Attached card ${i}`}>
            <img src=${t.url} alt="" draggable=${false}/>${sum ? html`<span class="thumb-ctr">${sum}</span>` : null}
          </button>`;
        })}
      </div>
      <span class="hint">Swipe the card or tap a thumbnail to see the rest of the group.</span>` : null}
      <span class="hint">Drag counters from the bar onto the card. Use − and + on a counter, or drag it away, to change it.</span>
    </div>
  </div>`;
}

/** Player counters, both players. */
export function CountersSheet({ ctx, P, send, onClose }) {
  const st = ctx.state;
  const [adding, setAdding] = useState({ p1: '', p2: '' });
  const set = (pl, key, value) => send('setPlayerCounter', { player: pl, key, value });
  const list = (pl) => html`<div class="ctr-panel ${pl}">
    <h3>${st.players[pl].name}</h3>
    ${st.players[pl].counters.map((c) => html`<div class="ctr-row">
      <span class="ctr-key">${c.key === 'life' ? 'Life' : c.key}</span>
      <button class="btn round" onClick=${() => set(pl, c.key, c.value - 1)}>−</button>
      <button class="ctr-val" onClick=${() => { const v = window.prompt(`${st.players[pl].name}: ${c.key}`, String(c.value)); if (v != null && v.trim() !== '' && Number.isFinite(Number(v))) set(pl, c.key, Number(v)); }}>${c.value}</button>
      <button class="btn round" onClick=${() => set(pl, c.key, c.value + 1)}>+</button>
      ${c.key === 'life'
        ? html`<span class="ctr-x"></span>`
        : html`<button class="btn ghost ctr-x" title="Remove" onClick=${() => send('removePlayerCounter', { player: pl, key: c.key })}>×</button>`}
    </div>`)}
    <form class="ctr-add" onSubmit=${(e) => { e.preventDefault(); const k = adding[pl].trim(); if (k) { send('addPlayerCounter', { player: pl, key: k, value: 0 }); setAdding({ ...adding, [pl]: '' }); } }}>
      <input placeholder="New counter (poison, energy…)" value=${adding[pl]} onInput=${(e) => setAdding({ ...adding, [pl]: e.currentTarget.value })}/>
      <button class="btn" type="submit">Add</button>
    </form>
  </div>`;
  return html`<${Sheet} title="Player counters" onClose=${onClose} tall>
    <div class="ctr-panels">${list(other(P))}${list(P)}</div>
  </${Sheet}>`;
}

export function LogSheet({ lines, onClose, onExport }) {
  return html`<${Sheet} title="Recent actions" onClose=${onClose} tall actions=${html`<button class="btn ghost" onClick=${onExport}>Export log</button>`}>
    <ol class="log-list" reversed>
      ${[...lines].reverse().map((l) => html`<li class=${l.alert ? 'alert' : ''}><span class="ts">${l.time}</span> ${l.text}</li>`)}
    </ol>
  </${Sheet}>`;
}

export function TokensSheet({ ctx, tokenDecks, onClose }) {
  // Token decks made for the decks in this game come first.
  const inPlay = new Set(Object.values(ctx.state.cards).map((c) => c.deckId).filter(Boolean));
  const forGame = (d) => (d.forDecks || []).some((id) => inPlay.has(id));
  const sorted = [...tokenDecks].sort((a, b) => Number(forGame(b)) - Number(forGame(a)));
  return html`<${Sheet} title="Tokens · drag onto a battlefield, or tap to add to yours" onClose=${onClose} tall>
    ${tokenDecks.length === 0 ? html`<p>No token decks. Import one under Decks.</p>` : null}
    ${sorted.map((d) => html`<div class="token-deck">
      <div class="token-deck-name">${d.name}${forGame(d) ? html` <span class="for-game">· for this game</span>` : ''}</div>
      <div class="token-grid">
        ${[...new Set(d.cards)].map((defId) => {
          const art = ctx.art.get(defId);
          return html`<div class="token-item" data-token-def=${defId} data-token-name=${art?.name || 'Token'}>
            ${art?.front ? html`<img src=${artUrl(art, 'front', sizeFor(110))} alt=${art.name} draggable=${false}/>` : html`<div class="card-face missing"><span>${art?.name || defId}</span></div>`}
          </div>`;
        })}
      </div>
    </div>`)}
  </${Sheet}>`;
}

export function DiceSheet({ ctx, P, send, onClose }) {
  const st = ctx.state;
  const [sides, setSides] = useState(100);
  const die = (n) => send('rollDie', { sides: n });
  const zones = [`${P}.hand`, `${other(P)}.hand`, `${P}.graveyard`, `${P}.battlefield`, `${other(P)}.battlefield`];
  return html`<${Sheet} title="Dice and random" onClose=${onClose}>
    <div class="dice">
      <button class="btn" onClick=${() => send('coinFlip', {})}>Flip a coin</button>
      ${[4, 6, 8, 10, 12, 20].map((n) => html`<button class="btn" onClick=${() => die(n)}>d${n}</button>`)}
      <span class="dN"><button class="btn" onClick=${() => die(sides)}>d${sides}</button>
        <input type="number" min="2" max="1000" value=${sides} onInput=${(e) => setSides(parseInt(e.currentTarget.value, 10) || 2)}/></span>
    </div>
    <div class="dice">
      <span class="muted">Random card from:</span>
      ${zones.map((z) => html`<button class="btn ghost" disabled=${!st.zones[z].length} onClick=${() => send('randomPick', { zone: z })}>${zoneTitle(st, z)}</button>`)}
    </div>
  </${Sheet}>`;
}

export function MenuSheet({ items, onClose }) {
  return html`<${Sheet} title="Game menu" onClose=${onClose}>
    <div class="menu-items">
      ${items.filter(Boolean).map((it) => html`<button class="btn ${it.danger ? 'danger' : ''}" onClick=${it.onClick}>${it.label}</button>`)}
    </div>
  </${Sheet}>`;
}

export function AwaySheet({ name, lines, onClose }) {
  return html`<${Sheet} title=${`While ${name} was away`} onClose=${onClose}>
    <ul class="log-list">${lines.map((l) => html`<li class="alert">${l}</li>`)}</ul>
  </${Sheet}>`;
}

export { BACK_URL };
