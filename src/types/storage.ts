// Records stored in IndexedDB (`mtg-tabletop`, version 2) and the backup file format.

import type { Actor, GameMode, GameState, PlayerId, ZoneId } from './state';
import type { AnyCommand, CardSpec, Notice } from './commands';

export interface ImageSizes {
  small: string;
  large: string;
}

export interface CardDef {
  id: string;
  name: string;
  /** Image hash, normal size (488×680); the card id derives from this. */
  front: string;
  /** Image hash, normal size, or null for the default card back. */
  back: string | null;
  scryfallId?: string;
  /** Small (146×204) for crowded boards, large (672×936) for the full view. Missing on sample cards. */
  sizes?: { front: ImageSizes; back: ImageSizes | null };
  /** Rules text and other facts from Scryfall. Missing on sample cards and on cards restored from older backups. */
  text?: CardText;
}

/** One face's printed facts (a single-faced card has one face). */
export interface FaceText {
  name: string;
  typeLine: string;
  /** Oracle text; paragraphs separated by "\n". */
  oracleText: string;
  manaCost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
}

export interface CardText {
  /** The card across printings (rulings are stored by it). */
  oracleId?: string;
  layout?: string;
  /** Front first; for double-faced and split cards, one entry per face. */
  faces: FaceText[];
  /**
   * The rest of Scryfall's card record, as delivered, minus prices and links: kept for later use
   * (keywords, colours, produced mana, related cards, rarity, …). Not read by the app yet.
   */
  record: Record<string, unknown>;
}

/** One ruling from Scryfall: Wizards' rulings and release notes (`wotc`), or Scryfall's own notes. */
export interface Ruling {
  source: string;
  publishedAt: string;
  comment: string;
}

/** A card's rulings, shared by every printing (keyed by oracle id). */
export interface RulingsRecord {
  oracleId: string;
  rulings: Ruling[];
  fetchedAt: number;
}

export interface Deck {
  id: string;
  name: string;
  kind: 'deck' | 'token';
  /** Card definition ids, with repeats. */
  cards: string[];
  builtin?: boolean;
  /** Set on decks downloaded from a built-in starter pack. */
  starterId?: string;
  /** Token decks: the decks whose cards create these tokens. */
  forDecks?: string[];
  /** Pasted imports: the normalized card list, to warn about duplicates. */
  signature?: string;
  commanders?: string[];
  createdAt: number;
}

export interface ImageRecord {
  hash: string;
  blob: Blob;
  type: string;
}

/** The choices on the setup screen, kept with a hosted game so it can be resumed. */
export interface GameSetup {
  /** Optional; Home shows "<player 1> vs <player 2>" without one. Not remembered for the next game. */
  name?: string;
  life?: number;
  p1?: { name: string; deckIds: string[] };
  /** One device: the second player's decks. Hosting: the guest's name and cards, once joined. */
  p2?: { name: string; deckIds?: string[]; spec?: { cards: CardSpec[]; commanders?: CardSpec[] } };
}

export interface GameRecord {
  id: string;
  mode: GameMode;
  role: 'host';
  setup: GameSetup;
  state: GameState;
  /** When the game last changed (a command or an undo); the home screen sorts by it. */
  updatedAt: number;
  over: boolean;
}

export interface SnapshotRecord {
  gameId: string;
  key: number;
  state: GameState;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

/** A guest's note of the game it joined, so it can rejoin. */
export interface GuestGameMeta {
  gameId: string;
  hostName: string;
  name: string;
  deckIds: string[];
}

export type LogKind = 'command' | 'notice' | 'rejected' | 'undo' | 'snapshot';

export interface LoggedCard {
  id: string;
  defId: string;
  name: string;
  from?: ZoneId;
  to?: ZoneId;
  toIndex?: number;
  visibleTo: { before: PlayerId[]; after: PlayerId[] };
}

export interface LogEntry {
  gameId: string;
  seq: number;
  ts: string;
  mode: GameMode;
  turn: number;
  kind: LogKind;
  actor: Actor;
  command?: AnyCommand;
  notice?: Notice;
  text?: string;
  /** A command's ticker alert (library moves, shuffles), so a resumed game's log shows it again. */
  alert?: boolean;
  cards?: LoggedCard[];
  undoneSeq?: number;
  reason?: string;
  state?: GameState;
  schemaVersion: number;
}

/** The first line of an exported action log. */
export interface LogManifest {
  kind: 'manifest';
  gameId: string;
  mode: GameMode;
  players: Record<PlayerId, string>;
  exportedAt: string;
  schemaVersion: number;
}

export const BACKUP_FORMAT = 'travel-tabletop-decks';
export const BACKUP_VERSION = 1;

/** `manifest.json` inside a `.mtgdecks` backup (a zip with `images/<hash>.<ext>` beside it). */
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  decks: Deck[];
  defs: CardDef[];
  /** Image hash → file extension. */
  images: Record<string, string>;
  /**
   * The rulings of the cards in `defs`, by oracle id. Optional, so the format stays version 1: an
   * app from before rulings were backed up ignores them, and a backup without them still restores.
   */
  rulings?: RulingsRecord[];
}
