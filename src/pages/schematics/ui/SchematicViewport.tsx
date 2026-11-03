import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Kbd, KbdMouse } from "@/shared/ui/Kbd";
import { PixelChevronDownIcon, PixelRulerIcon } from "@/shared/ui/PixelIcons";
import { useLocale, useT } from "@/shared/i18n";
import { prettifyId } from "@/entities/schematic";
import { useSchematicsStore } from "../model/store";
import { tapeLabel, tapeMetrics, type TapeState } from "../model/measure";
import { useMoveKeys, useTapeKeys } from "../model/useLayerKeys";
import type { LoaderState, SchematicModel } from "../model/useSchematicLoader";
import { iconKeyFor, prioritizeIcon } from "../model/iconCache";
import { useIcon } from "../model/iconStore";
import { ASSETS_VERSION } from "../model/useSchematicLoader";
import { LayerControls } from "./LayerControls";
import { SchematicScene, type HoverInfo } from "./scene/SchematicScene";

type SegOption<T extends string> = { id: T; label: string };

function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="schem-seg" role="group" aria-label={label} title={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? "is-active" : ""}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`schem-tool ${on ? "is-active" : ""}`}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type ArrowDir = "left" | "right" | "up" | "down" | "rollLeft" | "rollRight";

/** Pixel-style chevrons / curved arrows (12x12 grid, crisp edges). */
const ARROW_PATHS: Record<ArrowDir, string> = {
  left: "M7 2h2v2H7zM5 4h2v2H5zM3 6h2v2H3zM5 8h2v2H5zM7 10h2v2H7z",
  right: "M3 2h2v2H3zM5 4h2v2H5zM7 6h2v2H7zM5 8h2v2H5zM3 10h2v2H3z",
  up: "M6 3h2v2H6zM4 5h2v2H4zM8 5h2v2H8zM2 7h2v2H2zM10 7h2v2h-2z",
  down: "M2 3h2v2H2zM10 3h2v2h-2zM4 5h2v2H4zM8 5h2v2H8zM6 7h2v2H6z",
  rollLeft: "M2 2h2v2H2zM4 4h2v2H4zM2 4h2v2H2zM6 2h4v2H6zM10 4h2v4h-2zM8 8h2v2H8z",
  rollRight: "M10 2h2v2h-2zM8 4h2v2H8zM10 4h2v2h-2zM2 2h4v2H2zM2 4h2v4H2zM4 8h2v2H4z",
};

/** Blender-style rotation arrows around the view cube. Roll arrows exist in Top / Bottom views only. */
function CubeArrows({ pole, scene }: { pole: "top" | "bottom" | null; scene: SchematicScene | null }) {
  const t = useT();
  const items: Array<{ dir: ArrowDir; label: string; run: () => void }> = [
    { dir: "up", label: t("schematics.viewport.cube.orbitUp"), run: () => scene?.orbitStep(0, -1) },
    { dir: "down", label: t("schematics.viewport.cube.orbitDown"), run: () => scene?.orbitStep(0, 1) },
    { dir: "left", label: t("schematics.viewport.cube.orbitLeft"), run: () => scene?.orbitStep(-1, 0) },
    { dir: "right", label: t("schematics.viewport.cube.orbitRight"), run: () => scene?.orbitStep(1, 0) },
  ];
  if (pole) {
    items.push(
      { dir: "rollLeft", label: t("schematics.viewport.cube.rollLeft"), run: () => scene?.rollStep(-1) },
      { dir: "rollRight", label: t("schematics.viewport.cube.rollRight"), run: () => scene?.rollStep(1) },
    );
  }
  return (
    <div className="schem-cube-arrows">
      {items.map((a) => (
        <button
          key={a.dir}
          type="button"
          tabIndex={-1}
          className={`schem-cube-arrow is-${a.dir}`}
          aria-label={a.label}
          title={a.label}
          onClick={a.run}
        >
          <svg viewBox="0 0 14 14" aria-hidden shapeRendering="crispEdges">
            <path d={ARROW_PATHS[a.dir]} fill="currentColor" />
          </svg>
        </button>
      ))}
    </div>
  );
}

/** Popover listing every viewport hotkey. */
function HotkeyHelp() {
  const t = useT();
  const lmb = <KbdMouse label={t("schematics.keys.lmb")} />;
  const rows: Array<[ReactNode, string]> = [
    [
      <>
        <Kbd>W</Kbd>
        <Kbd>A</Kbd>
        <Kbd>S</Kbd>
        <Kbd>D</Kbd>
      </>,
      t("schematics.viewport.help.move"),
    ],
    [
      <>
        <Kbd>Q</Kbd>
        <Kbd>E</Kbd>
      </>,
      t("schematics.viewport.help.vertical"),
    ],
    [<Kbd>Shift</Kbd>, t("schematics.viewport.help.fast")],
    [
      <>
        {lmb}
        {t("schematics.viewport.help.drag")}
      </>,
      t("schematics.viewport.help.orbit"),
    ],
    [
      <>
        <Kbd>{t("schematics.keys.rmb")}</Kbd>/<Kbd>{t("schematics.keys.mmb")}</Kbd>
      </>,
      t("schematics.viewport.help.pan"),
    ],
    [<Kbd>{t("schematics.keys.wheel")}</Kbd>, t("schematics.viewport.help.zoom")],
    [
      <>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
      </>,
      t("schematics.viewport.help.layer"),
    ],
    [<Kbd>Space</Kbd>, t("schematics.viewport.help.built")],
    [<Kbd>M</Kbd>, t("schematics.viewport.help.tape")],
    [
      <>
        <Kbd>[</Kbd>
        <Kbd>]</Kbd>
      </>,
      t("schematics.viewport.help.panels"),
    ],
  ];
  return (
    <div className="schem-help" role="dialog" aria-label={t("schematics.viewport.help.title")}>
      <strong className="schem-help-title">{t("schematics.viewport.help.title")}</strong>
      <div className="schem-keys">
        {rows.map(([keys, label], i) => (
          <div className="schem-key-row" key={i}>
            <span>{keys}</span>
            <em>{label}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Layer view" dropdown: how lower / upper layers are drawn in layer mode. */
function LayerViewMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const below = useSchematicsStore((s) => s.below);
  const showAbove = useSchematicsStore((s) => s.showAbove);
  const setBelow = useSchematicsStore((s) => s.setBelow);
  const setShowAbove = useSchematicsStore((s) => s.setShowAbove);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="schem-popover-wrap" ref={ref}>
      <button
        type="button"
        className={`schem-tool schem-tool-menu ${open ? "is-active" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t("schematics.viewport.layersView")}
        <PixelChevronDownIcon className="schem-tool-caret" />
      </button>
      {open ? (
        <div className="schem-popover">
          <span className="schem-tool-label">{t("schematics.viewport.below")}</span>
          <Seg
            label={t("schematics.viewport.below")}
            value={below}
            onChange={setBelow}
            options={[
              { id: "dim", label: t("schematics.viewport.belowDim") },
              { id: "normal", label: t("schematics.viewport.belowNormal") },
              { id: "hide", label: t("schematics.viewport.belowHide") },
            ]}
          />
          <span className="schem-tool-label">{t("schematics.viewport.above")}</span>
          <Seg
            label={t("schematics.viewport.above")}
            value={showAbove ? "ghost" : "hide"}
            onChange={(v) => setShowAbove(v === "ghost")}
            options={[
              { id: "hide", label: t("schematics.viewport.aboveHide") },
              { id: "ghost", label: t("schematics.viewport.aboveGhost") },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export function SchematicViewport({
  loader,
  built,
  onRetry,
}: {
  loader: LoaderState;
  built: number[];
  onRetry: () => void;
}) {
  const t = useT();
  const lang = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SchematicScene | null>(null);
  const [sceneError, setSceneError] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [pole, setPole] = useState<"top" | "bottom" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(true);
  const [tapeState, setTapeState] = useState<TapeState>({ pinned: [], pending: false });

  const mode = useSchematicsStore((s) => s.mode);
  const layer = useSchematicsStore((s) => s.layer);
  const below = useSchematicsStore((s) => s.below);
  const showAbove = useSchematicsStore((s) => s.showAbove);
  const grid = useSchematicsStore((s) => s.grid);
  const ortho = useSchematicsStore((s) => s.ortho);
  const setMode = useSchematicsStore((s) => s.setMode);
  const setGrid = useSchematicsStore((s) => s.setGrid);
  const setOrtho = useSchematicsStore((s) => s.setOrtho);
  const tape = useSchematicsStore((s) => s.tape);
  const setTape = useSchematicsStore((s) => s.setTape);

  const model = loader.status === "ready" ? loader.model : null;

  // Scene lifetime = component lifetime (re-created when sceneKey bumps on retry).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      setSceneError(false);
      const scene = new SchematicScene(host, {
        onHover: setHover,
        onTape: setTapeState,
        onPole: setPole,
        cubeLabels: {
          top: t("schematics.viewport.cube.top"),
          bottom: t("schematics.viewport.cube.bottom"),
          north: t("schematics.viewport.cube.north"),
          south: t("schematics.viewport.cube.south"),
          west: t("schematics.viewport.cube.west"),
          east: t("schematics.viewport.cube.east"),
        },
      });
      sceneRef.current = scene;
      return () => {
        scene.dispose();
        sceneRef.current = null;
      };
    } catch {
      setSceneError(true);
    }
    // Labels are baked into the cube at creation; a language change re-creates the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, lang]);

  // View state: restyle layers only (never rebuilds geometry).
  useEffect(() => {
    sceneRef.current?.setView({ mode, layer, below, showAbove, grid });
  }, [mode, layer, below, showAbove, grid, sceneKey, lang]);

  useEffect(() => {
    sceneRef.current?.setOrtho(ortho);
  }, [ortho, sceneKey, lang]);

  useEffect(() => {
    sceneRef.current?.setTape(tape);
  }, [tape, sceneKey, lang]);

  useMoveKeys(model !== null, (f, r, u, fast) => sceneRef.current?.setMoveInput(f, r, u, fast));
  useTapeKeys(model !== null, () => sceneRef.current?.cancelTape() ?? false);

  // Attach / detach the built model.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !model) return;
    scene.setModel(model);
    return () => scene.clearModel();
  }, [model, sceneKey, lang]);

  const tooltip = hover && model ? (
    <BlockTooltip hover={hover} model={model} host={hostRef.current} compact={tape} />
  ) : null;

  return (
    <div className="schem-viewport">
      <div className="schem-canvas-host" ref={hostRef} />

      {model ? (
        <div className="schem-toolbar">
          <Seg
            label={t("schematics.viewport.modeLayers")}
            value={mode}
            onChange={setMode}
            options={[
              { id: "layers", label: t("schematics.viewport.modeLayers") },
              { id: "whole", label: t("schematics.viewport.modeWhole") },
            ]}
          />
          {mode === "layers" ? <LayerViewMenu /> : null}
          <Toggle on={grid} onClick={() => setGrid(!grid)}>
            {t("schematics.viewport.grid")}
          </Toggle>
          <Toggle
            on={tape}
            onClick={() => setTape(!tape)}
            title={`${t("schematics.tape.title")} (M)`}
          >
            <PixelRulerIcon className="schem-tool-icon" />
            {t("schematics.tape.title")}
          </Toggle>
        </div>
      ) : null}

      {model ? (
        <div className="schem-cube-tools">
          <button
            type="button"
            className="schem-cube-btn"
            aria-label={t("schematics.viewport.resetCamera")}
            title={t("schematics.viewport.resetCamera")}
            onClick={() => sceneRef.current?.resetCamera()}
          >
            ⌂
          </button>
          <button
            type="button"
            className={`schem-cube-btn is-text ${ortho ? "is-active" : ""}`}
            aria-pressed={ortho}
            aria-label={ortho ? t("schematics.viewport.projOrtho") : t("schematics.viewport.projPersp")}
            title={ortho ? t("schematics.viewport.projOrtho") : t("schematics.viewport.projPersp")}
            onClick={() => setOrtho(!ortho)}
          >
            {ortho ? "ORT" : "3D"}
          </button>
          <button
            type="button"
            className={`schem-cube-btn ${helpOpen ? "is-active" : ""}`}
            aria-pressed={helpOpen}
            aria-label={t("schematics.viewport.help.button")}
            title={t("schematics.viewport.help.button")}
            onClick={() => setHelpOpen((v) => !v)}
          >
            ?
          </button>
        </div>
      ) : null}

      {model ? <CubeArrows pole={pole} scene={sceneRef.current} /> : null}
      {model && helpOpen ? <HotkeyHelp /> : null}

      {model && tape ? (
        <div className="schem-tape-panel">
          {tapeState.pinned.length > 0 ? (
            <>
              <ul>
                {tapeState.pinned.map((m) => (
                  <li key={m.id}>
                    <span>{tapeLabel(tapeMetrics(m.a, m.b)).main}</span>
                    <button
                      type="button"
                      className="schem-tape-x"
                      title={t("schematics.tape.remove")}
                      aria-label={t("schematics.tape.remove")}
                      onClick={() => sceneRef.current?.removeMeasure(m.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="schem-tool schem-tape-clear"
                onClick={() => sceneRef.current?.clearTape()}
              >
                {t("schematics.tape.clear")}
              </button>
              <hr className="schem-tape-divider" />
            </>
          ) : null}
          <div className="schem-tape-head">
            <span>{t("schematics.tape.title")}</span>
            <button
              type="button"
              className="schem-tape-collapse"
              aria-expanded={hintsOpen}
              title={hintsOpen ? t("schematics.tape.hideHints") : t("schematics.tape.showHints")}
              aria-label={hintsOpen ? t("schematics.tape.hideHints") : t("schematics.tape.showHints")}
              onClick={() => setHintsOpen((v) => !v)}
            >
              <PixelChevronDownIcon className={hintsOpen ? "" : "is-flipped"} />
            </button>
          </div>
          {hintsOpen ? (
            <div className="schem-keys">
              <div className="schem-key-row">
                <span>
                  <KbdMouse label={t("schematics.keys.lmb")} />
                </span>
                <em>{t("schematics.tape.keys.click")}</em>
              </div>
              <div className="schem-key-row">
                <span>
                  <Kbd>Shift</Kbd>+<KbdMouse label={t("schematics.keys.lmb")} />
                </span>
                <em>{t("schematics.tape.keys.continue")}</em>
              </div>
              <div className="schem-key-row">
                <span>
                  <Kbd>Esc</Kbd>
                </span>
                <em>{t("schematics.tape.keys.cancel")}</em>
              </div>
              <div className="schem-key-row">
                <span>
                  <Kbd>M</Kbd>
                </span>
                <em>{t("schematics.tape.keys.off")}</em>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {model && mode === "layers" ? <LayerControls built={built} /> : null}
      {tooltip}

      {loader.status === "assets" || loader.status === "building" ? (
        <div className="schem-overlay">
          <div className="schem-loading">
            <span className="schem-spinner" aria-hidden />
            <p>
              {loader.status === "assets"
                ? t("schematics.viewport.preparing", { version: ASSETS_VERSION })
                : t("schematics.viewport.building", { percent: loader.percent })}
            </p>
            {loader.status === "building" ? (
              <div className="schem-progress-bar is-wide">
                <span style={{ width: `${loader.percent}%` }} />
              </div>
            ) : (
              <div className="schem-progress-bar is-wide is-indeterminate">
                <span />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {loader.status === "error" || sceneError ? (
        <div className="schem-overlay">
          <div className="schem-error">
            <strong>
              {sceneError ? t("schematics.viewport.webglFailed") : t("schematics.viewport.error")}
            </strong>
            {loader.status === "error" ? <p>{loader.message}</p> : null}
            <button type="button" className="btn-mc ok" onClick={() => {
                if (sceneError) setSceneKey((k) => k + 1);
                else onRetry();
              }}>
              {t("schematics.viewport.retry")}
            </button>
          </div>
        </div>
      ) : null}

      {loader.status === "idle" ? (
        <div className="schem-overlay is-passive">
          <p className="schem-placeholder">{t("schematics.viewport.noSelection")}</p>
        </div>
      ) : null}
    </div>
  );
}

function BlockTooltip({
  hover,
  model,
  host,
  compact,
}: {
  hover: HoverInfo;
  model: SchematicModel;
  host: HTMLElement | null;
  compact: boolean;
}) {
  const { pick } = hover;
  const name = model.names[pick.name] ?? prettifyId(pick.name);
  const iconKey = useMemo(() => iconKeyFor(pick.state), [pick.state]);
  const icon = useIcon(iconKey);
  useEffect(() => {
    if (!icon) prioritizeIcon(iconKey);
  }, [iconKey, icon]);
  const w = host?.clientWidth ?? 0;
  const h = host?.clientHeight ?? 0;
  const flipX = w > 0 && hover.x > w - 240;
  const flipY = h > 0 && hover.y > h - 70;
  // Tape mode keeps the tooltip further from the cursor so it never covers the measurement label.
  const off = compact ? 22 : 14;
  return (
    <div
      className="schem-tooltip"
      style={{
        left: hover.x,
        top: hover.y,
        transform: `translate(${flipX ? `calc(-100% - ${off}px)` : `${off}px`}, ${flipY ? `calc(-100% - ${off}px)` : `${off + (compact ? 8 : 0)}px`})`,
      }}
    >
      {icon ? (
        <img className="schem-tooltip-icon" src={icon} alt="" width={32} height={32} />
      ) : (
        <span className="schem-tooltip-icon is-placeholder" aria-hidden />
      )}
      <strong>{name}</strong>
    </div>
  );
}
