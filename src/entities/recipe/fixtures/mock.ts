import type { RecipeIndex, RecipeLocale, RecipeSource } from "../model/types";
import fixture from "./index.fixture.json";

/** Browser-only stand-ins for the Rust commands (see scripts/gen-recipe-fixture.mjs). */
export function mockSources(): RecipeSource[] {
  return [
    { packId: "vanilla-1.21.1", name: "Vanilla 1.21.1", mcVersion: "1.21.1", modCount: 3, kind: "instance" },
    { packId: "vanilla-1.20.1", name: "Vanilla 1.20.1", mcVersion: "1.20.1", modCount: 3, kind: "instance" },
  ];
}

export async function mockIndex(locale: RecipeLocale, packId: string): Promise<{ path: string; index: RecipeIndex }> {
  const index = await mockIndexData(locale);
  return { path: `mock:${packId}:${locale}:${new URLSearchParams(location.search).get("real") ?? ""}`, index };
}

async function mockIndexData(locale: RecipeLocale): Promise<RecipeIndex> {
  await new Promise((r) => setTimeout(r, 900));
  // Dev: `?real=<file>` loads dev-data/<file> (gitignored; served by the dev-only vite plugin).
  const real = new URLSearchParams(location.search).get("real");
  if (real) return (await (await fetch(`/__dev-data/${encodeURIComponent(real)}`)).json()) as RecipeIndex;
  const base = fixture.index as unknown as RecipeIndex;
  if (locale === "en") return { ...base, locale };
  const ru = fixture.ru as Record<string, string>;
  return { ...base, locale, items: base.items.map((i) => ({ ...i, name: ru[i.id] ?? i.name })) };
}
