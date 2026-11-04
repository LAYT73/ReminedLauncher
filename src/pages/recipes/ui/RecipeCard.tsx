import type { Ingredient, Recipe, RecipeLookup } from "@/entities/recipe";
import { ingredientItems, prettyType } from "@/entities/recipe";
import { useT } from "@/shared/i18n";
import { Slot } from "./Slot";

function ing(lookup: RecipeLookup, i: Ingredient | null | undefined) {
  const ids = ingredientItems(i, lookup.index.tags);
  return { ids, tag: i?.tag, count: i?.count ?? 1 };
}

function InSlot({ lookup, i, tick }: { lookup: RecipeLookup; i: Ingredient | null | undefined; tick: number }) {
  const v = ing(lookup, i);
  return <Slot ids={v.ids} tag={v.tag} count={v.count} tick={tick} />;
}

function Arrow() {
  return <span className="rcp-arrow" aria-hidden />;
}

function Flame() {
  return (
    <svg className="rcp-flame" viewBox="0 0 8 10" aria-hidden shapeRendering="crispEdges">
      <path fill="#d8761b" d="M3 0h1v2h1v2h1v2h1v3H1V6h1V3h1z" />
      <path fill="#f6c347" d="M3 5h2v1h1v3H2V6h1z" />
    </svg>
  );
}

function Outputs({ recipe, tick }: { recipe: Recipe; tick: number }) {
  return (
    <div className="rcp-outputs">
      {recipe.outputs.map((o, k) => (
        <Slot key={`${o.id}${k}`} ids={[o.id]} count={o.count} tick={tick} big />
      ))}
    </div>
  );
}

function gridCols(n: number) {
  return n <= 3 ? Math.max(1, n) : n <= 4 ? 2 : 3;
}

/** One recipe in its native layout. */
export function RecipeCard({ recipe, lookup, tick }: { recipe: Recipe; lookup: RecipeLookup; tick: number }) {
  const t = useT();
  const x = recipe.extras;
  let body;

  if (recipe.layout === "shaped" || recipe.layout === "shapeless") {
    const shaped = recipe.layout === "shaped";
    const cols = shaped ? Math.max(1, recipe.w ?? 3) : gridCols(recipe.inputs.length);
    body = (
      <div className="rcp-row">
        <div className="rcp-inputs" style={{ gridTemplateColumns: `repeat(${cols}, 40px)` }}>
          {recipe.inputs.map((i, k) => (
            <InSlot key={k} lookup={lookup} i={i} tick={tick} />
          ))}
        </div>
        <Arrow />
        <Outputs recipe={recipe} tick={tick} />
        {!shaped ? <span className="rcp-mark">{t("recipes.view.shapeless")}</span> : null}
      </div>
    );
  } else if (recipe.layout === "cooking") {
    body = (
      <>
        <div className="rcp-row">
          <div className="rcp-stack">
            <InSlot lookup={lookup} i={recipe.inputs[0]} tick={tick} />
            <Flame />
          </div>
          <Arrow />
          <Outputs recipe={recipe} tick={tick} />
        </div>
        <div className="rcp-meta">
          {x?.time != null ? <span>{t("recipes.view.seconds", { s: +x.time.toFixed(2) })}</span> : null}
          {x?.xp != null ? <span>{t("recipes.view.xp", { xp: x.xp })}</span> : null}
        </div>
      </>
    );
  } else if (recipe.layout === "stonecutting" || recipe.layout === "smithing") {
    body = (
      <div className="rcp-row">
        <div className="rcp-inline">
          {recipe.inputs.map((i, k) => (
            <InSlot key={k} lookup={lookup} i={i} tick={tick} />
          ))}
        </div>
        <Arrow />
        <Outputs recipe={recipe} tick={tick} />
      </div>
    );
  } else {
    const cols = Math.min(3, Math.max(1, recipe.inputs.length));
    const container = x?.container ? ing(lookup, x.container) : null;
    const tool = x?.tool ? ing(lookup, x.tool) : null;
    body = (
      <>
        <div className="rcp-row">
          <div className="rcp-inputs" style={{ gridTemplateColumns: `repeat(${cols}, 40px)` }}>
            {recipe.inputs.map((i, k) => (
              <InSlot key={k} lookup={lookup} i={i} tick={tick} />
            ))}
          </div>
          <Arrow />
          <Outputs recipe={recipe} tick={tick} />
        </div>
        {container || tool || x?.fluid || x?.time != null || x?.xp != null || x?.note ? (
          <div className="rcp-extras">
            {container ? (
              <div className="rcp-extra" title={t("recipes.view.container")}>
                <Slot ids={container.ids} tag={container.tag} count={container.count} tick={tick} />
              </div>
            ) : null}
            {tool ? (
              <div className="rcp-extra" title={t("recipes.view.tool")}>
                <Slot ids={tool.ids} tag={tool.tag} count={tool.count} tick={tick} />
              </div>
            ) : null}
            {x?.fluid ? (
              <div className="rcp-extra" title={t("recipes.view.fluid")}>
                <em className="rcp-chip">
                  {prettyType(x.fluid.id)} · {x.fluid.amount} mB
                </em>
              </div>
            ) : null}
            {x?.time != null ? (
              <div className="rcp-extra" title={t("recipes.view.time")}>
                <em className="rcp-chip">{t("recipes.view.seconds", { s: +x.time.toFixed(2) })}</em>
              </div>
            ) : null}
            {x?.xp != null ? (
              <div className="rcp-extra">
                <em className="rcp-chip">{t("recipes.view.xp", { xp: x.xp })}</em>
              </div>
            ) : null}
            {x?.note ? (
              <div className="rcp-extra" title={t("recipes.view.note")}>
                <em className="rcp-chip">{x.note}</em>
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="rcp-card">
      {body}
    </div>
  );
}
