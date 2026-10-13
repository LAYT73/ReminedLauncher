import { supabase, supabaseConfigured } from "./supabase";

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
};

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  return [];
}

export async function fetchCatalogFromSupabase(): Promise<CatalogPack[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase
    .from("packs")
    .select(
      "id,name,tagline,blurb,highlights,gallery,logo_url,wallpaper_url,is_default,sort_order,java_major",
    )
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return ((data as DbPack[]) ?? []).map((row) => ({
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
  }));
}

export function pickDefaultPack(packs: CatalogPack[]): CatalogPack | undefined {
  return packs.find((p) => p.is_default) ?? packs[0];
}
