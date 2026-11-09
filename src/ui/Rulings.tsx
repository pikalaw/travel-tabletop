// A card's official rulings: loading them from storage, and the panel that shows them over the
// game's full view and over the card viewer (deck page, Tokens sheet).

import { useEffect, useRef, useState } from 'preact/hooks';
import { getRulings } from '../storage/db';
import { SWIPE_PX } from './cardGestures';
import type { CardText, Ruling } from '../types/storage';

/** A card's rulings from storage (none until loaded, or for a card without an oracle id). */
export function useRulings(oracleId: string | undefined): Ruling[] {
  const [got, setGot] = useState<{ id: string; list: Ruling[] } | null>(null);
  useEffect(() => {
    if (!oracleId) return;
    let live = true;
    getRulings(oracleId).then((r) => { if (live) setGot({ id: oracleId, list: r?.rulings ?? [] }); }).catch((e: unknown) => console.error(e));
    return () => { live = false; };
  }, [oracleId]);
  return got && got.id === oracleId ? got.list : [];
}

/**
 * The rulings panel, over the full view or the card viewer: the card's rules text, then each ruling with its date.
 * Scryfall's own notes are marked unofficial. It scrolls; Back (not Close: the footer's Close
 * closes the whole full view) or a swipe down on its header returns to the full view.
 */
export function RulingsPanel({ title, text, rulings, onClose }: { title: string; text: CardText | undefined; rulings: readonly Ruling[]; onClose: () => void }) {
  const y0 = useRef<{ y: number; id: number } | null>(null);
  return (
    // The swipe starts on the header and may end anywhere over the panel.
    <div
      class="rulings-panel"
      role="dialog"
      aria-label={`Rulings: ${title}`}
      onPointerUp={(e) => {
        const s = y0.current;
        y0.current = null;
        if (s && s.id === e.pointerId && e.clientY - s.y > SWIPE_PX) onClose();
      }}
      onPointerCancel={() => { y0.current = null; }}
    >
      <div class="rulings-head" onPointerDown={(e) => { y0.current = { y: e.clientY, id: e.pointerId }; }}>
        <b>Rulings: {title}</b>
        <button class="btn primary" onClick={onClose}>
          Back
        </button>
      </div>
      <div class="rulings-body">
        {(text?.faces || []).map((f) => (
          <div class="rulings-face">
            <b>{f.name}</b> <span class="muted">{f.typeLine}</span>
            {f.oracleText ? <p>{f.oracleText}</p> : null}
          </div>
        ))}
        <ol class="rulings-list">
          {rulings.map((r) => (
            <li>
              <span class="ruling-meta">
                {r.publishedAt}
                {r.source === 'wotc' ? '' : <span class="ruling-unofficial"> · Scryfall note (unofficial)</span>}
              </span>
              <p>{r.comment}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
