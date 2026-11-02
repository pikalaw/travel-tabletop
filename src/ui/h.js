// Preact + htm: components written as tagged templates, no compile step.
import { h, render, Fragment } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer };

/** Re-render when a session (or any emitter with subscribe) changes. */
export function useSubscribe(target, method = 'subscribe') {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => (target ? target[method](() => bump()) : undefined), [target]);
}

/** Observe an element's size. */
export function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref.current]);
  return size;
}

/** Tiny global toast queue. */
const toastSubs = new Set();
let toasts = [];
let toastId = 1;
export function toast(text, kind = 'info', ms = 3500) {
  const t = { id: toastId++, text, kind };
  toasts = [...toasts.slice(-3), t];
  toastSubs.forEach((fn) => fn(toasts));
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); toastSubs.forEach((fn) => fn(toasts)); }, ms);
}
export function useToasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => { toastSubs.add(setList); return () => toastSubs.delete(setList); }, []);
  return list;
}

/** Promise-based prompt that works inside an installed PWA. */
export function ask(message, initial = '') {
  return Promise.resolve(window.prompt(message, initial));
}
