// The game screen's local state: one reducer, so modes that exclude each other can never be on
// together. Nothing here is shared with the other device; it is how this screen is being used.

import type { Actor, GameState, PlayerId, Viewer, ZoneId } from '../types/state';
import { other } from '../engine/view';
import type { CardSheetState, LogLine } from './Overlays';
import type { LogEntry } from '../types/storage';

/** What a tap on the board means right now. */
export type Mode =
  | { kind: 'normal' }
  /** Taps mark attackers and blockers; `blocker` is a chosen blocker waiting for its attacker. */
  /** `vigilance`: the next attacker marked stays untapped; any tap in combat clears it. */
  | { kind: 'combat'; blocker: { cardId: string; zone: ZoneId } | null; vigilance: boolean }
  /** Waiting for the card to attach `cardId` to. */
  | { kind: 'attach'; cardId: string; zone: ZoneId }
  /** The next tap points at a card or slot on both screens. */
  | { kind: 'point' }
  /** The library footer for `zone`, acting on the top `n` cards. */
  | { kind: 'library'; zone: ZoneId; n: number };

export type SheetState =
  | CardSheetState
  | { kind: 'counters' | 'log' | 'tokens' | 'dice' | 'menu' | 'pair' }
  | { kind: 'away'; name: string; lines: AwayLine[] };

/** One action in the "while you were away" list; alerts (library looks, dice, …) are highlighted. */
export interface AwayLine { text: string; alert: boolean }

/** The full view: the card shown, and the card first opened, whose row stays fixed. */
export interface FullState { cardId: string; zone: ZoneId; anchor: string }

export interface UiState {
  viewer: Viewer;
  /** Whose side of the board is at the bottom. */
  persp: PlayerId;
  /** Slots opened by the viewer; several may be open at once. */
  openSlots: ZoneId[];
  mode: Mode;
  sheet: SheetState | null;
  full: FullState | null;
  /** The card whose combat matchup is highlighted on the board. */
  match: string | null;
  /** The reveal screen. */
  shown: { actor: PlayerId; cardIds: string[] } | null;
  /** One device: the "who is unblinding?" chooser is open. */
  choosing: boolean;
  /** Name of the labeled counter in the footer. */
  label: string;
}

export type UiAction =
  | { type: 'mode'; mode: Mode }
  | { type: 'libraryN'; n: number }
  | { type: 'openSlot'; zone: ZoneId }
  | { type: 'closeSlot'; zone: ZoneId }
  | { type: 'closeSlots' }
  | { type: 'sheet'; sheet: SheetState | null }
  | { type: 'full'; full: FullState | null }
  | { type: 'match'; cardId: string | null }
  | { type: 'shown'; shown: UiState['shown'] }
  | { type: 'choosing'; open: boolean }
  | { type: 'label'; label: string }
  /** Show the board to `player`; `away` is what happened while they were not looking. */
  | { type: 'unblind'; player: PlayerId; away: { name: string; lines: AwayLine[] } | null }
  /** Hide the hand; private trays close. */
  | { type: 'blind' };

export function initialUi(same: boolean, me: PlayerId, activePlayer: PlayerId): UiState {
  return {
    viewer: same ? 'nobody' : me,
    persp: same ? activePlayer : me,
    openSlots: [],
    mode: { kind: 'normal' },
    sheet: null,
    full: null,
    match: null,
    shown: null,
    choosing: false,
    label: 'loyalty',
  };
}

const PRIVATE_TRAYS = new Set(['peek', 'search', 'inspect']);

export function uiReducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'mode': return { ...s, mode: a.mode };
    case 'libraryN': return s.mode.kind === 'library' ? { ...s, mode: { ...s.mode, n: Math.max(1, Math.min(99, a.n)) } } : s;
    case 'openSlot': return s.openSlots.includes(a.zone) ? s : { ...s, openSlots: [...s.openSlots, a.zone] };
    case 'closeSlot': return { ...s, openSlots: s.openSlots.filter((z) => z !== a.zone) };
    case 'closeSlots': return { ...s, openSlots: [] };
    case 'sheet': return { ...s, sheet: a.sheet };
    case 'full': return { ...s, full: a.full };
    case 'match': return { ...s, match: a.cardId };
    case 'shown': return { ...s, shown: a.shown };
    case 'choosing': return { ...s, choosing: a.open };
    case 'label': return { ...s, label: a.label };
    case 'unblind':
      return {
        ...s,
        viewer: a.player,
        persp: a.player,
        openSlots: [],
        mode: s.mode.kind === 'library' ? { kind: 'normal' } : s.mode,
        sheet: a.away ? { kind: 'away', ...a.away } : null,
      };
    case 'blind':
      return { ...s, viewer: 'nobody', sheet: s.sheet && PRIVATE_TRAYS.has(s.sheet.kind) ? null : s.sheet };
  }
}

/** A player's role this turn, for the turn colours: `atk` (red) for whoever's turn it is, `def` (blue) for the other; '' for the table. */
export function roleOf(state: GameState, actor: Actor): 'atk' | 'def' | '' {
  return actor === state.activePlayer ? 'atk' : actor === other(state.activePlayer) ? 'def' : '';
}

/** A log line's time of day, as the log sheet shows it. */
export const clockTime = (d: Date = new Date()): string => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The log sheet's lines for a stored game log, so a resumed game shows what happened before: the
 * commands, notices and undos, with the text and alerts they had live, from the start of the game.
 */
export function logLines(entries: readonly LogEntry[]): LogLine[] {
  return entries
    .filter((e) => e.text && (e.kind === 'command' || e.kind === 'notice' || e.kind === 'undo'))
    .map((e) => ({ text: e.text!, alert: !!(e.alert ?? e.notice?.alert), time: clockTime(new Date(e.ts)), turn: e.turn,
      turnStart: e.command?.type === 'passTurn' || e.command?.type === 'startGame' }));
}
