import type { Easing } from '../model/primitives.js';
import type { PresetCategory, PresetDefinition, PresetParams } from './types.js';

/** Typed accessors for resolved (already validated) params inside `build`. */
export const param = {
  num: (params: PresetParams, key: string): number => params[key] as number,
  str: <T extends string = string>(params: PresetParams, key: string): T => params[key] as T,
  bool: (params: PresetParams, key: string): boolean => params[key] as boolean,
  easing: (params: PresetParams, key: string): Easing => params[key] as unknown as Easing,
};

/** Identity helper that keeps the category literal type. */
export const definePreset = <C extends PresetCategory>(preset: PresetDefinition<C>): PresetDefinition<C> => preset;
