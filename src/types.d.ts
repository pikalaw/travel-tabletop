// Type declarations for the game state and protocol. Used only by `tsc --checkJs`;
// the shipped JavaScript references these through JSDoc @typedef imports.

export type PlayerId = 'p1' | 'p2';
export type ZoneKind = 'library' | 'hand' | 'battlefield' | 'lands' | 'graveyard' | 'exile' | 'command';
export type ZoneId = `${PlayerId}.${ZoneKind}` | 'stack';
export type Viewer = PlayerId | 'nobody';
export type Actor = PlayerId | 'table' | 'host';

export interface Counters {
  plus: number;
  minus: number;
  labeled: Record<string, number>;
}

export interface CardInstance {
  id: string;
  defId: string;
  name: string;
  deckId: string | null;
  owner: PlayerId;
  isToken: boolean;
  tapped: boolean;
  face: 'front' | 'back';
  faceDown: boolean;
  revealed: boolean;
  counters: Counters;
  /** id of the card this one is attached to (same battlefield zone; one level only) */
  attachedTo?: string;
}

export interface PlayerCounter { key: string; value: number }

export interface PlayerState {
  name: string;
  counters: PlayerCounter[];
  libraryTopFaceUp: boolean;
}

export interface GameState {
  schemaVersion: number;
  gameId: string;
  mode: 'networked' | 'same-device';
  seq: number;
  turn: number;
  activePlayer: PlayerId;
  nextId: number;             // next numeric id for cards and tokens
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, CardInstance>;
  zones: Record<ZoneId, string[]>;
  result: null | { winner: PlayerId | null; reason: 'concede' | 'ended' };
}

export interface Command {
  type: string;
  actor: Actor;
  clientSeq?: number;
  payload: any;
  random?: number[];
}

export interface CardDef {
  id: string;
  name: string;
  front: string;        // image hash, normal size (488×680); the card id derives from this
  back: string | null;  // image hash, normal size, or null for the default card back
  scryfallId?: string;
  // Extra sizes: small (146×204) for crowded boards, large (672×936) for full screen.
  // Missing on sample cards (SVG scales) and on decks imported before sizes existed.
  sizes?: {
    front: { small: string; large: string };
    back: { small: string; large: string } | null;
  };
}

export interface Deck {
  id: string;
  name: string;
  kind: 'deck' | 'token';
  cards: string[];      // defIds, with repeats
  builtin?: boolean;
  starterId?: string;   // set on decks downloaded from a built-in starter pack
  forDecks?: string[];  // token decks: the decks whose cards create these tokens
  signature?: string;   // pasted imports: normalized card list, to warn about duplicates
  commanders?: string[];
  createdAt: number;
}

export interface Notice {
  kind: 'peek' | 'revealTop' | 'searchOpen' | 'searchClose' | 'inspect' | 'point'
      | 'coinFlip' | 'rollDie' | 'randomPick' | 'info';
  actor: Actor;
  payload: any;
  text?: string;
  seq?: number;
}

export interface LogEntry {
  gameId: string;
  seq: number;
  ts: string;
  mode: 'networked' | 'same-device';
  turn: number;
  kind: 'command' | 'notice' | 'rejected' | 'undo' | 'snapshot';
  actor: Actor;
  command?: Command;
  notice?: Notice;
  text?: string;
  cards?: {
    id: string; defId: string; name: string;
    from?: ZoneId; to?: ZoneId; toIndex?: number;
    visibleTo: { before: PlayerId[]; after: PlayerId[] };
  }[];
  undoneSeq?: number;
  reason?: string;
  state?: GameState;
  schemaVersion: number;
}
