import { useEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import { PixelChevronLeftIcon, PixelChevronRightIcon, PixelSchematicIcon } from "@/shared/ui/PixelIcons";
import { disposeIconRenderer, startIconPipeline } from "../model/iconCache";
import { useSchematicsStore } from "../model/store";
import { useFileDrop } from "../model/useFileDrop";
import { useLayerKeys, usePanelKeys } from "../model/useLayerKeys";
import { useSchematicLoader } from "../model/useSchematicLoader";
import { CatalogGallery } from "./CatalogGallery";
import { DropOverlay } from "./DropOverlay";
import { LibraryPanel } from "./LibraryPanel";
import { MaterialsPanel } from "./MaterialsPanel";
import { SchematicViewport } from "./SchematicViewport";
import { SchematicsEmptyState } from "./SchematicsEmptyState";
import { StepsPanel } from "./StepsPanel";

export function SchematicsPage() {
  const t = useT();
  const entries = useSchematicsStore((s) => s.entries);
  const listLoaded = useSchematicsStore((s) => s.listLoaded);
  const selectedId = useSchematicsStore((s) => s.selectedId);
  const panelTab = useSchematicsStore((s) => s.panelTab);
  const setPanelTab = useSchematicsStore((s) => s.setPanelTab);
  const drawerOpen = useSchematicsStore((s) => s.drawerOpen);
  const setDrawerOpen = useSchematicsStore((s) => s.setDrawerOpen);
  const leftCollapsed = useSchematicsStore((s) => s.leftCollapsed);
  const rightCollapsed = useSchematicsStore((s) => s.rightCollapsed);
  const setRightCollapsed = useSchematicsStore((s) => s.setRightCollapsed);
  const source = useSchematicsStore((s) => s.source);
  const catalogStatus = useSchematicsStore((s) => s.catalogStatus);
  const inCatalog = source === "catalog";
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void useSchematicsStore.getState().refresh();
    return disposeIconRenderer;
  }, []);

  useEffect(() => {
    if (inCatalog && catalogStatus === "idle") void useSchematicsStore.getState().loadCatalog();
  }, [inCatalog, catalogStatus]);

  const dragging = useFileDrop((paths) => void useSchematicsStore.getState().importPaths(paths));
  const loader = useSchematicLoader(selectedId, attempt);
  const model = loader.status === "ready" ? loader.model : null;
  useLayerKeys(!!model);
  usePanelKeys(entries.length > 0 || inCatalog);

  useEffect(() => {
    if (model) useSchematicsStore.getState().setLayerCounts(model.layerCounts);
  }, [model]);

  useEffect(() => (model ? startIconPipeline(model) : undefined), [model]);

  const entry = entries.find((e) => e.id === selectedId) ?? null;
  const built = entry?.builtLayers ?? [];

  if (!listLoaded) return <div className="schem-page" />;

  return (
    <div className="schem-page">
      {entries.length === 0 && !inCatalog ? (
        <SchematicsEmptyState />
      ) : (
        <div
          className={`schem-layout ${drawerOpen ? "is-drawer-open" : ""} ${leftCollapsed ? "is-left-collapsed" : ""} ${rightCollapsed ? "is-right-collapsed" : ""} ${inCatalog ? "is-catalog" : ""}`}
        >
          <LibraryPanel />
          <main className="schem-center">
            {/* Stays mounted (display toggle) so the WebGL scene is not rebuilt. */}
            <div className={`schem-viewport-slot ${inCatalog ? "is-hidden" : ""}`}>
              <SchematicViewport loader={loader} built={built} onRetry={() => setAttempt((a) => a + 1)} />
            </div>
            {inCatalog ? <CatalogGallery /> : null}
            <button
              type="button"
              className="schem-drawer-toggle"
              aria-expanded={drawerOpen}
              aria-label={t("schematics.panel.toggle")}
              title={t("schematics.panel.toggle")}
              onClick={() => setDrawerOpen(!drawerOpen)}
            >
              <PixelSchematicIcon />
            </button>
          </main>
          <aside className={`schem-side ${rightCollapsed ? "is-collapsed" : ""}`}>
            <div className="schem-panel-inner">
              <div className="schem-side-head">
                <div className="schem-seg is-wide schem-side-tabs" role="tablist">
                  {(["materials", "steps"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={panelTab === id}
                      className={panelTab === id ? "is-active" : ""}
                      onClick={() => setPanelTab(id)}
                    >
                      {t(id === "materials" ? "schematics.panel.materials" : "schematics.panel.steps")}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="schem-icon-btn schem-side-collapse"
                  aria-label={t("schematics.panel.collapseRight")}
                  title={`${t("schematics.panel.collapseRight")} (])`}
                  onClick={() => setRightCollapsed(true)}
                >
                  <PixelChevronRightIcon />
                </button>
              </div>
              <div className="schem-side-body">
                {model && entry ? (
                  panelTab === "materials" ? (
                    <MaterialsPanel model={model} title={entry.name} />
                  ) : (
                    <StepsPanel built={built} />
                  )
                ) : null}
              </div>
            </div>
            <div className="schem-strip">
              <button
                type="button"
                className="schem-icon-btn"
                aria-label={t("schematics.panel.expandRight")}
                title={`${t("schematics.panel.expandRight")} (])`}
                onClick={() => setRightCollapsed(false)}
              >
                <PixelChevronLeftIcon />
              </button>
            </div>
          </aside>
        </div>
      )}
      {dragging ? <DropOverlay /> : null}
    </div>
  );
}
