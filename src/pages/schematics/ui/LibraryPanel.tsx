import { useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useT } from "@/shared/i18n";
import { PixelChevronLeftIcon, PixelChevronRightIcon, PixelMoreIcon, PixelPlusIcon } from "@/shared/ui/PixelIcons";
import type { SchematicEntry } from "@/entities/schematic";
import { openImportDialog } from "../model/importFlow";
import { useSchematicsStore } from "../model/store";
import { CatalogPanel } from "./CatalogPanel";

function progressOf(e: SchematicEntry) {
  const total = e.size[1];
  const done = e.builtLayers.filter((y) => y >= 0 && y < total).length;
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

async function askDelete(name: string, t: ReturnType<typeof useT>): Promise<boolean> {
  const message = t("schematics.library.deleteConfirm", { name });
  try {
    // window.confirm is non-blocking in Tauri/WKWebView — use the plugin dialog.
    return await confirm(message, {
      title: t("schematics.library.deleteTitle"),
      kind: "warning",
      okLabel: t("schematics.library.deleteOk"),
      cancelLabel: t("schematics.library.deleteCancel"),
    });
  } catch {
    return window.confirm(message);
  }
}

function Card({ entry }: { entry: SchematicEntry }) {
  const t = useT();
  const selected = useSchematicsStore((s) => s.selectedId === entry.id);
  const select = useSchematicsStore((s) => s.select);
  const rename = useSchematicsStore((s) => s.rename);
  const remove = useSchematicsStore((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.name);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { done, total, pct } = progressOf(entry);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [menu]);

  function startRename() {
    setMenu(false);
    setDraft(entry.name);
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    void rename(entry.id, draft);
  }

  return (
    <li
      className={`schem-card ${selected ? "is-selected" : ""}`}
      onClick={() => select(entry.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
      aria-current={selected}
    >
      <div className="schem-card-top">
        {editing ? (
          <input
            className="schem-card-input"
            value={draft}
            autoFocus
            aria-label={t("schematics.library.renameInput")}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
          />
        ) : (
          <button
            type="button"
            className="schem-card-name"
            title={entry.name}
            onDoubleClick={startRename}
          >
            {entry.name}
          </button>
        )}
        <div className="schem-card-menu" ref={menuRef}>
          <button
            type="button"
            className="schem-icon-btn"
            aria-label={t("schematics.library.more")}
            title={t("schematics.library.more")}
            onClick={(e) => {
              e.stopPropagation();
              setMenu((v) => !v);
            }}
          >
            <PixelMoreIcon />
          </button>
          {menu ? (
            <div className="schem-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" role="menuitem" onClick={startRename}>
                {t("schematics.library.rename")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenu(false);
                  void askDelete(entry.name, t).then((ok) => {
                    if (ok) void remove(entry.id);
                  });
                }}
              >
                {t("schematics.library.delete")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="schem-card-meta">
        <span className="schem-badge">{entry.format.toUpperCase()}</span>
        <span>{entry.size.join(" × ")}</span>
        <span>{t("schematics.library.blocks", { count: entry.blockCount })}</span>
      </div>
      {entry.catalogId ? (
        <div className="schem-card-meta">
          <span className="schem-badge is-catalog">{t("schematics.catalog.badge")}</span>
          {entry.author ? (
            <span className="schem-card-author" title={entry.author}>
              {entry.author}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="schem-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t("schematics.library.progress", { done, total })}
        title={t("schematics.library.progress", { done, total })}
      >
        <div className="schem-progress-bar">
          <span style={{ width: `${pct}%` }} className={pct === 100 ? "is-full" : ""} />
        </div>
        <span className="schem-progress-pct">{pct}%</span>
      </div>
    </li>
  );
}

export function LibraryPanel() {
  const t = useT();
  const entries = useSchematicsStore((s) => s.entries);
  const importing = useSchematicsStore((s) => s.importing);
  const collapsed = useSchematicsStore((s) => s.leftCollapsed);
  const setCollapsed = useSchematicsStore((s) => s.setLeftCollapsed);
  const source = useSchematicsStore((s) => s.source);
  const setSource = useSchematicsStore((s) => s.setSource);
  return (
    <aside className={`schem-library ${collapsed ? "is-collapsed" : ""}`}>
      <div className="schem-panel-inner">
        <div className="schem-source">
          <div className="schem-seg is-wide" role="tablist">
            {(["mine", "catalog"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={source === id}
                className={source === id ? "is-active" : ""}
                onClick={() => setSource(id)}
              >
                {t(id === "mine" ? "schematics.catalog.mine" : "schematics.catalog.tab")}
              </button>
            ))}
          </div>
          {source === "mine" ? null : (
            <button
              type="button"
              className="schem-icon-btn"
              aria-label={t("schematics.panel.collapseLeft")}
              title={`${t("schematics.panel.collapseLeft")} ([)`}
              onClick={() => setCollapsed(true)}
            >
              <PixelChevronLeftIcon />
            </button>
          )}
        </div>
        {source === "catalog" ? (
          <CatalogPanel />
        ) : (
          <>
        <header className="schem-panel-head">
          <h2>{t("schematics.library.title")}</h2>
          <button
            type="button"
            className="btn-mc ok schem-import-btn"
            disabled={importing}
            onClick={() => void openImportDialog()}
          >
            <PixelPlusIcon className="btn-pixel-icon" />
            {t("schematics.library.import")}
          </button>
          <button
            type="button"
            className="schem-icon-btn"
            aria-label={t("schematics.panel.collapseLeft")}
            title={`${t("schematics.panel.collapseLeft")} ([)`}
            onClick={() => setCollapsed(true)}
          >
            <PixelChevronLeftIcon />
          </button>
        </header>
        <ul className="schem-cards">
          {entries.map((e) => (
            <Card key={e.id} entry={e} />
          ))}
        </ul>
          </>
        )}
      </div>
      <div className="schem-strip">
        <button
          type="button"
          className="schem-icon-btn"
          aria-label={t("schematics.panel.expandLeft")}
          title={`${t("schematics.panel.expandLeft")} ([)`}
          onClick={() => setCollapsed(false)}
        >
          <PixelChevronRightIcon />
        </button>
        <button
          type="button"
          className="schem-icon-btn"
          aria-label={t("schematics.library.import")}
          title={t("schematics.library.import")}
          disabled={importing}
          onClick={() => void openImportDialog()}
        >
          <PixelPlusIcon />
        </button>
      </div>
    </aside>
  );
}
