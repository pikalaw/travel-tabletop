// The picture of a full-screen card, shared by the game's full view and the card viewer (deck
// page, Tokens sheet): the large image, the ← and → signs at its sides, the card gestures on it,
// and the arrow keys. Only what both screens have lives here; each screen draws its own details,
// caption and buttons around it.

import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useCardGestures, type CardGestures } from './cardGestures';

export interface CardFrameProps {
  /** The image, or null to show the name on a blank face. */
  url: string | null;
  /** Alt text, and the label of a blank face. */
  name: string;
  /** What the gestures and arrow keys do. A sign shows where `onPrev` or `onNext` is set. */
  gestures: CardGestures;
  /** The game card this picture is (a counter dropped on it lands on that card). */
  target?: { cardId: string; zone: string } | null;
  /** Under the picture (the full view's badges). */
  children?: ComponentChildren;
}

export function CardFrame({ url, name, gestures, target = null, children }: CardFrameProps) {
  const handlers = useCardGestures(gestures);
  // One key listener for the frame's life, reading the latest gestures, so a key pressed right
  // after a step never acts on the previous card. Keys typed into a field are left alone.
  const latest = useRef(gestures);
  latest.current = gestures;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const go = e.key === 'ArrowLeft' ? latest.current.onPrev : e.key === 'ArrowRight' ? latest.current.onNext : null;
      if (go) {
        e.preventDefault();
        go();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  return (
    <div class="card-frame">
      {/* Signs only: they show that a swipe leads somewhere; the swipe itself does the moving. */}
      <span class={`card-frame-step prev ${gestures.onPrev ? '' : 'off'}`} aria-hidden="true">←</span>
      <span class={`card-frame-step next ${gestures.onNext ? '' : 'off'}`} aria-hidden="true">→</span>
      <div class="card-frame-pic" data-card-target={target?.cardId} data-zone={target?.zone} {...handlers}>
        {url ? (
          <img src={url} alt={name} draggable={false} />
        ) : (
          <div class="card-face missing big">
            <span>{name}</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
