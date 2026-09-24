/** Helpers for data-driven graphic layers (counters, charts). */

export interface CounterFormat {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Thousands separator, e.g. "," or " ". */
  separator?: string;
}

/** Value of an animated counter at a progress in [0, 1] (already eased). */
export function counterValue(from: number, to: number, progress: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, progress));
}

export function formatCounter(value: number, format: CounterFormat = {}): string {
  const decimals = format.decimals ?? 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = format.separator ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, format.separator) : int!;
  return `${value < 0 ? '-' : ''}${format.prefix ?? ''}${grouped}${frac ? `.${frac}` : ''}${format.suffix ?? ''}`;
}
