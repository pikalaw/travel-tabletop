// Small shared hooks.
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';

/** Re-render when a session (or anything with a subscribe method) changes. */
export function useSubscribe(target: { subscribe(fn: () => void): () => void } | null | undefined): void {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => (target ? target.subscribe(() => bump(undefined)) : undefined), [target]);
}

/** Observe an element's size. */
export function useSize(ref: RefObject<HTMLElement>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref.current]);
  return size;
}

/**
 * "Tap outside to close" for an overlay: props for its backdrop element. A tap counts only if the
 * press also started on the backdrop. On a touchscreen, the click that follows a tap goes to
 * whatever is under the finger when it lifts; when that tap is what opened the overlay, that is
 * the new backdrop, which would otherwise close the overlay the moment it opens.
 */
export function useOutsideTap(onOutside: () => void): {
  onPointerDown: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onClick: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
} {
  const pressed = useRef(false);
  return {
    onPointerDown: (e) => { pressed.current = e.target === e.currentTarget; },
    onClick: (e) => {
      const began = pressed.current;
      pressed.current = false;
      if (began && e.target === e.currentTarget) onOutside();
    },
  };
}
