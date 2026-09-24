/**
 * Undo / redo for the plan. Edits sharing a `group` key (e.g. typing in the
 * same text field, one drag gesture) coalesce into a single undo step.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Group of the last committed edit. */
  group?: string;
}

export const HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commit<T>(h: History<T>, next: T, group?: string): History<T> {
  if (next === h.present) return h;
  if (group !== undefined && group === h.group) return { ...h, present: next, future: [] };
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return group !== undefined ? { past, present: next, future: [], group } : { past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...future] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future };
}

/** Ends coalescing: the next edit starts a new undo step even with the same group. */
export function seal<T>(h: History<T>): History<T> {
  if (h.group === undefined) return h;
  const { group: _group, ...rest } = h;
  return rest;
}
