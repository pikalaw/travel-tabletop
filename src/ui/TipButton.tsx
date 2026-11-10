// A button that explains itself: hold it to read its tip, and lift to put the tip away; a hold
// never presses it, a tap does. The hold is handled by the game screen's gestures (data-tip,
// gestures.ts); this component only keeps the tip, the mouse hover title and the spoken label together.

import type { ComponentChildren, JSX } from 'preact';

type Props = Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'title' | 'aria-label'> & {
  /** What the button does, in one short line. */
  tip: string;
  /** A spoken name, for a button that shows an icon instead of words. */
  label?: string;
  children: ComponentChildren;
};

export function TipButton({ tip, label, children, ...rest }: Props) {
  return <button {...rest} aria-label={label} title={tip} data-tip={tip}>{children}</button>;
}
