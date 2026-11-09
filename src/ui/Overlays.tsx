// Overlays on the game screen: card viewer sheets, full-screen card, counters, log, tokens,
// dice, menu.

import { useState, useRef } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { promptBox } from './Dialogs';
import { Row, cardImage, BACK_URL, type BoardCtx } from './Cards';
import { zoneKind, zoneOwner, other, canSeeFace, findZone } from '../engine/view';
import { artUrl, sizeFor, type Art } from '../storage/art';
import { abilitiesOf } from './abilities';
import type { FullModel } from './fullModel';
import { DRAG_OUT_PX } from './cardGestures';
import { CardFrame } from './CardFrame';
import { useRulings, RulingsPanel } from './Rulings';
import type { CardInstance, GameState, PlayerId, ZoneId } from '../types/state';
import type { Deck } from '../types/storage';
import type { AwayLine } from './gameUi';

/** Send a command or notice through the session. */
export type Send = (type: string, payload: object) => unknown;

/** A zone viewer, peek tray, search or reveal. */
export type CardSheetState =
  | { kind: 'zone' | 'search' | 'inspect'; zone: ZoneId }
  | { kind: 'peek' | 'reveal'; zone: ZoneId; ids: string[] };

/** The full view's row: the card's group (host, then attachments), then its combat partners. */
export interface FullRow { group: string[]; partners: string[]; role: 'attacker' | 'blocker' | null }

const ZONE_TITLE: Record<string, string> = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  lands: 'Lands',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command zone',
  stack: 'Stack',
};
export function zoneTitle(state: GameState, zone: ZoneId): string {
  const owner = zoneOwner(zone);
  const k = ZONE_TITLE[zoneKind(zone)] || zone;
  return owner ? `${state.players[owner].name} · ${k}` : k;
}

/** A panel over the opponent's half of the board. */
export function Sheet({ title, onClose, children, actions, tall = false }: { title: string; onClose: () => void; children?: ComponentChildren; actions?: ComponentChildren; tall?: boolean }) {
  return (
    <div class={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-label={title}>
      <div class="sheet-head">
        <span class="sheet-title">{title}</span>
        <span class="sheet-actions">{actions}</span>
        <button class="btn ghost" onClick={onClose}>
          Done
        </button>
      </div>
      <div class="sheet-body">{children}</div>
    </div>
  );
}

/** Zone viewer, peek tray, search and reveal. */
export function CardSheet({ ctx, sheet, onClose, onRandom }: { ctx: BoardCtx; sheet: CardSheetState; onClose: () => void; onRandom: (zone: ZoneId) => void }) {
  const st = ctx.state;
  const zone = sheet.zone;
  const lib = st.zones[zone] || [];
  let ids: string[],
    layout: 'row' | 'tray' = 'row',
    override = false,
    title = zoneTitle(st, zone),
    hint = '';
  if (sheet.kind === 'peek') {
    ids = lib.filter((id) => sheet.ids.includes(id));
    layout = 'tray';
    override = true;
    title = `Top ${sheet.ids.length} of ${zoneTitle(st, zone)} (only you see these)`;
    hint = 'Drag cards anywhere. Drop back here to reorder; drop on the library pile for top or bottom.';
  } else if (sheet.kind === 'search') {
    ids = lib;
    layout = 'tray';
    override = true;
    title = `Searching ${zoneTitle(st, zone)}`;
    hint = 'Take what you need. Done shuffles the library.';
  } else if (sheet.kind === 'inspect') {
    ids = lib;
    layout = 'tray';
    override = true;
    title = `Looking at ${zoneTitle(st, zone)}`;
  } else if (sheet.kind === 'reveal') {
    ids = lib.filter((id) => sheet.ids.includes(id));
    layout = 'tray';
    override = true;
    title = `Revealed: top of ${zoneTitle(st, zone)}`;
  } else ids = lib;
  const trayDrop = layout === 'tray' ? 'tray' : 'row';
  return (
    <Sheet
      title={title}
      onClose={onClose}
      tall
      actions={
        ids.length > 1 && sheet.kind === 'zone' ? (
          <button class="btn ghost" onClick={() => onRandom(zone)}>
            Random card
          </button>
        ) : null
      }
    >
      {hint ? <div class="sheet-hint">{hint}</div> : null}
      <div class="sheet-row">
        <Row ctx={ctx} zone={zone} ids={ids} open={true} layout={trayDrop} override={override} emptyText="Empty" />
      </div>
    </Sheet>
  );
}

/**
 * Full-screen view of one card. The row under it shows the card's group (host, then attachments)
 * and, past a divider, the host's combat cards: an attacker's blockers, or a blocker's attackers.
 * Marks and counters sit below the image so they never cover the card's text.
 */
export interface FullCardProps {
  ctx: BoardCtx;
  /** What to show and offer (see fullModel). */
  model: FullModel;
  row?: FullRow | null;
  onPick?: (id: string) => void;
  onCounter?: ((type: 'addCounter' | 'removeCounter', kind: string, label: string | undefined) => void) | null;
  /** The previous and next card or group in the same slot: a sideways swipe (or arrow key) goes there. */
  step?: { prev: string | null; next: string | null } | null;
  onStep?: (id: string) => void;
  /** Dragging the card up: hand the moving pointer (which went down at x0, y0) back to the board. */
  onDragOut?: ((e: PointerEvent, x0: number, y0: number) => void) | null;
  /** Swiping the card down: back to the board, the same as Close. */
  onClose?: (() => void) | null;
  /** A tap on the card taps or untaps it (when the model allows). */
  onToggleTap?: (() => void) | null;
  /** Put typed text (Custom…) on the stack as an ability (when the model offers abilities). */
  onAbility?: ((text: string) => void) | null;
  /**
   * An ability line dragged sideways out of the list: hand the moving pointer (down at x0, y0) and
   * the line's element to a board drag. Dropped on the Stack pile it goes on the stack; anywhere
   * else nothing happens.
   */
  onAbilityDrag?: ((el: HTMLElement, e: PointerEvent, x0: number, y0: number) => void) | null;
}

export function FullCard({ ctx, model, row = null, onPick = () => {}, onCounter = null, step = null, onStep = () => {}, onDragOut = null, onClose = null, onToggleTap = null, onAbility = null, onAbilityDrag = null }: FullCardProps) {
  const st = ctx.state;
  const { card, zone } = model;
  const cardId = card.id;
  const img = cardImage(ctx, card, zone, card.faceDown && ctx.viewer === card.owner, 'large');
  const c = card.counters;
  const art = ctx.art.get(card.defId);
  // Rulings, for a face the viewer can see (an ability item shows its source's). The panel's open
  // state belongs to the card it was opened on, so stepping to another card closes it.
  const rulings = useRulings(model.visible ? art?.text?.oracleId : undefined);
  const [rulingsFor, setRulingsFor] = useState<string | null>(null);
  const host = card.attachedTo ? st.cards[card.attachedTo] : null;
  const zoneOfId = (id: string): ZoneId => findZone(st, id) || zone;
  const seen = (x: CardInstance) => canSeeFace(st, x, zoneOfId(x.id), ctx.viewer) || (x.faceDown && ctx.viewer === x.owner);
  const nameOf = (x: CardInstance) => (seen(x) ? x.name : 'a hidden card');
  // On the card: a sideways swipe (or arrow key) goes to the previous or next card or group in the
  // slot; dragging up goes back to the board carrying the card's group, to drop on any slot; a
  // swipe down just closes the view; a tap taps or untaps a card in play.
  const gestures = {
    onTap: model.tapToggle ? onToggleTap : null,
    onPrev: step?.prev ? () => onStep(step.prev!) : null,
    onNext: step?.next ? () => onStep(step.next!) : null,
    onDragOut,
    onClose,
  };
  // The picture stays upright so its text can be read; a tapped card says so in a badge instead.
  const inPlay = zoneKind(zone) === 'battlefield' || zoneKind(zone) === 'lands';
  const badges = [
    card.tapped && inPlay ? (
      <span class="badge tap big" title="Tapped">
        ↷ Tapped
      </span>
    ) : null,
    card.attacking ? (
      <span class="badge atk big" data-badge="attack" data-card-of={card.id} data-zone={zone}>
        ⚔{card.attacking} attacking
      </span>
    ) : null,
    ...(card.blocking || []).map((a) => {
      const att = st.cards[a];
      return att?.attacking ? (
        <span class="badge blk big" data-badge="block" data-attacker={a} data-card-of={card.id} data-zone={zone}>
          🛡 blocks ⚔{att.attacking}
        </span>
      ) : null;
    }),
    ...[
      c.plus
        ? {
            kind: 'plus',
            text: `+1/+1 × ${c.plus}`,
          }
        : null,
      c.minus
        ? {
            kind: 'minus',
            text: `−1/−1 × ${c.minus}`,
          }
        : null,
      ...Object.entries(c.labeled).map(([k, v]) => ({
        kind: 'label',
        label: k,
        text: `${k} ${v}`,
      })),
    ]
      .filter((b): b is { kind: string; label?: string; text: string } => !!b)
      .map((b) => (
        <span class="ctr-group">
          {onCounter ? (
            <button class="btn round ctr-step" aria-label="Remove one" onClick={() => onCounter('removeCounter', b.kind, b.label)}>
              −
            </button>
          ) : null}
          <span class={`badge ${b.kind} big`} data-badge={b.kind} data-label={b.label} data-card-of={card.id} data-zone={zone}>
            {b.text}
          </span>
          {onCounter ? (
            <button class="btn round ctr-step" aria-label="Add one" onClick={() => onCounter('addCounter', b.kind, b.label)}>
              +
            </button>
          ) : null}
        </span>
      )),
  ].filter(Boolean);
  // The card's abilities, for a face the viewer can see; an ability item shows its own text instead.
  const offer = model.offersAbilities && onAbility ? onAbility : null;
  const abilities = offer ? abilitiesOf(art?.text, card.face, !!art?.back) : [];
  // An ability line is picked up by a sideways drag, so a tap never adds one by mistake and an
  // up or down swipe still scrolls the list.
  const lineDown = useRef<{ x: number; y: number; id: number } | null>(null);
  const linePointer = {
    onPointerDown: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      lineDown.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerMove: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      const s0 = lineDown.current;
      if (!s0 || !onAbilityDrag || e.pointerId !== s0.id) return;
      const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
      if (Math.abs(dx) > DRAG_OUT_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        lineDown.current = null;
        onAbilityDrag(e.currentTarget, e, s0.x, s0.y);
      }
    },
    onPointerUp: () => { lineDown.current = null; },
    onPointerCancel: () => { lineDown.current = null; },
  };
  const custom = () =>
    void promptBox({ title: 'Put an ability on the stack', body: `Any text: a delayed trigger, an effect from elsewhere. It goes on the stack with ${card.name}’s picture.`, placeholder: 'e.g. Draw a card at the next end step', ok: 'Put on stack' })
      .then((t) => { if (t?.trim()) offer?.(t.trim()); });
  // Caption for the row: how many are attached, and the combat side.
  const parts: string[] = [];
  if (row && row.group.length > 1) parts.push(`${row.group.length - 1} attached`);
  if (row?.role === 'attacker') parts.push(row.partners.length ? `blocked by ${row.partners.length}` : 'unblocked');
  if (row?.role === 'blocker') parts.push(`blocking ${row.partners.map((a) => `⚔${st.cards[a]!.attacking}`).join(' · ')}`);
  const thumb = (id: string, i: number, partner: boolean) => {
    const x = st.cards[id]!;
    const t = cardImage(ctx, x, zoneOfId(id), x.faceDown && ctx.viewer === x.owner, 'small');
    const sum = x.counters.plus + x.counters.minus + Object.values(x.counters.labeled).reduce((a, b) => a + b, 0);
    const nAtt = partner ? Object.values(st.cards).filter((y) => y.attachedTo === id).length : 0;
    const mark = x.attacking ? `⚔${x.attacking}` : (x.blocking || []).length ? '🛡' : '';
    const label = partner
      ? row!.role === 'attacker'
        ? `Blocker: ${nameOf(x)}`
        : `Attacker: ${nameOf(x)}`
      : i === 0
        ? 'Host card'
        : `Attached card ${i}`;
    return (
      <button class={`thumb ${id === cardId ? 'on' : ''}`} onClick={() => onPick(id)} aria-label={label}>
        {t.url ? <img src={t.url} alt="" draggable={false} /> : <span class="thumb-missing">{nameOf(x)}</span>}
        {sum ? <span class="thumb-ctr">{sum}</span> : null}
        {mark ? <span class={`thumb-mark ${x.attacking ? 'atk' : 'blk'}`}>{mark}</span> : null}
        {nAtt ? <span class="thumb-att">+{nAtt}</span> : null}
      </button>
    );
  };
  return (
    <div class={`fullcard ${row ? 'grouped' : ''}`}>
      <CardFrame url={img.url} name={card.name} gestures={gestures} target={{ cardId: card.id, zone }}>
        {badges.length ? <div class="full-badges">{badges}</div> : null}
      </CardFrame>
      <div class="fullcard-meta">
        {model.caption ? <span class="full-caption">{model.caption}</span> : null}
        <b>{model.title}</b>
        {model.abilityText ? <p class="ability-text">{model.abilityText}</p> : null}
        <span>
          {zoneTitle(st, zone)}
          {card.tapped ? ' · tapped' : ''}
          {card.faceDown ? ' · face down' : ''}
          {card.revealed ? ' · revealed' : ''}
          {card.face === 'back' ? ' · back face' : ''}
          {card.isToken ? ' · token' : ''}
          {art?.back ? ' · double-faced' : ''}
        </span>
        {/* Near the top, so it shows without scrolling on a phone held upright. */}
        {rulings.length ? (
          <button class="rulings-link" onClick={() => setRulingsFor(cardId)}>
            Rulings ({rulings.length})
          </button>
        ) : null}
        {host ? <span>Attached to {nameOf(host)}</span> : null}
        {row && parts.length ? <span>{parts.join(' · ')}</span> : null}
        {row ? (
          <>
            <div class="full-thumbs">
              {row.group.map((id, i) => thumb(id, i, false))}
              {row.partners.length ? <span class="thumb-divider" aria-hidden="true" /> : null}
              {row.partners.map((id, i) => thumb(id, i, true))}
            </div>
            <span class="hint">Tap a thumbnail to see that card. Swipe the card for the next card or group in the slot.</span>
          </>
        ) : null}
        {offer ? (
          <div class="abilities" role="group" aria-label="Abilities">
            {abilities.length ? <span class="hint">Drag an ability sideways out, onto the Stack, to put it there.</span> : null}
            {abilities.map((g) => (
              <>
                {g.face ? <span class="ability-face">{g.face}</span> : null}
                {g.lines.map((line) => (
                  <div class="ability line" data-ability-of={cardId} data-zone={zone} data-ability-text={line} {...linePointer}>
                    {line}
                  </div>
                ))}
              </>
            ))}
            <button class="ability custom" onClick={custom}>
              Custom…
            </button>
          </div>
        ) : null}
        {model.caption ? <span class="hint">Swipe for the next item down the stack. Drag it up to move it: an ability dragged off the stack is gone.</span> : null}
        {model.tapToggle && onToggleTap ? <span class="hint">Tap the card to tap or untap it.</span> : null}
        {model.actions.counters ? <span class="hint">Drag counters from the bar onto the card. Use − and + to change one.</span> : null}
      </div>
      {rulingsFor === cardId && rulings.length ? (
        <RulingsPanel title={card.name} text={art?.text} rulings={rulings} onClose={() => setRulingsFor(null)} />
      ) : null}
    </div>
  );
}

/** Player counters, both players. */
export function CountersSheet({ ctx, P, send, onClose }: { ctx: BoardCtx; P: PlayerId; send: Send; onClose: () => void }) {
  const st = ctx.state;
  const [adding, setAdding] = useState({
    p1: '',
    p2: '',
  });
  const set = (pl: PlayerId, key: string, value: number) =>
    send('setPlayerCounter', {
      player: pl,
      key,
      value,
    });
  const list = (pl: PlayerId) => (
    <div class={`ctr-panel ${pl}`}>
      <h3>{st.players[pl].name}</h3>
      {st.players[pl].counters.map((c) => (
        <div class="ctr-row">
          <span class="ctr-key">{c.key === 'life' ? 'Life' : c.key}</span>
          <button class="btn round" onClick={() => set(pl, c.key, c.value - 1)}>
            −
          </button>
          <button
            class="ctr-val"
            onClick={async () => {
              const v = await promptBox({
                title: `${st.players[pl].name}: ${c.key}`,
                value: String(c.value),
                numeric: true,
                ok: 'Set',
              });
              if (v != null && v.trim() !== '' && Number.isFinite(Number(v))) set(pl, c.key, Number(v));
            }}
          >
            {c.value}
          </button>
          <button class="btn round" onClick={() => set(pl, c.key, c.value + 1)}>
            +
          </button>
          {c.key === 'life' ? (
            <span class="ctr-x" />
          ) : (
            <button
              class="btn ghost ctr-x"
              title="Remove"
              onClick={() =>
                send('removePlayerCounter', {
                  player: pl,
                  key: c.key,
                })
              }
            >
              ×
            </button>
          )}
        </div>
      ))}
      <form
        class="ctr-add"
        onSubmit={(e) => {
          e.preventDefault();
          const k = adding[pl].trim();
          if (k) {
            send('addPlayerCounter', {
              player: pl,
              key: k,
              value: 0,
            });
            setAdding({
              ...adding,
              [pl]: '',
            });
          }
        }}
      >
        <input
          placeholder="New counter (poison, energy…)"
          value={adding[pl]}
          onInput={(e) =>
            setAdding({
              ...adding,
              [pl]: e.currentTarget.value,
            })
          }
        />
        <button class="btn" type="submit">
          Add
        </button>
      </form>
    </div>
  );
  return (
    <Sheet title="Player counters" onClose={onClose} tall>
      <div class="ctr-panels">
        {list(other(P))}
        {list(P)}
      </div>
    </Sheet>
  );
}
export interface LogLine { text: string; time: string; alert?: boolean }

export function LogSheet({ lines, onClose, onExport }: { lines: readonly LogLine[]; onClose: () => void; onExport: () => void }) {
  return (
    <Sheet
      title="Recent actions"
      onClose={onClose}
      tall
      actions={
        <button class="btn ghost" onClick={onExport}>
          Export log
        </button>
      }
    >
      <ol class="log-list" reversed>
        {[...lines].reverse().map((l) => (
          <li class={l.alert ? 'alert' : ''}>
            <span class="ts">{l.time}</span> {l.text}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
/**
 * The tokens the Tokens sheet offers, as card definition ids sorted by name: those of every token
 * deck made for a deck in this game (its `forDecks`), each token once.
 */
export function gameTokens(state: GameState, tokenDecks: readonly Deck[], art: ReadonlyMap<string, Art>): string[] {
  const inPlay = new Set(Object.values(state.cards).map((c) => c.deckId).filter(Boolean));
  const ids = new Set(tokenDecks.filter((d) => (d.forDecks || []).some((id) => inPlay.has(id))).flatMap((d) => d.cards));
  const name = (id: string) => art.get(id)?.name || '';
  return [...ids].sort((x, y) => name(x).localeCompare(name(y)) || x.localeCompare(y));
}

/** One list of the game's tokens: drag one onto a battlefield to create it; long-press or spread to see it full screen. */
export function TokensSheet({ ctx, tokens, onClose }: { ctx: BoardCtx; tokens: readonly string[]; onClose: () => void }) {
  return (
    <Sheet title="Tokens · drag one onto a battlefield" onClose={onClose} tall>
      {tokens.length === 0 ? <p>No tokens for the decks in this game.</p> : null}
      <div class="token-grid">
        {tokens.map((defId) => {
          const art = ctx.art.get(defId);
          return (
            <div class="token-item" data-token-def={defId} data-token-name={art?.name || 'Token'}>
              {art?.front ? (
                <img src={artUrl(art, 'front', sizeFor(110)) ?? undefined} alt={art.name} draggable={false} />
              ) : (
                <div class="card-face missing">
                  <span>{art?.name || defId}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
export function DiceSheet({ ctx, P, send, onClose }: { ctx: BoardCtx; P: PlayerId; send: Send; onClose: () => void }) {
  const st = ctx.state;
  const [sides, setSides] = useState(100);
  const die = (n: number) =>
    send('rollDie', {
      sides: n,
    });
  const zones: ZoneId[] = [`${P}.hand`, `${other(P)}.hand`, `${P}.graveyard`, `${P}.battlefield`, `${other(P)}.battlefield`];
  return (
    <Sheet title="Dice and random" onClose={onClose}>
      <div class="dice">
        <button class="btn" onClick={() => send('coinFlip', {})}>
          Flip a coin
        </button>
        {[4, 6, 8, 10, 12, 20].map((n) => (
          <button class="btn" onClick={() => die(n)}>
            d{n}
          </button>
        ))}
        <span class="dN">
          <button class="btn" onClick={() => die(sides)}>
            d{sides}
          </button>
          <input type="number" min="2" max="1000" value={sides} onInput={(e) => setSides(parseInt(e.currentTarget.value, 10) || 2)} />
        </span>
      </div>
      <div class="dice">
        <span class="muted">Random card from:</span>
        {zones.map((z) => (
          <button
            class="btn ghost"
            disabled={!st.zones[z].length}
            onClick={() =>
              send('randomPick', {
                zone: z,
              })
            }
          >
            {zoneTitle(st, z)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
export interface MenuItem { label: string; onClick: () => void; danger?: boolean }

export function MenuSheet({ items, onClose }: { items: readonly (MenuItem | null | false)[]; onClose: () => void }) {
  return (
    <Sheet title="Game menu" onClose={onClose}>
      <div class="menu-items">
        {items.filter((it): it is MenuItem => !!it).map((it) => (
          <button class={`btn ${it.danger ? 'danger' : ''}`} onClick={it.onClick}>
            {it.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
export function AwaySheet({ name, lines, onClose }: { name: string; lines: readonly AwayLine[]; onClose: () => void }) {
  return (
    <Sheet title={`While ${name} was away`} onClose={onClose}>
      <ul class="log-list">
        {lines.map((l) => (
          <li class={l.alert ? 'alert' : ''}>{l.text}</li>
        ))}
      </ul>
    </Sheet>
  );
}
export { BACK_URL };
