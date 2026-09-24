export type IdGenerator = (prefix: string) => string;

/** Random ids (UUID v4 when available). Use for interactive editing. */
export const randomIds: IdGenerator = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
};

/**
 * Deterministic ids: `scene_1`, `scene_2`, `layer_1`… Use for generated
 * content so the same input produces the same project (stable diffs, caching).
 */
export function sequentialIds(namespace = ''): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return namespace ? `${namespace}_${prefix}_${n}` : `${prefix}_${n}`;
  };
}
