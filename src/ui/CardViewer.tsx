// A full-screen viewer for stored card definitions (no game state): the deck page and the Tokens sheet.

import { useEffect } from 'preact/hooks';
import { useOutsideTap } from './hooks';
import { artUrl, type Art } from '../storage/art';

export interface CardView { i: number; back: boolean }

/**
 * Full-screen view of one stored card (a deck's card, or a token in the Tokens sheet): large image,
 * flip for double-faced cards, previous / next through `order`, close by tapping the picture,
 * outside, or Escape. `counts` shows "3×" for repeated cards.
 */
export function CardViewer({ art, order, counts, view, setView }: { art: ReadonlyMap<string, Art>; order: readonly string[]; counts: ReadonlyMap<string, number>; view: CardView; setView: (v: CardView | null) => void }) {
  const outside = useOutsideTap(() => setView(null));
  const defId = order[view.i]!;
  const a = art.get(defId);
  const step = (d: number) =>
    setView({
      i: (view.i + d + order.length) % order.length,
      back: false,
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(null);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [view.i]);
  const url = a ? artUrl(a, view.back && a.back ? 'back' : 'front', 'large') : null;
  const n = counts.get(defId) || 1;
  return (
    <div
      class="deck-viewer"
      role="dialog"
      aria-label={a?.name || 'Card'}
      {...outside}
    >
      <div class="deck-viewer-img" onClick={() => setView(null)}>
        {url ? (
          <img src={url} alt={a!.name} />
        ) : (
          <div class="card-face missing big">
            <span>{a?.name || '…'}</span>
          </div>
        )}
      </div>
      <div class="deck-viewer-bar">
        <button class="btn" onClick={() => step(-1)} disabled={order.length < 2} aria-label="Previous card">
          ‹
        </button>
        <span class="deck-viewer-name">
          {n > 1 ? `${n}× ` : ''}
          {a?.name || ''}{' '}
          <span class="muted small">
            {view.i + 1} / {order.length}
          </span>
        </span>
        {a?.back ? (
          <button
            class="btn"
            onClick={() =>
              setView({
                ...view,
                back: !view.back,
              })
            }
          >
            Flip
          </button>
        ) : null}
        <button class="btn" onClick={() => step(1)} disabled={order.length < 2} aria-label="Next card">
          ›
        </button>
        <button class="btn primary" onClick={() => setView(null)}>
          Close
        </button>
      </div>
    </div>
  );
}
