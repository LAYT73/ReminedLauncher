import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocale, useT } from "@/shared/i18n";
import { PixelCrossIcon, PixelSchematicIcon } from "@/shared/ui/PixelIcons";
import { schematicApi, type CatalogItem } from "@/entities/schematic";
import { localized, matchesQuery, setThumb, subscribeThumbs, thumbCache } from "../model/catalog";
import { useSchematicsStore } from "../model/store";

const thumbPending = new Map<string, Promise<string | null>>();

function fetchThumb(item: CatalogItem): Promise<string | null> {
  if (!item.thumb) return Promise.resolve(null);
  const hit = thumbCache.get(item.id);
  if (hit) return Promise.resolve(hit);
  let p = thumbPending.get(item.id);
  if (!p) {
    p = schematicApi
      .catalogThumb(item.id)
      .catch(() => null)
      .then((url) => {
        thumbPending.delete(item.id);
        if (url) setThumb(item.id, url);
        return url;
      });
    thumbPending.set(item.id, p);
  }
  return p;
}

/** Loads the thumbnail once the element scrolls into view (or at once when `eager`). */
function Thumb({ item, eager = false }: { item: CatalogItem; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(thumbCache.get(item.id) ?? null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(eager);

  // Pick up thumbnails cached by other cards (or cleared on refresh) after mount.
  useEffect(
    () =>
      subscribeThumbs(() => {
        const hit = thumbCache.get(item.id);
        setSrc(hit ?? null);
      }),
    [item.id],
  );

  useEffect(() => {
    if (visible || !item.thumb) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (hits) => {
        if (hits.some((h) => h.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, item.id, item.thumb]);

  useEffect(() => {
    if (!visible || !item.thumb) return;
    let alive = true;
    setLoading(true);
    void fetchThumb(item).then((url) => {
      if (!alive) return;
      setSrc(url);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [visible, item]);

  return (
    <div ref={ref} className={`schem-thumb ${loading ? "is-loading" : ""}`}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <PixelSchematicIcon className="schem-thumb-ph" />
      )}
    </div>
  );
}

function AddButton({ item, small }: { item: CatalogItem; small?: boolean }) {
  const t = useT();
  const installing = useSchematicsStore((s) => !!s.installing[item.id]);
  const installed = useSchematicsStore((s) => s.entries.some((e) => e.catalogId === item.id));
  const install = useSchematicsStore((s) => s.installCatalogItem);
  const openInstalled = useSchematicsStore((s) => s.openInstalled);
  const cls = `btn-mc ${installed ? "" : "ok"} schem-add-btn ${small ? "is-small" : ""}`;
  if (installing) {
    return (
      <button type="button" className={cls} disabled aria-busy="true">
        <span className="schem-spinner" aria-hidden="true" />
        {t("schematics.catalog.adding")}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        if (installed) openInstalled(item.id);
        else void install(item.id);
      }}
    >
      {installed ? t("schematics.catalog.open") : t("schematics.catalog.add")}
    </button>
  );
}

function DifficultyChip({ value }: { value: CatalogItem["difficulty"] }) {
  const t = useT();
  const d = value === "easy" || value === "hard" ? value : "medium";
  return <span className={`schem-diff is-${d}`}>{t(`schematics.catalog.difficulty.${d}`)}</span>;
}

function CatalogCard({ item }: { item: CatalogItem }) {
  const t = useT();
  const locale = useLocale();
  const open = useSchematicsStore((s) => s.setCatalogDetailId);
  return (
    <li className="schem-ccard" data-item-id={item.id} onClick={() => open(item.id)}>
      <Thumb item={item} />
      <div className="schem-ccard-body">
        <button
          type="button"
          className="schem-ccard-name"
          title={localized(item.name, locale)}
          onClick={(e) => {
            e.stopPropagation();
            open(item.id);
          }}
        >
          {localized(item.name, locale)}
        </button>
        <p className="schem-ccard-desc">{localized(item.description, locale)}</p>
        <div className="schem-card-meta">
          <span>{item.size.join(" × ")}</span>
          <span>{t("schematics.library.blocks", { count: item.blockCount })}</span>
        </div>
        <div className="schem-ccard-foot">
          <DifficultyChip value={item.difficulty} />
          <span className="schem-ccard-author" title={item.author}>
            {item.author}
          </span>
        </div>
        <AddButton item={item} />
      </div>
    </li>
  );
}

function SkeletonCard() {
  return (
    <li className="schem-ccard is-skeleton" aria-hidden="true">
      <div className="schem-thumb is-loading" />
      <div className="schem-ccard-body">
        <span className="schem-skel" style={{ width: "60%", height: 16 }} />
        <span className="schem-skel" style={{ width: "100%", height: 12 }} />
        <span className="schem-skel" style={{ width: "80%", height: 12 }} />
        <span className="schem-skel" style={{ width: "100%", height: 34, marginTop: 4 }} />
      </div>
    </li>
  );
}

function DetailsModal({ item }: { item: CatalogItem }) {
  const t = useT();
  const locale = useLocale();
  const close = useSchematicsStore((s) => s.setCatalogDetailId);
  const categories = useSchematicsStore((s) => s.catalog?.categories);
  const category = categories?.find((c) => c.id === item.category);
  const modalRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);

  // Focus the primary button on open; give focus back to the card on close.
  useEffect(() => {
    const id = item.id;
    modalRef.current?.querySelector<HTMLElement>(".schem-modal-actions button:not([disabled])")?.focus();
    return () => {
      document
        .querySelector<HTMLElement>(`.schem-ccard[data-item-id="${id}"] .schem-ccard-name`)
        ?.focus();
    };
  }, [item.id]);

  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const nodes = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"),
    );
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !e.currentTarget.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !e.currentTarget.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function openSource() {
    if (!item.sourceUrl) return;
    void openUrl(item.sourceUrl).catch(() => {
      /* no opener (browser dev) */
    });
  }

  const rows: [string, string][] = [
    [t("schematics.catalog.size"), item.size.join(" × ")],
    [t("schematics.catalog.blocksLabel"), String(item.blockCount)],
    [t("schematics.catalog.version"), item.mcVersion],
    [t("schematics.catalog.author"), item.author],
    [t("schematics.catalog.license"), item.license],
  ];

  return (
    <div
      className="schem-modal-backdrop"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const ok = downOnBackdrop.current && e.target === e.currentTarget;
        downOnBackdrop.current = false;
        if (ok) close(null);
      }}
    >
      <div
        ref={modalRef}
        onKeyDown={trapTab}
        className="schem-modal"
        role="dialog"
        aria-modal="true"
        aria-label={localized(item.name, locale)}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="schem-icon-btn schem-modal-close"
          aria-label={t("schematics.catalog.close")}
          title={t("schematics.catalog.close")}
          onClick={() => close(null)}
        >
          <PixelCrossIcon />
        </button>
        <Thumb item={item} eager />
        <div className="schem-modal-body">
          <h3>{localized(item.name, locale)}</h3>
          <div className="schem-ccard-foot">
            <DifficultyChip value={item.difficulty} />
            {category ? <span className="schem-badge">{localized(category.name, locale)}</span> : null}
          </div>
          <p className="schem-modal-desc">{localized(item.description, locale)}</p>
          {item.tags.length > 0 ? (
            <div className="schem-tags">
              {item.tags.map((tag) => (
                <span key={tag} className="schem-badge">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <dl className="schem-facts">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="schem-modal-actions">
            <AddButton item={item} />
            {item.sourceUrl ? (
              <button type="button" className="btn-mc schem-add-btn" onClick={openSource}>
                {t("schematics.catalog.openSource")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Center area in catalog mode: header + responsive card grid + details modal. */
export function CatalogGallery() {
  const t = useT();
  const locale = useLocale();
  const status = useSchematicsStore((s) => s.catalogStatus);
  const catalog = useSchematicsStore((s) => s.catalog);
  const error = useSchematicsStore((s) => s.catalogError);
  const category = useSchematicsStore((s) => s.catalogCategory);
  const query = useSchematicsStore((s) => s.catalogQuery);
  const detailId = useSchematicsStore((s) => s.catalogDetailId);
  const stale = useSchematicsStore((s) => s.catalogStale);
  const load = useSchematicsStore((s) => s.loadCatalog);

  const items = useMemo(
    () =>
      (catalog?.items ?? []).filter(
        (i) => (category === "all" || i.category === category) && matchesQuery(i, query, locale),
      ),
    [catalog, category, query, locale],
  );
  const detail = detailId ? (catalog?.items.find((i) => i.id === detailId) ?? null) : null;
  const catName =
    category === "all"
      ? t("schematics.catalog.title")
      : localized(catalog?.categories.find((c) => c.id === category)?.name, locale) ||
        t("schematics.catalog.title");
  const loading = status === "loading";
  const showSkeleton = loading && !catalog;
  const updated = (() => {
    if (!catalog?.updatedAt) return "";
    const d = new Date(catalog.updatedAt);
    return Number.isNaN(d.getTime())
      ? ""
      : t("schematics.catalog.updated", { date: d.toLocaleDateString(locale) });
  })();

  return (
    <section className="schem-gallery">
      <header className="schem-gallery-head">
        <div className="schem-gallery-title">
          <h2>{catName}</h2>
          <span className="schem-gallery-sub">
            {catalog ? t("schematics.catalog.results", { count: items.length }) : ""}
            {catalog && updated ? ` · ${updated}` : ""}
            {catalog && stale ? ` · ${t("schematics.catalog.offlineCopy")}` : ""}
          </span>
        </div>
        <button
          type="button"
          className="btn-mc schem-add-btn is-small"
          disabled={loading}
          onClick={() => void load(true)}
        >
          {loading ? <span className="schem-spinner" aria-hidden="true" /> : null}
          {t("schematics.catalog.refresh")}
        </button>
      </header>
      <div className="schem-gallery-scroll">
        {status === "error" && !catalog ? (
          <div className="schem-gallery-state" role="alert">
            <PixelSchematicIcon className="schem-empty-icon" />
            <h3>{t("schematics.catalog.loadFailed")}</h3>
            <p>{error}</p>
            <button type="button" className="btn-mc ok" onClick={() => void load(true)}>
              {t("schematics.catalog.retry")}
            </button>
          </div>
        ) : showSkeleton ? (
          <ul className="schem-cgrid">
            {Array.from({ length: 8 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <div className="schem-gallery-state">
            <PixelSchematicIcon className="schem-empty-icon" />
            <h3>{t("schematics.catalog.nothing")}</h3>
            <p>{t("schematics.catalog.nothingHint")}</p>
          </div>
        ) : (
          <ul className="schem-cgrid">
            {items.map((i) => (
              <CatalogCard key={i.id} item={i} />
            ))}
          </ul>
        )}
      </div>
      {detail ? <DetailsModal item={detail} /> : null}
    </section>
  );
}
