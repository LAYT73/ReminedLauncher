import { useEffect, useMemo, useState } from "react";
import { groupRecipes, prettyType, type Recipe } from "@/entities/recipe";
import { useT } from "@/shared/i18n";
import { PixelChevronLeftIcon, PixelChevronRightIcon } from "@/shared/ui/PixelIcons";
import { useRecipesStore, type ViewMode } from "../model/store";
import { ItemIcon } from "./ItemIcon";
import { RecipeCard } from "./RecipeCard";

const NO_RECIPES: Recipe[] = [];

export function RecipeViewer() {
  const t = useT();
  const lookup = useRecipesStore((s) => s.lookup);
  const view = useRecipesStore((s) => s.view);
  const canBack = useRecipesStore((s) => s.history.length > 0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const recipes = useMemo(() => {
    if (!lookup || !view) return NO_RECIPES;
    return (view.mode === "recipes" ? lookup.recipesByOutput : lookup.recipesByInput).get(view.itemId) ?? NO_RECIPES;
  }, [lookup, view]);
  const groups = useMemo(() => groupRecipes(recipes), [recipes]);

  if (!lookup || !view) {
    return (
      <div className="rcp-viewer-empty">
        <p>{t("recipes.empty.pick")}</p>
      </div>
    );
  }

  const item = lookup.itemsById.get(view.itemId);
  const group = groups.find((g) => g.key === view.tab) ?? groups[0];
  const total = group?.recipes.length ?? 0;
  const page = Math.min(view.page, Math.max(0, total - 1));
  const recipe = group?.recipes[page];
  const store = useRecipesStore.getState();
  const setPage = (p: number) => store.setPage((p + total) % total);

  const modes: { id: ViewMode; label: string }[] = [
    { id: "recipes", label: t("recipes.view.craft") },
    { id: "uses", label: t("recipes.view.uses") },
  ];

  return (
    <div className="rcp-viewer">
      <div className="rcp-viewer-head">
        <button
          type="button"
          className="rcp-icon-btn"
          disabled={!canBack}
          aria-label={t("recipes.view.back")}
          title={`${t("recipes.view.back")} (Backspace)`}
          onClick={() => store.back()}
        >
          <PixelChevronLeftIcon />
        </button>
        <ItemIcon id={view.itemId} size={32} hot />
        <div className="rcp-viewer-title">
          <strong>{item?.name ?? view.itemId}</strong>
        </div>
      </div>

      <div className="schem-seg is-wide rcp-modes" role="tablist">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={view.mode === m.id}
            className={view.mode === m.id ? "is-active" : ""}
            onClick={() => store.open(view.itemId, m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="rcp-viewer-empty">
          <p>{t(view.mode === "recipes" ? "recipes.empty.noRecipes" : "recipes.empty.noUses")}</p>
        </div>
      ) : (
        <>
          <div className="rcp-tabs" role="tablist">
            {groups.map((g) => {
              const st = g.station ? lookup.itemsById.get(g.station) : undefined;
              const label = st ? `${st.name} · ${prettyType(g.type)}` : prettyType(g.type);
              return (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={g === group}
                  className={`rcp-tab${g === group ? " is-active" : ""}`}
                  title={label}
                  onClick={() => store.setTab(g.key)}
                >
                  {st ? <ItemIcon id={st.id} size={24} hot /> : <span className="rcp-tab-glyph">{prettyType(g.type)[0]}</span>}
                  <span className="rcp-tab-count">{g.recipes.length}</span>
                </button>
              );
            })}
          </div>
          <div className={`rcp-pager${total < 2 ? " is-hidden" : ""}`}>
            <button
              type="button"
              className="rcp-icon-btn"
              disabled={total < 2}
              aria-label={t("recipes.view.prev")}
              onClick={() => setPage(page - 1)}
            >
              <PixelChevronLeftIcon />
            </button>
            <span className="rcp-pager-num">{t("recipes.view.page", { n: page + 1, total })}</span>
            <button
              type="button"
              className="rcp-icon-btn"
              disabled={total < 2}
              aria-label={t("recipes.view.next")}
              onClick={() => setPage(page + 1)}
            >
              <PixelChevronRightIcon />
            </button>
          </div>
          <div className="rcp-card-wrap">
            {recipe ? <RecipeCard key={recipe.id} recipe={recipe} lookup={lookup} tick={tick} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
