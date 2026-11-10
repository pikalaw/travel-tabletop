// The 5×3 board grid, drawn from one player's perspective.

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
function Counters({ ctx }: { ctx: BoardCtx }) {
  const st = ctx.state;
  const A = st.activePlayer;
  const line = (pl: PlayerId) => {
    const list = ctx.state.players[pl].counters;
    const life = list[0]!;
    const rest = list.slice(1);
    return (
      <div class={`ctr-line ${pl} ${pl === A ? 'role-atk' : 'role-def'}`}>
        <span class="ctr-name">{ctx.state.players[pl].name}</span>
        <span class="ctr-life">♥ {life.value}</span>
        {rest.slice(0, 3).map((c) => (
          <span class="ctr-small">
            {c.key} {c.value}
          </span>
        ))}
        {rest.length > 3 ? <span class="ctr-small">+{rest.length - 3}</span> : null}
      </div>
    );
  };
  // The player whose turn it is is listed first, under a "Turn N · name" label.
  return (
    <div class="counters-cell" data-tap="counters">
      <span class="slot-label turn-label role-atk">
        Turn {st.turn} · {st.players[A].name}
      </span>
      {line(A)}
      {line(other(A))}
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
  return (
    <div class={`board persp-${P} ${st.activePlayer === P ? 'my-turn' : 'their-turn'} ${ctx.match?.size ? 'matching' : ''}`}>
      <div class="cell c11 opp">{<Pile ctx={ctx} zone={z.oppExile} label="Exile" />}</div>
      <div class="cell c12 opp">
        {row(z.oppLands, <>{who(O)} · lands</>)}
        <span class="opp-hand" data-drop={`${O}.hand`} data-layout="append" title={`Drop a card here to put it in ${name(O)}’s hand`}>
          {who(O)}: {handCount(st, O)} in hand
        </span>
      </div>
      <div class="cell c13 opp">{<Pile ctx={ctx} zone={z.oppGrave} label="Graveyard" />}</div>
      <div class="cell c21 opp">{<Pile ctx={ctx} zone={z.oppCmd} label="Command" />}</div>
      <div class="cell c22 opp">{row(z.oppField, <>{who(O)} · battlefield</>)}</div>
      <div class="cell c23 opp">
        {<Pile ctx={ctx} zone={z.oppLib} label="Library" layout="library" />}
      </div>
      <div class="cell c31 me">{<Pile ctx={ctx} zone={z.myCmd} label="Command" />}</div>
      <div class="cell c32 me">{row(z.myField, <>{who(P)} · battlefield</>, 'field')}</div>
      <div class="cell c33 me">
        {<Pile ctx={ctx} zone={z.myLib} label="Library" layout="library" />}
      </div>
      <div class="cell c41 me">{<Pile ctx={ctx} zone={z.myExile} label="Exile" />}</div>
      <div class="cell c42 me">{row(z.myLands, <>{who(P)} · lands</>)}</div>
      <div class="cell c43 me">{<Pile ctx={ctx} zone={z.myGrave} label="Graveyard" />}</div>
      <div class="cell c51 me">
        <Counters ctx={ctx} />
      </div>
      <div class="cell c52 me">
        {row(
          z.myHand,
          <>
            {who(P)}’s hand{ctx.viewer === P ? '' : ' (hidden)'}
          </>,
          'hand',
        )}
      </div>
      <div class="cell c53 shared">{<Pile ctx={ctx} zone="stack" label="Stack" all />}</div>
    </div>
  );
}
