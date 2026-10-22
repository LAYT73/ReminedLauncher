import { call } from "@/shared/api/invoke";
import { cacheCatalog, readOfflineCache } from "@/entities/session";
import { supabase, supabaseConfigured } from "@/shared/api/supabase";
import { CMD } from "@/shared/config/commands";
import { TABLE } from "@/shared/config/supabase";
import type { PackI18n } from "../model/types";

export type CatalogPack = {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  highlights: string[];
  gallery: string[];
  logo_url: string | null;
  wallpaper_url: string | null;
  is_default: boolean;
  sort_order: number;
  java_major: number;
  /** Raw per-locale copy overrides (packs.i18n); absent on old servers. */
  i18n?: PackI18n;
  /** Local install fields filled by launcher */
  version?: string;
  installed?: boolean;
};

type DbPack = {
  id: string;
  name: string;
  tagline: string | null;
  blurb: string | null;
  highlights: unknown;
  gallery: unknown;
  logo_url: string | null;
  wallpaper_url: string | null;
  is_default: boolean;
  sort_order: number;
  java_major: number;
  i18n?: unknown;
};

type GithubPackRelease = {
  id: string;
  name: string;
  version: string;
  java_major?: number | null;
  is_default?: boolean;
};

type GithubPackCatalog = {
  packs: GithubPackRelease[];
};

const PACK_COLUMNS =
  "id,name,tagline,blurb,highlights,gallery,logo_url,wallpaper_url,is_default,sort_order,java_major";

/** Postgres undefined_column (42703) or a message naming i18n. */
function isMissingI18nColumn(err: { code?: string; message?: string }): boolean {
  return err.code === "42703" || /i18n/i.test(err.message ?? "");
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function parseI18n(value: unknown): PackI18n | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: PackI18n = {};
  for (const [locale, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const entry: PackI18n[string] = {};
    if (typeof r.name === "string" && r.name.trim()) entry.name = r.name;
    if (typeof r.tagline === "string" && r.tagline.trim()) entry.tagline = r.tagline;
    if (typeof r.blurb === "string" && r.blurb.trim()) entry.blurb = r.blurb;
    const hl = asStringArray(r.highlights);
    if (hl.length > 0) entry.highlights = hl;
    if (Object.keys(entry).length > 0) out[locale] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapDbPack(row: DbPack): CatalogPack {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline ?? "",
    blurb: row.blurb ?? "",
    highlights: asStringArray(row.highlights),
    gallery: asStringArray(row.gallery),
    logo_url: row.logo_url,
    wallpaper_url: row.wallpaper_url,
    is_default: row.is_default,
    sort_order: row.sort_order,
    java_major: row.java_major,
    i18n: parseI18n(row.i18n),
  };
}

/** Minimal marketing row from GitHub release catalog (no art/copy). */
function mapGithubPack(pack: GithubPackRelease, index: number): CatalogPack {
  return {
    id: pack.id,
    name: pack.name || pack.id,
    tagline: "",
    blurb: "",
    highlights: [],
    gallery: [],
    logo_url: null,
    wallpaper_url: null,
    is_default: Boolean(pack.is_default),
    sort_order: index,
    java_major: pack.java_major ?? 21,
    version: pack.version,
  };
}

async function fetchCatalogFromGithub(): Promise<CatalogPack[]> {
  try {
    const cat = await call<GithubPackCatalog>(CMD.fetchPackCatalog);
    return (cat.packs ?? []).map(mapGithubPack);
  } catch {
    return [];
  }
}

/**
 * UI catalog: Supabase (art + copy) → offline cache → GitHub releases.
 * Fresh DMG installs often have an empty cache; GitHub keeps Download usable.
 */
export async function fetchCatalogFromSupabase(): Promise<CatalogPack[]> {
  if (supabaseConfigured) {
    try {
      const query = (cols: string) =>
        supabase
          .from(TABLE.packs)
          .select(cols)
          .eq("enabled", true)
          .order("sort_order", { ascending: true });
      let { data, error } = await query(`${PACK_COLUMNS},i18n`);
      // Migration 016 may not be applied yet: retry once without the column.
      if (error && isMissingI18nColumn(error)) {
        ({ data, error } = await query(PACK_COLUMNS));
      }
      if (error) throw error;
      const packs = ((data as unknown as DbPack[]) ?? []).map(mapDbPack);
      if (packs.length > 0) {
        cacheCatalog(packs);
        return packs;
      }
    } catch {
      /* fall through */
    }
  }

  const cached = readOfflineCache().catalog;
  if (cached.length > 0) return cached;

  const github = await fetchCatalogFromGithub();
  if (github.length > 0) cacheCatalog(github);
  return github;
}

export function pickDefaultPack(packs: CatalogPack[]): CatalogPack | undefined {
  return packs.find((p) => p.is_default) ?? packs[0];
}
