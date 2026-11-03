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

/*
 * In-app dialogs. The browser's confirm() and prompt() boxes always name the site
 * ("pikalaw.github.io says") and block the page, so the app draws its own.
 * One dialog shows at a time; later ones wait in a queue.
 */
const dialogSubs = new Set();
let dialogs = [];
let dialogId = 1;
function pushDialog(d) {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { ...d, id: dialogId++, resolve }];
    dialogSubs.forEach((fn) => fn(dialogs));
  });
}
/** Close the front dialog with a result. */
export function settleDialog(id, result) {
  const d = dialogs.find((x) => x.id === id);
  if (!d) return;
  dialogs = dialogs.filter((x) => x.id !== id);
  dialogSubs.forEach((fn) => fn(dialogs));
  d.resolve(result);
}
export function useDialogs() {
  const [list, setList] = useState(dialogs);
  useEffect(() => { dialogSubs.add(setList); return () => dialogSubs.delete(setList); }, []);
  return list;
}
/**
 * Ask a yes/no question. Resolves true for the OK button, false for Cancel or a tap outside.
 * @param {{ title: string, body?: string, ok?: string, cancel?: string, danger?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function confirmBox(o) { return pushDialog({ kind: 'confirm', ok: 'OK', cancel: 'Cancel', ...o }); }
/**
 * Ask for a line of text. Resolves the text for OK, null for Cancel or a tap outside.
 * @param {{ title: string, body?: string, value?: string, ok?: string, cancel?: string, numeric?: boolean, placeholder?: string }} o
 * @returns {Promise<string | null>}
 */
export function promptBox(o) { return pushDialog({ kind: 'prompt', ok: 'OK', cancel: 'Cancel', value: '', ...o }); }
/**
 * Show text to copy by hand (when the clipboard is unavailable). Resolves when closed.
 * @param {{ title: string, body?: string, value: string }} o
 */
export function copyBox(o) { return pushDialog({ kind: 'copy', ok: 'Done', ...o }); }

/** Promise-based text prompt (kept for callers); uses the in-app dialog. */
export function ask(message, initial = '') {
  return promptBox({ title: message, value: initial });
}

/** Renders the front dialog. Mounted once at the app root. */
export function Dialogs() {
  const list = useDialogs();
  const d = list[0];
  const inputRef = useRef(null);
  const okRef = useRef(null);
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  valueRef.current = value;
  // Layout effect: the key listener is in place before the browser can deliver another key.
  useLayoutEffect(() => {
    if (!d) return;
    setValue(d.value ?? '');
    /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.();
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.select(); } else okRef.current?.focus();
    });
    // Enter answers OK and Escape cancels, wherever the focus is.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); settleDialog(d.id, d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined); }
      else if (e.key === 'Enter' && d.kind !== 'copy') { e.preventDefault(); settleDialog(d.id, d.kind === 'confirm' ? true : valueRef.current); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d?.id]);
  if (!d) return null;
  const cancelResult = d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined;
  const ok = () => settleDialog(d.id, d.kind === 'confirm' ? true : d.kind === 'prompt' ? value : undefined);
  const cancel = () => settleDialog(d.id, cancelResult);
  return html`<div class="confirm-screen" role="dialog" aria-modal="true" aria-label=${d.title}
      onClick=${(e) => { if (e.target === e.currentTarget) cancel(); }}>
    <div class="confirm-box plain ${d.danger ? 'danger' : ''}">
      <h3>${d.title}</h3>
      ${d.body ? html`<p class="dialog-body">${d.body}</p>` : null}
      ${d.kind === 'prompt' ? html`<input ref=${inputRef} class="dialog-input" value=${value} placeholder=${d.placeholder || ''}
          inputmode=${d.numeric ? 'numeric' : null} onInput=${(e) => setValue(e.currentTarget.value)}/>` : null}
      ${d.kind === 'copy' ? html`<textarea ref=${inputRef} class="dialog-input copy" readonly rows="4">${d.value}</textarea>` : null}
      <div class="confirm-actions">
        ${d.kind !== 'copy' ? html`<button class="btn" onClick=${cancel}>${d.cancel}</button>` : null}
        <button ref=${okRef} class="btn yes" onClick=${ok}>${d.ok}</button>
      </div>
    </div>
  </div>`;
}
