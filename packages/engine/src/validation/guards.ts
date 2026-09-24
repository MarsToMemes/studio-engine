export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isString = (v: unknown): v is string => typeof v === 'string';
export const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isInteger = (v: unknown): v is number => Number.isInteger(v);
export const isNonNegativeInteger = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
export const isPositiveInteger = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
export const isOneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && (values as readonly string[]).includes(v);
