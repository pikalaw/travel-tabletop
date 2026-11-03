// Messages between host and guest over the data channel, and the framing beneath them.

import type { Actor, GameState, PlayerId } from './state';
import type { AnyCommand, ApplyError, CardSpec, Notice } from './commands';

/** What a guest brings to a new game: its library cards and commanders. */
export interface DeckSpec {
  cards: CardSpec[];
  commanders: CardSpec[];
}

/** Guest → host, first message after the channel opens. */
export interface HelloMessage {
  type: 'hello';
  protocolVersion: number;
  appVersion: string;
  name: string;
  spec: DeckSpec;
  deckNames: string[];
  /** Token definition ids the guest has. */
  tokens: string[];
  /** Set when rejoining a game already in progress. */
  gameId: string | null;
}

/** Host → guest: accepted; the guest plays as `player`. */
export interface WelcomeMessage {
  type: 'welcome';
  player: PlayerId;
  state: GameState;
  version: number;
  tokens: string[];
}

/** Host → guest: not accepted. */
export interface RefuseMessage {
  type: 'refuse';
  reason: 'version' | 'cards' | 'game';
  detail: string;
  missing?: string[];
}

/** Guest → host: a command or notice; the host sets the actor. */
export interface CommandMessage {
  type: 'command';
  cmd: { type: AnyCommand['type']; payload: unknown; clientSeq: number };
}

/** Host → guest: the new state after any change, including undo. */
export interface StateMessage {
  type: 'state';
  version: number;
  state: GameState;
  text?: string;
  alert?: boolean;
  actor?: Actor;
  clientSeq?: number;
}

/** Host → guest: one of the guest's commands was not applied. */
export interface RejectedMessage {
  type: 'rejected';
  clientSeq?: number;
  reason: ApplyError | string;
  detail?: string;
}

export interface NoticeMessage {
  type: 'notice';
  notice: Notice;
}

export type ProtocolMessage =
  | HelloMessage | WelcomeMessage | RefuseMessage | CommandMessage
  | StateMessage | RejectedMessage | NoticeMessage;

export type HostToGuest = WelcomeMessage | RefuseMessage | StateMessage | RejectedMessage | NoticeMessage;
export type GuestToHost = HelloMessage | CommandMessage;

/** Data-channel framing: a whole message, one part of a long one, or a keep-alive. */
export type Frame =
  | { t: 'msg'; m: ProtocolMessage }
  | { t: 'part'; id: number; i: number; n: number; d: string }
  | { t: 'ping'; ts: number };
