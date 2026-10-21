import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "@/shared/api/invoke";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { TitleHint } from "@/shared/ui/TitleHint";

type Row = { name: string; path: string; modified_ms: number; size: number };

function ViewerChevron({ direction }: { direction: "prev" | "next" }) {
  const points = direction === "prev" ? "13 3 5 14 13 25" : "7 3 15 14 7 25";
  return (
    <svg
      className="screenshot-viewer-chevron"
      viewBox="0 0 20 28"
      aria-hidden
    >
      <polyline points={points} />
    </svg>
  );
}

type Props = {
  packId: string | null;
  /** False when the pack folder is not on disk yet. */
  installed?: boolean;
  onToast: (msg: string, tone?: "default" | "ok" | "err") => void;
};

/** Local-only viewer for Minecraft's `screenshots/` folder. Nothing is uploaded. */
export function ScreenshotsPanel({
  packId,
  installed = false,
  onToast,
}: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [index, setIndex] = useState<number | null>(null);
  const loading = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!packId || !installed) {
      setRows([]);
      return;
    }
    try {
      setRows(await call<Row[]>(CMD.listScreenshots, { packId }));
    } catch (err) {
      setRows([]);
      onToast(String(err), "err");
    }
  }, [packId, installed, onToast]);

  useEffect(() => {
    setThumbs({});
    loading.current.clear();
    setIndex(null);
    void refresh();
  }, [refresh]);

  const load = useCallback(
    async (name: string) => {
      if (!packId || loading.current.has(name)) return;
      loading.current.add(name);
      try {
        const url = await call<string>(CMD.readScreenshot, { packId, name });
        setThumbs((t) => ({ ...t, [name]: url }));
      } catch {
        /* skip unreadable file */
      }
    },
    [packId],
  );

  // Lazy-load thumbnails in small batches.
  useEffect(() => {
    if (!rows) return;
    let cancelled = false;
    (async () => {
      for (const r of rows.slice(0, 24)) {
        if (cancelled) return;
        await load(r.name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, load]);

  const openRow = index != null && rows ? rows[index] ?? null : null;

  // Prefetch neighbors while previewing.
  useEffect(() => {
    if (index == null || !rows?.length) return;
    const names = [
      rows[index]?.name,
      rows[index - 1]?.name,
      rows[index + 1]?.name,
    ].filter(Boolean) as string[];
    for (const name of names) void load(name);
  }, [index, rows, load]);

  useEffect(() => {
    if (index == null || !rows?.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIndex(null);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) =>
          i == null ? i : (i - 1 + rows.length) % rows.length,
        );
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => (i == null ? i : (i + 1) % rows.length));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, rows]);

  async function openFolder() {
    if (!packId || !installed) {
      onToast("Install this pack before opening screenshots", "err");
      return;
    }
    try {
      const dir = await call<string>(CMD.screenshotsDir, { packId });
      await revealItemInDir(dir);
    } catch (err) {
      onToast(`Can't open folder: ${String(err)}`, "err");
    }
  }

  const multi = (rows?.length ?? 0) > 1;

  return (
    <section className="section screenshot-page">
      <TitleHint
        as="h3"
        className="screenshot-page-head"
        title="Screenshots"
        hint="Press F2 in game. Shown from this installation's screenshots folder — stays on your computer, never uploaded."
        end={
          <div className="screenshot-actions">
            <button
              type="button"
              className="btn-mc dim"
              disabled={!installed}
              onClick={() => void refresh()}
            >
              Refresh
            </button>
            <FolderIconBtn
              title={
                installed
                  ? "Open screenshots folder"
                  : "Install this pack first"
              }
              disabled={!installed}
              onClick={() => void openFolder()}
            />
          </div>
        }
      />
      {!installed ? (
        <p className="friends-lead">
          Install this pack first — screenshots appear here after you take them
          in game.
        </p>
      ) : rows === null ? (
        <p className="friends-lead">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="friends-lead">No screenshots yet.</p>
      ) : (
        <div className="screenshot-grid">
          {rows.map((r, i) => (
            <button
              key={r.name}
              type="button"
              className="screenshot-card"
              onClick={() => {
                setIndex(i);
                void load(r.name);
              }}
              onMouseEnter={() => void load(r.name)}
            >
              {thumbs[r.name] ? (
                <img src={thumbs[r.name]} alt={r.name} loading="lazy" />
              ) : (
                <div className="screenshot-placeholder" />
              )}
              <span className="screenshot-card-meta">
                <span>{new Date(r.modified_ms).toLocaleString()}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {openRow
        ? createPortal(
            <div
              className="screenshot-viewer"
              role="dialog"
              aria-modal="true"
              aria-label="Screenshot preview"
            >
              <button
                type="button"
                className="screenshot-viewer-close"
                aria-label="Close preview"
                onClick={() => setIndex(null)}
              >
                ×
              </button>

              <div
                className="screenshot-viewer-stage"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setIndex(null);
                }}
              >
                {multi ? (
                  <button
                    type="button"
                    className="screenshot-viewer-nav is-prev"
                    aria-label="Previous screenshot"
                    onClick={() =>
                      setIndex((i) =>
                        i == null || !rows
                          ? i
                          : (i - 1 + rows.length) % rows.length,
                      )
                    }
                  >
                    <ViewerChevron direction="prev" />
                  </button>
                ) : null}

                {thumbs[openRow.name] ? (
                  <img
                    className="screenshot-viewer-img"
                    src={thumbs[openRow.name]}
                    alt={openRow.name}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <p className="screenshot-viewer-loading">Loading…</p>
                )}

                {multi ? (
                  <button
                    type="button"
                    className="screenshot-viewer-nav is-next"
                    aria-label="Next screenshot"
                    onClick={() =>
                      setIndex((i) =>
                        i == null || !rows ? i : (i + 1) % rows.length,
                      )
                    }
                  >
                    <ViewerChevron direction="next" />
                  </button>
                ) : null}
              </div>

              <div className="screenshot-viewer-bar">
                <div className="screenshot-viewer-info">
                  <strong>
                    {index != null && rows
                      ? `${index + 1} / ${rows.length}`
                      : ""}
                  </strong>
                  <span>{openRow.name}</span>
                  <span>{new Date(openRow.modified_ms).toLocaleString()}</span>
                </div>
                <div className="screenshot-actions">
                  <FolderIconBtn
                    title="Show file"
                    onClick={() => {
                      void revealItemInDir(openRow.path).catch(() => undefined);
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
