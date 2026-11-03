// Small shared hooks.
import { useEffect, useLayoutEffect, useReducer, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

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
