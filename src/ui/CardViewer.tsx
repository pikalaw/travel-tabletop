// A full-screen viewer for stored card definitions (no game state): the deck page and the Tokens sheet.

import { useEffect } from 'preact/hooks';
import { useOutsideTap } from './hooks';
import { CardFrame } from './CardFrame';
import { artUrl, type Art } from '../storage/art';

export interface CardView { i: number; back: boolean }

/**
 * Full-screen view of one stored card (a deck's card, or a token in the Tokens sheet), in the same
 * frame as the game's full view: a sideways swipe or arrow key goes to the previous or next card
 * in `order`, a swipe down, a tap on the picture, a tap outside or Escape closes, and with
 * `onDragOut` a drag up hands the card to a board drag (a token, to drop on a slot). Under it, a
 * caption: the name (with "3×" from `counts` for repeated cards), the position, and Flip for a
 * double-faced card.
 */
export function CardViewer({ art, order, counts, view, setView, onDragOut = null }: {
  art: ReadonlyMap<string, Art>;
  order: readonly string[];
  counts: ReadonlyMap<string, number>;
  view: CardView;
  setView: (v: CardView | null) => void;
  onDragOut?: ((defId: string, e: PointerEvent, x0: number, y0: number) => void) | null;
}) {
  const outside = useOutsideTap(() => setView(null));
  const close = () => setView(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const defId = order[view.i]!;
  const a = art.get(defId);
  const go = (i: number) => () => setView({ i, back: false });
  const url = a ? artUrl(a, view.back && a.back ? 'back' : 'front', 'large') : null;
  const n = counts.get(defId) || 1;
  return (
    <div class="deck-viewer" role="dialog" aria-label={a?.name || 'Card'} {...outside}>
      <CardFrame
        url={url}
        name={a?.name || '…'}
        gestures={{
          onTap: close,
          onPrev: view.i > 0 ? go(view.i - 1) : null,
          onNext: view.i < order.length - 1 ? go(view.i + 1) : null,
          onDragOut: onDragOut ? (e, x0, y0) => onDragOut(defId, e, x0, y0) : null,
          onClose: close,
        }}
      />
      <div class="deck-viewer-caption">
        <b class="deck-viewer-name">
          {n > 1 ? `${n}× ` : ''}
          {a?.name || ''}
        </b>
        <span class="muted small">
          {view.i + 1} of {order.length}
        </span>
        {a?.back ? (
          <button class="btn" onClick={() => setView({ ...view, back: !view.back })}>
            Flip
          </button>
        ) : null}
      </div>
    </div>
  );
}
