// The 5×3 board grid, drawn from one player's perspective.

import { html } from './h.js';
import { Row, Pile } from './cards.js';
import { other, handCount } from '../engine/view.js';

/** Map of grid cells to zones for a perspective. */
export function cellsFor(P) {
  const O = other(P);
  return {
    oppExile: `${O}.exile`, oppLands: `${O}.lands`, oppGrave: `${O}.graveyard`,
    oppCmd: `${O}.command`, oppField: `${O}.battlefield`, oppLib: `${O}.library`,
    myCmd: `${P}.command`, myField: `${P}.battlefield`, myLib: `${P}.library`,
    myExile: `${P}.exile`, myLands: `${P}.lands`, myGrave: `${P}.graveyard`,
    myHand: `${P}.hand`,
  };
}

function Counters({ ctx }) {
  const st = ctx.state;
  const A = st.activePlayer;
  const line = (pl) => {
    const list = ctx.state.players[pl].counters;
    const life = list[0];
    const rest = list.slice(1);
    return html`<div class="ctr-line ${pl}">
      <span class="ctr-name">${ctx.state.players[pl].name}</span>
      <span class="ctr-life">♥ ${life.value}</span>
      ${rest.slice(0, 3).map((c) => html`<span class="ctr-small">${c.key} ${c.value}</span>`)}
      ${rest.length > 3 ? html`<span class="ctr-small">+${rest.length - 3}</span>` : null}
    </div>`;
  };
  // The player whose turn it is is listed first, under a "Turn N · name" label.
  return html`<div class="counters-cell" data-tap="counters">
    <span class="slot-label turn-label ${A}">Turn ${st.turn} · ${st.players[A].name}</span>
    ${line(A)}
    ${line(other(A))}
  </div>`;
}

/**
 * @param {{ ctx: any, P: 'p1' | 'p2', openSlots: string[] }} props
 */
export function Board({ ctx, P, openSlots }) {
  const z = cellsFor(P);
  const st = ctx.state;
  const name = (pl) => st.players[pl].name;
  const O = other(P);
  const topFace = (zone) => !!st.players[zone.split('.')[0]].libraryTopFaceUp;
  const row = (zone, label, cls = '') => html`<${Row} ctx=${ctx} zone=${zone} ids=${st.zones[zone]} open=${openSlots.includes(zone)} label=${label} extraClass=${cls}/>`;
  return html`
    <div class="board persp-${P} ${st.activePlayer === P ? 'my-turn' : 'their-turn'}">
      <div class="cell c11 opp">${html`<${Pile} ctx=${ctx} zone=${z.oppExile} label="Exile"/>`}</div>
      <div class="cell c12 opp">${row(z.oppLands, `${name(O)} · lands`)}<span class="opp-hand">${name(O)}: ${handCount(st, O)} in hand</span></div>
      <div class="cell c13 opp">${html`<${Pile} ctx=${ctx} zone=${z.oppGrave} label="Graveyard"/>`}</div>
      <div class="cell c21 opp">${html`<${Pile} ctx=${ctx} zone=${z.oppCmd} label="Command"/>`}</div>
      <div class="cell c22 opp">${row(z.oppField, `${name(O)} · battlefield`)}</div>
      <div class="cell c23 opp">${html`<${Pile} ctx=${ctx} zone=${z.oppLib} label="Library" layout="library" extraClass=${topFace(z.oppLib) ? 'top-up' : ''}/>`}</div>
      <div class="cell c31 me">${html`<${Pile} ctx=${ctx} zone=${z.myCmd} label="Command"/>`}</div>
      <div class="cell c32 me">${row(z.myField, `${name(P)} · battlefield`, 'field')}</div>
      <div class="cell c33 me">${html`<${Pile} ctx=${ctx} zone=${z.myLib} label="Library" layout="library" extraClass=${topFace(z.myLib) ? 'top-up' : ''}/>`}</div>
      <div class="cell c41 me">${html`<${Pile} ctx=${ctx} zone=${z.myExile} label="Exile"/>`}</div>
      <div class="cell c42 me">${row(z.myLands, `${name(P)} · lands`)}</div>
      <div class="cell c43 me">${html`<${Pile} ctx=${ctx} zone=${z.myGrave} label="Graveyard"/>`}</div>
      <div class="cell c51 me"><${Counters} ctx=${ctx}/></div>
      <div class="cell c52 me">${row(z.myHand, ctx.viewer === P ? `${name(P)}’s hand` : `${name(P)}’s hand (hidden)`, 'hand')}</div>
      <div class="cell c53 shared">${html`<${Pile} ctx=${ctx} zone="stack" label="Stack"/>`}</div>
    </div>`;
}
