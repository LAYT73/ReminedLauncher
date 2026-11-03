import { useMemo } from "react";
import { useLocale, useT } from "@/shared/i18n";
import { useSchematicsStore } from "../model/store";
import { localized, matchesQuery } from "../model/catalog";

/** Left panel in catalog mode: search + category list with counts. */
export function CatalogPanel() {
  const t = useT();
  const locale = useLocale();
  const catalog = useSchematicsStore((s) => s.catalog);
  const category = useSchematicsStore((s) => s.catalogCategory);
  const query = useSchematicsStore((s) => s.catalogQuery);
  const setCategory = useSchematicsStore((s) => s.setCatalogCategory);
  const setQuery = useSchematicsStore((s) => s.setCatalogQuery);

  // Counts follow the search so empty categories are visible at a glance.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let all = 0;
    for (const item of catalog?.items ?? []) {
      if (!matchesQuery(item, query, locale)) continue;
      all++;
      map.set(item.category, (map.get(item.category) ?? 0) + 1);
    }
    return { all, map };
  }, [catalog, query, locale]);

  const rows = [
    { id: "all", name: t("schematics.catalog.all"), count: counts.all },
    ...(catalog?.categories ?? []).map((c) => ({
      id: c.id,
      name: localized(c.name, locale) || c.id,
      count: counts.map.get(c.id) ?? 0,
    })),
  ];

  return (
    <>
      <div className="schem-catalog-search">
        <input
          type="search"
          value={query}
          placeholder={t("schematics.catalog.search")}
          aria-label={t("schematics.catalog.search")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) setQuery("");
            e.stopPropagation();
          }}
        />
      </div>
      <ul className="schem-cats" aria-label={t("schematics.catalog.categories")}>
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`schem-cat ${category === r.id ? "is-active" : ""}`}
              aria-pressed={category === r.id}
              onClick={() => setCategory(r.id)}
            >
              <span className="schem-cat-name">{r.name}</span>
              <span className="schem-cat-count">{r.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
