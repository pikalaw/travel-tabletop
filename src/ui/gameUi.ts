// The game screen's local state: one reducer, so modes that exclude each other can never be on
// together. Nothing here is shared with the other device; it is how this screen is being used.

import type { PlayerId, Viewer, ZoneId } from '../types/state';
import type { CardSheetState } from './Overlays';

/** What a tap on the board means right now. */
export type Mode =
  | { kind: 'normal' }
  /** Taps mark attackers and blockers; `blocker` is a chosen blocker waiting for its attacker. */
  | { kind: 'combat'; blocker: { cardId: string; zone: ZoneId } | null }
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
  /** Player asked "Are you sure you are …?" before unblinding. */
  confirmFor: PlayerId | null;
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
  | { type: 'confirmFor'; player: PlayerId | null }
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
    confirmFor: null,
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
    case 'confirmFor': return { ...s, confirmFor: a.player };
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
