// The gestures on a full-screen card, shared by the full view and the card viewer (deck page,
// Tokens sheet): a tap, a sideways swipe to the previous or next card, a drag up that hands the
// moving pointer to a board drag, and a swipe down that closes.

import { useRef } from 'preact/hooks';
import type { JSX } from 'preact';

/** How far a finger moves before a swipe or a swipe down counts. */
export const SWIPE_PX = 50;
/** How far up a finger moves before a drag up hands off to the board. */
export const DRAG_OUT_PX = 40;
/** Under this, a press is a tap. */
export const TAP_PX = 8;

export interface CardGestures {
  onTap?: (() => void) | null;
  /** A swipe right. */
  onPrev?: (() => void) | null;
  /** A swipe left. */
  onNext?: (() => void) | null;
  /** A drag up: the moving pointer, which went down at (x0, y0). */
  onDragOut?: ((e: PointerEvent, x0: number, y0: number) => void) | null;
  /** A swipe down. */
  onClose?: (() => void) | null;
}

type Handler = (e: JSX.TargetedPointerEvent<HTMLElement>) => void;

/** Pointer handlers to spread on the card's element (which should be `touch-action: none`). */
export function useCardGestures(g: CardGestures): { onPointerDown: Handler; onPointerMove: Handler; onPointerUp: Handler; onPointerCancel: Handler } {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  return {
    onPointerDown: (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      // Keep the pointer's events here until it is released, so a swipe that ends past the card's
      // edge still counts (a finger is captured this way already; a mouse is not).
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const s0 = start.current;
      if (!s0 || !g.onDragOut || e.pointerId !== s0.id) return;
      const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
      if (-dy > DRAG_OUT_PX && -dy > 1.5 * Math.abs(dx)) {
        start.current = null;
        // The board takes the pointer from here.
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        g.onDragOut(e, s0.x, s0.y);
      }
    },
    onPointerUp: (e) => {
      const s0 = start.current;
      start.current = null;
      if (!s0 || e.pointerId !== s0.id) return;
      const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
      if (Math.abs(dx) < TAP_PX && Math.abs(dy) < TAP_PX) g.onTap?.();
      else if (dy > SWIPE_PX && dy > 1.5 * Math.abs(dx)) g.onClose?.();
      else if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= Math.abs(dy)) (dx < 0 ? g.onNext : g.onPrev)?.();
    },
    onPointerCancel: () => { start.current = null; },
  };
}
