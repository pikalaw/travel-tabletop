// The game state: one serializable object. See "State schema" in the v2 technical design.

export type PlayerId = 'p1' | 'p2';
/** Who sent a command: a player, the shared table on one blinded device, or the host itself. */
export type Actor = PlayerId | 'table' | 'host';
/** Who is looking at the screen; `nobody` on a blinded one-device table. */
export type Viewer = PlayerId | 'nobody';
export type ZoneKind = 'library' | 'hand' | 'battlefield' | 'lands' | 'graveyard' | 'exile' | 'command';
export type ZoneId = `${PlayerId}.${ZoneKind}` | 'stack';
export type GameMode = 'networked' | 'same-device';

export interface Counters {
  plus: number;
  minus: number;
  labeled: Record<string, number>;
}

export interface CardInstance {
  /** `c<n>` for deck cards, `t<n>` for tokens, unique per game. */
  id: string;
  /** The card definition in storage (images, name). */
  defId: string;
  name: string;
  /** null for tokens. */
  deckId: string | null;
  /** The player who selected the deck, or the token's owner. */
  owner: PlayerId;
  isToken: boolean;
  tapped: boolean;
  face: 'front' | 'back';
  /** Hidden from everyone but the owner. */
  faceDown: boolean;
  revealed: boolean;
  counters: Counters;
  /** The host card's id (same battlefield zone, one level only). */
  attachedTo?: string;
  /** Attack number 1, 2, … while marked attacking. */
  attacking?: number;
  /** Ids of the attackers this card blocks. */
  blocking?: string[];
  /**
   * Who last changed this card while it was in play (battlefield or lands), and in which turn:
   * drawn as a coloured left border so the other player can see what was just done. Added in
   * protocol 4.
   */
  changed?: { by: PlayerId; turn: number };
}

export interface PlayerCounter {
  key: string;
  value: number;
}

export interface PlayerState {
  name: string;
  /** `life` is always index 0. */
  counters: PlayerCounter[];
  libraryTopFaceUp: boolean;
}

export interface GameResult {
  winner: PlayerId | null;
  reason: 'concede' | 'ended';
}

export interface GameState {
  schemaVersion: 1;
  gameId: string;
  mode: GameMode;
  /** Incremented by every applied command. */
  seq: number;
  /** 0 before startGame, then 1, 2, … */
  turn: number;
  activePlayer: PlayerId;
  /** Next numeric suffix for card and token ids. */
  nextId: number;
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, CardInstance>;
  /** Index 0 is the top of a pile or the left of a row. */
  zones: Record<ZoneId, string[]>;
  result: GameResult | null;
}
