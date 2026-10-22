import { useLocale, useT } from "@/shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "@/shared/api/invoke";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";
import { errorMessage } from "@/shared/lib/errors";
import { FolderIconBtn } from "@/shared/ui/FolderIconBtn";
import { TitleHint } from "@/shared/ui/TitleHint";
import { EmptyState } from "@/shared/ui/EmptyState";
import { PixelChevronLeftIcon, PixelChevronRightIcon } from "@/shared/ui/PixelIcons";

type Row = { name: string; path: string; modified_ms: number; size: number };

function ViewerChevron({ direction }: { direction: "prev" | "next" }) {
  return direction === "prev" ? (
    <PixelChevronLeftIcon className="screenshot-viewer-chevron" />
  ) : (
    <PixelChevronRightIcon className="screenshot-viewer-chevron" />
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
  const t = useT();
  const locale = useLocale();
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
      onToast(errorMessage(err), "err");
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
        setThumbs((prev) => ({ ...prev, [name]: url }));
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
      onToast(t("screenshots.installBeforeOpen"), "err");
      return;
    }
    try {
      const dir = await call<string>(CMD.screenshotsDir, { packId });
      await revealItemInDir(dir);
    } catch (err) {
      onToast(t("screenshots.cantOpenFolder", { error: errorMessage(err) }), "err");
    }
  }

  const multi = (rows?.length ?? 0) > 1;

  return (
    <section className="section screenshot-page">
      <TitleHint
        as="h3"
        className="screenshot-page-head"
        title={t("screenshots.title")}
        hint={t("screenshots.hint")}
        end={
          <div className="screenshot-actions">
            <button
              type="button"
              className="btn-mc dim"
              disabled={!installed}
              onClick={() => void refresh()}
            >
              {t("screenshots.refresh")}
            </button>
            <FolderIconBtn
              title={
                installed
                  ? t("screenshots.openFolder")
                  : t("screenshots.installFirst")
              }
              disabled={!installed}
              onClick={() => void openFolder()}
            />
          </div>
        }
      />
      {!installed ? (
        <p className="friends-lead">
          {t("screenshots.installFirstBody")}
        </p>
      ) : rows === null ? (
        <p className="friends-lead">{t("screenshots.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("screenshots.emptyTitle")}
          description={t("screenshots.emptyBody")}
        />
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
                <span>{new Date(r.modified_ms).toLocaleString(locale)}</span>
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
              aria-label={t("screenshots.previewLabel")}
            >
              <button
                type="button"
                className="screenshot-viewer-close"
                aria-label={t("screenshots.closePreview")}
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
                    aria-label={t("screenshots.previous")}
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
                  <p className="screenshot-viewer-loading">{t("screenshots.loading")}</p>
                )}

                {multi ? (
                  <button
                    type="button"
                    className="screenshot-viewer-nav is-next"
                    aria-label={t("screenshots.next")}
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
                  <span>{new Date(openRow.modified_ms).toLocaleString(locale)}</span>
                </div>
                <div className="screenshot-actions">
                  <FolderIconBtn
                    title={t("screenshots.showFile")}
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
