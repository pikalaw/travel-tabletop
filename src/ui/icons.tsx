// Line icons for buttons, drawn inline so they look the same on every phone (emoji vary).
// All share one 24-unit grid and stroke; a button using one keeps a spoken label (aria-label).

import type { ComponentChildren } from 'preact';

function Icon({ children, size = 22 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{children}</svg>
  );
}

export const UndoIcon = () => <Icon><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>;
/** Redo: the Undo arrow, mirrored. */
export const RedoIcon = () => <Icon><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Icon>;

const eye = <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>;
/** Unblind: an open eye. */
export const EyeIcon = () => <Icon>{eye}</Icon>;
/** Blind my hand: the eye struck through. */
export const EyeOffIcon = () => <Icon>{eye}<path d="M3 3l18 18" /></Icon>;

/** Combat: two crossed swords, as on the attack marks. */
export const SwordsIcon = () => (
  <Icon>
    <path d="M4 4l12 12" /><path d="M13.5 18.5l5-5" /><path d="M17 17l3 3" />
    <path d="M20 4L8 16" /><path d="M5.5 13.5l5 5" /><path d="M7 17l-3 3" />
  </Icon>
);

/** End combat: the crossed swords, smaller, inside a red stop-sign outline (the only red part). */
export const EndCombatIcon = () => (
  <Icon>
    <path d="M8.3 2.5h7.4l5.8 5.8v7.4l-5.8 5.8H8.3l-5.8-5.8V8.3z" stroke="#ff5a4a" stroke-width="2" />
    <path d="M6.8 6.8l8 8" /><path d="M12.6 16.6l4-4" /><path d="M15.2 15.2l2 2" />
    <path d="M17.2 6.8l-8 8" /><path d="M7.4 12.6l4 4" /><path d="M8.8 15.2l-2 2" />
  </Icon>
);

/** Pause: two bars. */
export const PauseIcon = () => <Icon><path d="M9 5v14M15 5v14" stroke-width="2.6" /></Icon>;

/** Close: an ×. */
export const CloseIcon = () => <Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>;

/** End turn: an hourglass. */
export const HourglassIcon = () => (
  <Icon><path d="M6 2h12M6 22h12" /><path d="M7 2v3c0 3 5 4.5 5 7 0-2.5 5-4 5-7V2" /><path d="M7 22v-3c0-3 5-4.5 5-7 0 2.5 5 4 5 7v3" /></Icon>
);

/** Tokens: a pawn, a stand-in piece. */
export const PawnIcon = () => (
  <Icon><circle cx="12" cy="6" r="2.6" /><path d="M9.5 10.5h5" /><path d="M10.2 10.5C10.2 14 8.5 16 7.5 18h9c-1-2-2.7-4-2.7-7.5" /><path d="M6 21h12" /></Icon>
);

/** Dice and random. */
export const DieIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
  </Icon>
);

/** Point: a finger tapping. */
export const PointIcon = () => (
  <Icon>
    <path d="M9 12V4.5a1.5 1.5 0 0 1 3 0V11" /><path d="M12 10.5V9a1.5 1.5 0 0 1 3 0v2" /><path d="M15 11a1.5 1.5 0 0 1 3 0v3.5a6.5 6.5 0 0 1-6.5 6.5h-.5a6 6 0 0 1-5-2.6l-2.2-3.3a1.5 1.5 0 0 1 2.4-1.8L9 15.5" />
  </Icon>
);

/** Untap all: a card lying sideways (faint, dashed) and the same card standing upright. No arrow, so it can't be read as Undo. */
export const UntapIcon = () => (
  <Icon>
    <rect x="2.5" y="12.5" width="12" height="8" rx="1.5" stroke-dasharray="2 2" opacity=".55" />
    <rect x="11" y="3" width="9" height="13" rx="1.5" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon size={20}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Icon>
);
