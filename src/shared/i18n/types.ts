export type Locale = "en" | "ru";

/** Plural leaf: picked by `params.count` via Intl.PluralRules. */
export interface PluralForms {
  one: string;
  few: string;
  many: string;
  other: string;
}

/** English plural forms only need one/other; ru must supply all four. */
export interface EnPluralForms {
  one: string;
  other: string;
}

/**
 * Shape a translation must mirror: same keys, strings stay strings, plural
 * objects become full PluralForms. TS errors on missing/extra keys.
 */
export type Dict<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends { other: string }
      ? PluralForms
      : Dict<T[K]>;
};

type Prev = [never, 0, 1, 2, 3, 4];

/** Dotted paths to string/plural leaves, depth-capped to keep tsc fast. */
export type Paths<T, D extends number = 4> = [D] extends [never]
  ? never
  : T extends string
    ? never
    : {
        [K in keyof T & string]: T[K] extends string | { other: string }
          ? K
          : `${K}.${Paths<T[K], Prev[D]>}`;
      }[keyof T & string];

export type Params = Record<string, string | number>;
