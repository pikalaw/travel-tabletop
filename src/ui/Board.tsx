// The board grid, drawn from one player's perspective. Each battlefield spans three bands, so the
// side columns can stack two boxes beside it: Command and stats on the left, the library and half of
// the stack (which straddles the centre line, shared) on the right. Cells are named by what they hold.

import type { ComponentChildren } from 'preact';
import { Row, Pile, type BoardCtx } from './Cards';
import { other, handCount } from '../engine/view';
import type { PlayerId, ZoneId } from '../types/state';

/** Map of grid cells to zones for a perspective. */
export function cellsFor(P: PlayerId) {
  const O = other(P);
  return {
    oppExile: `${O}.exile`,
    oppLands: `${O}.lands`,
    oppGrave: `${O}.graveyard`,
    oppCmd: `${O}.command`,
    oppField: `${O}.battlefield`,
    oppLib: `${O}.library`,
    myCmd: `${P}.command`,
    myField: `${P}.battlefield`,
    myLib: `${P}.library`,
    myExile: `${P}.exile`,
    myLands: `${P}.lands`,
    myGrave: `${P}.graveyard`,
    myHand: `${P}.hand`,
  } as const satisfies Record<string, ZoneId>;
}
/**
 * One player's stats, beside their battlefield: name (in the turn colour), "Turn N" for the player
 * whose turn it is, life, then any other counters. A tap opens Player counters.
 */
function Stats({ ctx, pl }: { ctx: BoardCtx; pl: PlayerId }) {
  const st = ctx.state;
  const active = st.activePlayer === pl;
  const [life, ...rest] = st.players[pl].counters;
  return (
    <div class={`counters-cell ${active ? 'role-atk' : 'role-def'}`} data-tap="counters">
      {active ? <span class="turn-label">Turn {st.turn}</span> : null}
      <span class="ctr-name">{st.players[pl].name}</span>
      <span class="ctr-life">♥ {life!.value}</span>
      {rest.map((c) => <span class="ctr-small">{c.key} {c.value}</span>)}
    </div>
  );
}

/**
 * @param {{ ctx: any, P: 'p1' | 'p2', openSlots: string[] }} props
 */
export function Board({ ctx, P, openSlots }: { ctx: BoardCtx; P: PlayerId; openSlots: readonly string[] }) {
  const z = cellsFor(P);
  const st = ctx.state;
  const name = (pl: PlayerId) => st.players[pl].name;
  // A player's name in the attacker (hot) or defender (cool) colour.
  const who = (pl: PlayerId) => <span class={st.activePlayer === pl ? 'role-atk' : 'role-def'}>{name(pl)}</span>;
  const O = other(P);
  const row = (zone: ZoneId, label: ComponentChildren, cls = '') => (
    <Row ctx={ctx} zone={zone} ids={st.zones[zone]} open={openSlots.includes(zone)} label={label} extraClass={cls} />
  );
  const hidden = ctx.viewer === 'nobody'; // one device, blinded: the hand row folds away
  return (
    <div class={`board persp-${P} ${st.activePlayer === P ? 'my-turn' : 'their-turn'} ${ctx.match?.size ? 'matching' : ''} ${hidden ? 'hand-hidden' : ''}`}>
      <div class="cell opp opp-exile">{<Pile ctx={ctx} zone={z.oppExile} label="Exile" />}</div>
      <div class="cell opp opp-lands">
        {row(z.oppLands, <>{who(O)} · lands</>)}
        <HandLabel zone={`${O}.hand`} who={who(O)} name={name(O)} n={handCount(st, O)} />
      </div>
      <div class="cell opp opp-grave">{<Pile ctx={ctx} zone={z.oppGrave} label="Graveyard" />}</div>
      <div class="cell opp opp-cmd">{<Pile ctx={ctx} zone={z.oppCmd} label="Command" />}</div>
      <div class="cell opp opp-stats"><Stats ctx={ctx} pl={O} /></div>
      <div class="cell opp opp-field">{row(z.oppField, <>{who(O)} · battlefield</>)}</div>
      <div class="cell opp opp-lib">{<Pile ctx={ctx} zone={z.oppLib} label="Library" layout="library" />}</div>
      <div class="cell shared stack-cell">{<Pile ctx={ctx} zone="stack" label="Stack" all />}</div>
      <div class="cell me my-stats"><Stats ctx={ctx} pl={P} /></div>
      <div class="cell me my-cmd">{<Pile ctx={ctx} zone={z.myCmd} label="Command" />}</div>
      <div class="cell me my-field">{row(z.myField, <>{who(P)} · battlefield</>, 'field')}</div>
      <div class="cell me my-lib">{<Pile ctx={ctx} zone={z.myLib} label="Library" layout="library" />}</div>
      <div class="cell me my-exile">{<Pile ctx={ctx} zone={z.myExile} label="Exile" />}</div>
      <div class="cell me my-lands">
        {row(z.myLands, <>{who(P)} · lands</>)}
        {/* While blinded the hand row is folded away; this label still takes drops into the hand. */}
        {hidden ? <HandLabel zone={z.myHand} who={who(P)} name={name(P)} n={handCount(st, P)} /> : null}
      </div>
      <div class="cell me my-grave">{<Pile ctx={ctx} zone={z.myGrave} label="Graveyard" />}</div>
      <div class="cell me my-hand">
        {row(z.myHand, <>{who(P)}’s hand{ctx.viewer === P ? '' : ' (hidden)'}</>, 'hand')}
      </div>
    </div>
  );
}

/** "Claire: 6 in hand": a hand's count, and a drop target that puts a card at the end of that hand. */
function HandLabel({ zone, who, name, n }: { zone: ZoneId; who: ComponentChildren; name: string; n: number }) {
  return (
    <span class="hand-label" data-drop={zone} data-layout="append" title={`Drop a card here to put it in ${name}’s hand`}>
      {who}: {n} in hand
    </span>
  );
}
