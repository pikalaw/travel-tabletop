// Commands and notices. See "Commands and engine rules" in the v2 technical design.
// `Command` is a discriminated union on `type`; the engine switches on it and ends with
// `assertNever`, so a command added here without being handled fails the type check.

import type { Actor, GameMode, GameState, PlayerId, ZoneId } from './state';

/** A card spec for startGame: what a deck contributes. */
export interface CardSpec {
  defId: string;
  name: string;
  deckId: string | null;
}

export interface PlayerSetup {
  name: string;
  cards: CardSpec[];
  commanders?: CardSpec[];
}

export type CounterKind = 'plus' | 'minus' | 'label';

/** Payloads of the state commands, by command type. */
export interface StatePayloads {
  startGame: {
    gameId: string;
    mode: GameMode;
    startingLife?: number;
    deal?: number;
    first?: PlayerId;
    players: Record<PlayerId, PlayerSetup>;
  };
  move: { cardId: string; from: ZoneId; to: ZoneId; toIndex?: number };
  tap: { cardId: string; from: ZoneId; value?: boolean };
  untapAll: { player: PlayerId };
  flip: { cardId: string; from: ZoneId };
  setFaceDown: { cardId: string; from: ZoneId; value?: boolean };
  reveal: { cardId: string; from: ZoneId; value?: boolean };
  addCounter: { cardId: string; from?: ZoneId; kind: CounterKind; label?: string; n?: number };
  removeCounter: { cardId: string; from?: ZoneId; kind: CounterKind; label?: string; n?: number };
  createToken: { defId: string; name: string; to: ZoneId; toIndex?: number; owner?: PlayerId };
  removeToken: { cardId: string; from: ZoneId };
  draw: { player: PlayerId; n: number };
  mill: { player: PlayerId; n: number };
  shuffle: { zone: ZoneId };
  setLibraryTopFaceUp: { player: PlayerId; value: boolean };
  setPlayerCounter: { player: PlayerId; key: string; value: number };
  addPlayerCounter: { player: PlayerId; key: string; value?: number };
  removePlayerCounter: { player: PlayerId; key: string };
  passTurn: { to?: PlayerId };
  concede: { player: PlayerId };
  endGame: { winner?: PlayerId | null };
  attach: { cardId: string; from: ZoneId; toCardId: string; toZone: ZoneId };
  detach: { cardId: string; from: ZoneId };
  /** Detach every card attached to `cardId` (a host), in one step. Added in protocol 2. */
  detachAll: { cardId: string; from: ZoneId };
  /** Make an attached card the lead (host) of its group. Added in protocol 3. */
  setLead: { cardId: string; from: ZoneId };
  attack: { cardId: string; from: ZoneId; value?: boolean };
  block: { cardId: string; from: ZoneId; attackerId: string; attackerZone: ZoneId; value?: boolean };
  endCombat: Record<string, never>;
  /** Put an ability of `cardId` on top of the stack as its own item. Added in protocol 5. */
  putAbility: { cardId: string; from: ZoneId; text: string };
}

export type StateCommandType = keyof StatePayloads;

/** Every state command type, in the catalog's order. */
export const STATE_COMMAND_TYPES = [
  'startGame', 'move', 'tap', 'untapAll', 'flip', 'setFaceDown', 'reveal',
  'addCounter', 'removeCounter', 'createToken', 'removeToken', 'draw', 'mill',
  'shuffle', 'setLibraryTopFaceUp', 'setPlayerCounter', 'addPlayerCounter',
  'removePlayerCounter', 'passTurn', 'concede', 'endGame', 'attach', 'detach',
  'attack', 'block', 'endCombat', 'detachAll', 'setLead', 'putAbility',
] as const satisfies readonly StateCommandType[];

interface Envelope {
  actor: Actor;
  /** The guest's own counter, echoed back so it can match rejections. */
  clientSeq?: number;
  /** Host-supplied numbers in [0, 1), as many as `randomNeeded` asked for. */
  random?: number[];
}

/** One state command: `{ type, payload }` with the payload that type takes. */
export type Command = { [T in StateCommandType]: Envelope & { type: T; payload: StatePayloads[T] } }[StateCommandType];
export type CommandOf<T extends StateCommandType> = Extract<Command, { type: T }>;

/** Payloads of notices as sent; the host fills in the results (`result`, `cardId`). */
export interface NoticePayloads {
  peek: { zone: ZoneId; n: number };
  revealTop: { zone: ZoneId; n: number; ids?: string[] };
  searchOpen: { zone: ZoneId };
  searchClose: { zone: ZoneId };
  inspect: { zone: ZoneId };
  point: { cardId?: string | null; zone?: ZoneId | null };
  showCard: { cardId: string; zone: ZoneId };
  coinFlip: { result?: 'heads' | 'tails' };
  rollDie: { sides?: number; result?: number };
  randomPick: { zone: ZoneId; cardId?: string };
  info: Record<string, unknown>;
}

export type NoticeKind = keyof NoticePayloads;

export const NOTICE_KINDS = [
  'peek', 'revealTop', 'searchOpen', 'searchClose', 'inspect', 'point', 'showCard',
  'coinFlip', 'rollDie', 'randomPick', 'info',
] as const satisfies readonly NoticeKind[];

/** A notice sent through the same channel as commands. */
export type NoticeCommand = { [K in NoticeKind]: Envelope & { type: K; payload: NoticePayloads[K] } }[NoticeKind];

/** Undo is handled by the host, not the engine. */
export interface UndoCommand extends Envelope {
  type: 'undo';
  payload?: Record<string, never>;
}

/** Anything a session can dispatch to the host. */
export type AnyCommand = Command | NoticeCommand | UndoCommand;

/** A notice as logged and broadcast, with the host's results and ticker text. */
export type Notice = {
  [K in NoticeKind]: { kind: K; actor: Actor; payload: NoticePayloads[K]; text?: string; alert?: boolean; seq?: number }
}[NoticeKind];

/** One card moved by a command, for the log and the ticker. `null` means created or deleted. */
export interface Movement {
  id: string;
  from: ZoneId | null;
  to: ZoneId | null;
  toIndex?: number;
}

export type ApplyError = 'stale' | 'invalid';

export type ApplyResult =
  | { state: GameState; moved: Movement[] }
  | { error: ApplyError; detail?: string };

/** Exhaustiveness check for switches over unions. */
export function assertNever(x: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(x)}`);
}
