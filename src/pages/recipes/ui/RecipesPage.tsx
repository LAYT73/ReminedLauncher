import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { useRail } from "@/shared/lib/useRoute";
import { searchItems } from "@/entities/recipe";
import { useLocale, useT } from "@/shared/i18n";
import { EmptyState } from "@/shared/ui/EmptyState";
import { McSelect } from "@/shared/ui/McSelect";
import { useCurrentPackId } from "@/entities/pack";
import { useRecipesStore } from "../model/store";
import { useRecipeKeys } from "../model/useRecipeKeys";
import { ItemGrid } from "./ItemGrid";
import { ItemTooltip } from "./ItemTooltip";
import { RecipeViewer } from "./RecipeViewer";

function Browser() {
  const t = useT();
  const lookup = useRecipesStore((s) => s.lookup)!;
  const query = useRecipesStore((s) => s.query);
  const modFilter = useRecipesStore((s) => s.modFilter);
  const deferred = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  useRecipeKeys(searchRef);

  const results = useMemo(() => searchItems(lookup, deferred, modFilter || null), [lookup, deferred, modFilter]);
  const modOptions = useMemo(() => {
    const used = new Set(lookup.items.map((i) => i.mod));
    return [
      { id: "", label: t("recipes.mod.all") },
      ...lookup.index.mods.filter((m) => used.has(m.id)).map((m) => ({ id: m.id, label: m.name })),
    ];
  }, [lookup, t]);
  const store = useRecipesStore.getState();

  return (
    <div className="rcp-layout">
      <section className="rcp-main">
        <div className="rcp-toolbar">
          <input
            ref={searchRef}
            className="schem-search rcp-search"
            type="search"
            value={query}
            placeholder={t("recipes.search.placeholder")}
            aria-label={t("recipes.search.label")}
            title={t("recipes.keys.hint")}
            spellCheck={false}
            onChange={(e) => store.setQuery(e.target.value)}
          />
          <McSelect
            className="rcp-select"
            label={t("recipes.mod.label")}
            options={modOptions}
            value={modFilter}
            menuPlacement="down"
            onChange={store.setModFilter}
          />
          {deferred || modFilter ? <span className="rcp-count">{t("recipes.count", { count: results.length })}</span> : null}
        </div>
        {results.length === 0 ? (
          <div className="rcp-grid-empty">
            <p>{t("recipes.empty.noItems")}</p>
          </div>
        ) : (
          <ItemGrid items={results} />
        )}
      </section>
      <aside className="rcp-side">
        <RecipeViewer />
      </aside>
      <ItemTooltip />
    </div>
  );
}

export function RecipesPage() {
  const t = useT();
  const locale = useLocale();
  const rail = useRail();
  const selectedId = useCurrentPackId(rail);
  const sources = useRecipesStore((s) => s.sources);
  const sourcesLoaded = useRecipesStore((s) => s.sourcesLoaded);
  const sourcesError = useRecipesStore((s) => s.sourcesError);
  const packId = useRecipesStore((s) => s.packId);
  const status = useRecipesStore((s) => s.status);
  const error = useRecipesStore((s) => s.error);
  const store = useRecipesStore.getState();
  const source = sources.find((s) => s.packId === selectedId);

  useEffect(() => {
    void useRecipesStore.getState().initSources();
    return () => useRecipesStore.getState().setTip(null);
  }, []);

  // Follow the sidebar selection; only packs with a client jar can be read.
  useEffect(() => {
    useRecipesStore.getState().setPack(source ? source.packId : null);
  }, [source?.packId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (packId) void useRecipesStore.getState().load(locale);
  }, [packId, locale]);

  if (!sourcesLoaded) return <div className="rcp-page" />;

  if (!source) {
    return (
      <div className="rcp-page">
        <div className="rcp-center">
          {sourcesError ? (
            <div className="schem-error">
              <strong>{t("recipes.error.title")}</strong>
              <p>{t("recipes.error.sources", { error: sourcesError })}</p>
              <button type="button" className="btn-mc ok" onClick={() => void store.initSources()}>
                {t("recipes.error.retry")}
              </button>
            </div>
          ) : (
            <EmptyState
              kind="installations"
              title={t(sources.length > 0 ? "recipes.empty.notInstalledTitle" : "recipes.empty.noPacksTitle")}
              description={t(sources.length > 0 ? "recipes.empty.notInstalledBody" : "recipes.empty.noPacksBody")}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rcp-page">
      {status === "ready" ? (
        <Browser />
      ) : status === "error" ? (
        <div className="rcp-center">
          <div className="schem-error">
            <strong>{t("recipes.error.title")}</strong>
            <p>{error}</p>
            <button type="button" className="btn-mc ok" onClick={() => void store.load(locale, true)}>
              {t("recipes.error.retry")}
            </button>
          </div>
        </div>
      ) : (
        <div className="rcp-center">
          <div className="schem-loading">
            <p>{t("recipes.loading.title")}</p>
            <div className="schem-progress-bar is-wide is-indeterminate">
              <span />
            </div>
            <p className="rcp-loading-hint">{t("recipes.loading.hint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
