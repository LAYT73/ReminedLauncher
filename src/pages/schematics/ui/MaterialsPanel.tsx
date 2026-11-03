import { useMemo, useState } from "react";
import { useT } from "@/shared/i18n";
import { toast } from "@/shared/lib/toast";
import { PixelCopyIcon } from "@/shared/ui/PixelIcons";
import type { MaterialLine } from "@/entities/schematic";
import { formatStacks } from "../model/format";
import { useIcon } from "../model/iconStore";
import { useSchematicsStore } from "../model/store";
import type { SchematicModel } from "../model/useSchematicLoader";

/** Reads the icon synchronously from the pipeline's store; neutral placeholder until it exists. */
function MatIcon({ name }: { name: string }) {
  const url = useIcon(name);
  return url ? (
    <img className="schem-mat-icon" src={url} alt="" width={32} height={32} />
  ) : (
    <span className="schem-mat-icon is-placeholder" aria-hidden />
  );
}

export function MaterialsPanel({ model, title }: { model: SchematicModel; title: string }) {
  const t = useT();
  const scope = useSchematicsStore((s) => s.matScope);
  const setScope = useSchematicsStore((s) => s.setMatScope);
  const layer = useSchematicsStore((s) => s.layer);
  const collected = useSchematicsStore((s) => s.collected);
  const toggleCollected = useSchematicsStore((s) => s.toggleCollected);
  const [query, setQuery] = useState("");

  const lines: MaterialLine[] =
    scope === "total" ? model.list.total : (model.list.layers[layer] ?? []);
  const scopeKey = scope === "total" ? "t" : String(layer);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) => l.displayName.toLowerCase().includes(q) || l.name.toLowerCase().includes(q),
    );
  }, [lines, query]);

  async function copy() {
    const scopeLabel =
      scope === "total"
        ? t("schematics.materials.listTotal")
        : t("schematics.materials.listLayer", { n: layer + 1 });
    const body = lines.map((l) => {
      const st = formatStacks(l.name, l.count);
      return `${l.displayName}: ${l.count}${st ? ` (${st})` : ""}`;
    });
    const text = [`${t("schematics.materials.listHeader", { name: title })} (${scopeLabel})`, ...body].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast(t("schematics.materials.copied"), "ok");
    } catch {
      toast(t("schematics.materials.copyFailed"), "err");
    }
  }

  return (
    <div className="schem-materials">
      <div className="schem-seg is-wide" role="group">
        {(["layer", "total"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={scope === s ? "is-active" : ""}
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
          >
            {s === "layer" ? t("schematics.materials.thisLayer") : t("schematics.materials.total")}
          </button>
        ))}
      </div>
      <input
        className="schem-search"
        type="search"
        value={query}
        placeholder={t("schematics.materials.search")}
        aria-label={t("schematics.materials.search")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="schem-mat-list">
        {filtered.map((l) => {
          const key = `${scopeKey}:${l.name}`;
          const done = !!collected[key];
          const stacks = formatStacks(l.name, l.count);
          return (
            <li key={l.name} className={`schem-mat ${done ? "is-done" : ""}`}>
              <label className="schem-mat-check" title={t("schematics.materials.collected")}>
                <input type="checkbox" checked={done} onChange={() => toggleCollected(key)} />
                <span aria-hidden />
              </label>
              <MatIcon name={l.name} />
              <span className="schem-mat-name" title={l.displayName}>
                {l.displayName}
              </span>
              <span className="schem-mat-count">
                <strong>{l.count}</strong>
                {stacks ? <small>{stacks}</small> : null}
              </span>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="schem-mat-empty">
            {lines.length === 0
              ? t("schematics.materials.nothing")
              : t("schematics.materials.noMatch")}
          </li>
        ) : null}
      </ul>
      <button
        type="button"
        className="btn-mc dim schem-copy-btn"
        disabled={lines.length === 0}
        onClick={() => void copy()}
      >
        <PixelCopyIcon className="btn-pixel-icon" />
        {t("schematics.materials.copy")}
      </button>
    </div>
  );
}
