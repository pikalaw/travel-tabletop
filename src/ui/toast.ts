// A tiny global toast queue.
import { useEffect, useState } from 'preact/hooks';

export type ToastKind = 'info' | 'warn' | 'big';
export interface Toast { id: number; text: string; kind: ToastKind }

const subs = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
let nextId = 1;

export function toast(text: string, kind: ToastKind = 'info', ms = 3500): void {
  const t = { id: nextId++, text, kind };
  toasts = [...toasts.slice(-3), t];
  subs.forEach((fn) => fn(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    subs.forEach((fn) => fn(toasts));
  }, ms);
}

export function useToasts(): Toast[] {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    subs.add(setList);
    return () => { subs.delete(setList); };
  }, []);
  return list;
}
