import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/shared/api/invoke";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

type Row = { name: string; path: string; modified_ms: number; size: number };

type Props = {
  packId: string | null;
  onToast: (msg: string, tone?: "default" | "ok" | "err") => void;
};

/** Local-only viewer for Minecraft's `screenshots/` folder. Nothing is uploaded. */
export function ScreenshotsPanel({ packId, onToast }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const loading = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!packId) {
      setRows([]);
      return;
    }
    try {
      setRows(await call<Row[]>(CMD.listScreenshots, { packId }));
    } catch (err) {
      setRows([]);
      onToast(String(err), "err");
    }
  }, [packId, onToast]);

  useEffect(() => {
    setThumbs({});
    loading.current.clear();
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

  async function openFolder() {
    if (!packId) return;
    try {
      const dir = await call<string>(CMD.screenshotsDir, { packId });
      await revealItemInDir(dir);
    } catch (err) {
      onToast(`Can't open folder: ${String(err)}`, "err");
    }
  }

  return (
    <section className="section">
      <div className="screenshot-meta">
        <h3 className="page-title">Screenshots</h3>
        <div className="screenshot-actions">
          <button type="button" className="btn-mc dim" onClick={() => void refresh()}>
            Refresh
          </button>
          <button type="button" className="btn-mc dim" onClick={() => void openFolder()}>
            Show folder
          </button>
        </div>
      </div>
      <p className="friends-lead">
        Press F2 in game. Shown from this installation&apos;s screenshots folder
        — stays on your computer, never uploaded.
      </p>
      {rows === null ? (
        <p className="friends-lead">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="friends-lead">No screenshots yet.</p>
      ) : (
        <div className="screenshot-grid">
          {rows.map((r) => (
            <button
              key={r.name}
              type="button"
              className="screenshot-card"
              onClick={() => {
                setOpen(r.name);
                void load(r.name);
              }}
              onMouseEnter={() => void load(r.name)}
            >
              {thumbs[r.name] ? (
                <img src={thumbs[r.name]} alt={r.name} loading="lazy" />
              ) : (
                <div className="screenshot-placeholder" />
              )}
              <span className="screenshot-meta">
                <span>{new Date(r.modified_ms).toLocaleString()}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {open ? (
        <div
          className="voice-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <div
            className="voice-modal"
            style={{ maxWidth: "90vw", maxHeight: "90vh", width: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {thumbs[open] ? (
              <img
                src={thumbs[open]}
                alt={open}
                style={{ maxWidth: "100%", maxHeight: "78vh", display: "block" }}
              />
            ) : (
              <p className="friends-lead">Loading…</p>
            )}
            <div className="screenshot-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn-mc dim"
                onClick={() => {
                  const r = rows?.find((x) => x.name === open);
                  if (r) void revealItemInDir(r.path).catch(() => undefined);
                }}
              >
                Show file
              </button>
              <button type="button" className="btn-mc dim" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
