/**
 * i18n README
 *
 * - Dictionaries: en/<namespace>.ts (source of truth) and ru/<namespace>.ts
 *   (typed `Dict<typeof en.<ns>>`, so TS errors on missing/extra keys).
 *   One file per namespace so parallel work never collides.
 * - Strings use `{name}` placeholders: t("pack.install.updatingTo", { v: "1.2" }).
 * - Counts use a plural object { one, few, many, other } (en: one/other) and
 *   a `count` param: t("x.items", { count: 3 }). `{count}` is substituted too.
 * - Keys are typed dotted paths: "<namespace>.<group>.<key>".
 * - React: `const t = useT();` (re-renders on locale change).
 *   Non-React: import { t } (reads current locale at call time).
 * - Missing ru value falls back to en, then to the key itself.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import type { Locale, Params, Paths, PluralForms } from "./types";
import * as en from "./en";
import * as ru from "./ru";

export type { Locale } from "./types";
export type Dictionary = typeof en;
export type TKey = Paths<Dictionary>;
export type TFunction = (key: TKey, params?: Params) => string;

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
];

const STORAGE_KEY = "remined.locale";
const DICTS: Record<Locale, unknown> = { en, ru };

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "ru";
}

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* ignore */
  }
  try {
    if (navigator.language?.toLowerCase().startsWith("ru")) return "ru";
  } catch {
    /* ignore */
  }
  return "en";
}

function syncDocument(locale: Locale) {
  try {
    document.documentElement.lang = locale;
  } catch {
    /* ignore */
  }
}

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    syncDocument(locale);
    set({ locale });
  },
}));

syncDocument(useLocaleStore.getState().locale);

/** Tell the Rust side which language to use for messages it returns. */
function syncBackend(locale: Locale) {
  try {
    call(CMD.setUiLocale, { locale }).catch(() => {
      /* browser / dev-offline: no Tauri */
    });
  } catch {
    /* ignore */
  }
}

syncBackend(useLocaleStore.getState().locale);
useLocaleStore.subscribe((s, prev) => {
  if (s.locale !== prev.locale) syncBackend(s.locale);
});

export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}

export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}

export function setLocale(locale: Locale): void {
  useLocaleStore.getState().setLocale(locale);
}

function lookup(dict: unknown, key: string): unknown {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function translate(locale: Locale, key: string, params?: Params): string {
  let raw = lookup(DICTS[locale], key);
  if (raw === undefined && locale !== "en") raw = lookup(DICTS.en, key);
  if (raw == null) return key;
  let str: string;
  if (typeof raw === "string") {
    str = raw;
  } else if (typeof raw === "object") {
    const forms = raw as Partial<PluralForms> & { other: string };
    const count = Number(params?.count ?? 0);
    const cat = new Intl.PluralRules(locale).select(count);
    str = (forms as Record<string, string | undefined>)[cat] ?? forms.other;
  } else {
    return key;
  }
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** Imperative translate using the current locale. */
export const t: TFunction = (key, params) =>
  translate(getLocale(), key, params);

/** Translate a key in an explicit locale (for matching text across locales). */
export function tIn(locale: Locale, key: TKey, params?: Params): string {
  return translate(locale, key, params);
}

/** React hook: returns a `t` bound to the current locale; re-renders on change. */
export function useT(): TFunction {
  const locale = useLocale();
  return useMemo<TFunction>(
    () => (key, params) => translate(locale, key, params),
    [locale],
  );
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), opts).format(n);
}

export function formatRelativeTime(date: Date | number | string): string {
  const ms = new Date(date).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  const sec = Math.round(ms / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(sec) >= secs) return rtf.format(Math.round(sec / secs), unit);
  }
  return rtf.format(sec, "second");
}

/** Duration given in hours, e.g. 0.5 -> "30 min" / "30 мин", 12.5 -> "12.5 h". */
export function formatDuration(hours: number): string {
  const locale = getLocale();
  if (hours < 1) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "minute",
      unitDisplay: "narrow",
      maximumFractionDigits: 0,
    }).format(Math.round(hours * 60));
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(hours);
}
