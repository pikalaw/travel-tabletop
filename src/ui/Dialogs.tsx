// In-app dialogs. The browser's confirm() and prompt() boxes always name the site
// ("pikalaw.github.io says") and block the page, so the app draws its own.
// One dialog shows at a time; later ones wait in a queue.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useOutsideTap } from './hooks';

interface DialogBase { title: string; body?: string; ok?: string; cancel?: string }
export interface ConfirmOptions extends DialogBase { danger?: boolean }
export interface PromptOptions extends DialogBase { value?: string; numeric?: boolean; placeholder?: string }
export interface CopyOptions { title: string; body?: string; value: string }

type Dialog =
  | (ConfirmOptions & { kind: 'confirm'; id: number; resolve: (v: boolean) => void })
  | (PromptOptions & { kind: 'prompt'; id: number; resolve: (v: string | null) => void })
  | (CopyOptions & { kind: 'copy'; ok: string; id: number; resolve: (v: undefined) => void });

const subs = new Set<(d: Dialog[]) => void>();
let dialogs: Dialog[] = [];
let nextId = 1;

function push(d: Dialog): void {
  dialogs = [...dialogs, d];
  subs.forEach((fn) => fn(dialogs));
}

function settle(d: Dialog, result: 'ok' | 'cancel', value?: string): void {
  if (!dialogs.some((x) => x.id === d.id)) return;
  dialogs = dialogs.filter((x) => x.id !== d.id);
  subs.forEach((fn) => fn(dialogs));
  if (d.kind === 'confirm') d.resolve(result === 'ok');
  else if (d.kind === 'prompt') d.resolve(result === 'ok' ? value ?? '' : null);
  else d.resolve(undefined);
}

function useDialogs(): Dialog[] {
  const [list, setList] = useState(dialogs);
  useEffect(() => {
    subs.add(setList);
    return () => { subs.delete(setList); };
  }, []);
  return list;
}

/** Ask a yes/no question. Resolves true for the OK button, false for Cancel or a tap outside. */
export function confirmBox(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => push({ ok: 'OK', cancel: 'Cancel', ...o, kind: 'confirm', id: nextId++, resolve }));
}

/** Ask for a line of text. Resolves the text for OK, null for Cancel or a tap outside. */
export function promptBox(o: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => push({ ok: 'OK', cancel: 'Cancel', value: '', ...o, kind: 'prompt', id: nextId++, resolve }));
}

/** Show text to copy by hand (when the clipboard is unavailable). Resolves when closed. */
export function copyBox(o: CopyOptions): Promise<undefined> {
  return new Promise((resolve) => push({ ok: 'Done', ...o, kind: 'copy', id: nextId++, resolve }));
}

/** Renders the front dialog. Mounted once at the app root. */
export function Dialogs() {
  const list = useDialogs();
  const d = list[0];
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  valueRef.current = value;
  // Layout effect: the key listener is in place before the browser can deliver another key.
  useLayoutEffect(() => {
    if (!d) return;
    setValue(d.kind === 'confirm' ? '' : d.value ?? '');
    (document.activeElement as HTMLElement | null)?.blur?.();
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.select(); } else okRef.current?.focus();
    });
    // Enter answers OK and Escape cancels, wherever the focus is.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(d, 'cancel'); }
      else if (e.key === 'Enter' && d.kind !== 'copy') { e.preventDefault(); settle(d, 'ok', valueRef.current); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d?.id]);
  const outside = useOutsideTap(() => { if (d) settle(d, 'cancel'); });
  if (!d) return null;
  const ok = () => settle(d, 'ok', value);
  const cancel = () => settle(d, 'cancel');
  return (
    <div class="confirm-screen" role="dialog" aria-modal="true" aria-label={d.title}
      {...outside}>
      <div class={`confirm-box plain ${d.kind === 'confirm' && d.danger ? 'danger' : ''}`}>
        <h3>{d.title}</h3>
        {d.body ? <p class="dialog-body">{d.body}</p> : null}
        {d.kind === 'prompt' ? (
          <input ref={inputRef} class="dialog-input" value={value} placeholder={d.placeholder || ''}
            inputMode={d.numeric ? 'numeric' : undefined} onInput={(e) => setValue(e.currentTarget.value)} />
        ) : null}
        {d.kind === 'copy' ? <textarea ref={inputRef} class="dialog-input copy" readOnly rows={4} value={d.value} /> : null}
        <div class="confirm-actions">
          {d.kind !== 'copy' ? <button class="btn" onClick={cancel}>{d.cancel}</button> : null}
          <button ref={okRef} class="btn yes" onClick={ok}>{d.ok}</button>
        </div>
      </div>
    </div>
  );
}
