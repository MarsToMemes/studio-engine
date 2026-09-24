/**
 * Documentary design tokens. Yellow = numbers, keywords, data; red =
 * conflict, danger, revelation; white = main text; near-black background.
 */
export const DOCUMENTARY_THEME = {
  background: '#121212',
  text: '#FFFFFF',
  accent: '#FFC72C',
  alert: '#DA291C',
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
} as const;

export type DocumentaryTheme = { readonly [K in keyof typeof DOCUMENTARY_THEME]: string };
