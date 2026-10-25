import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useT } from "@/shared/i18n";
import { TIMING } from "@/shared/config/timings";
import { PixelChevronLeftIcon, PixelChevronRightIcon } from "@/shared/ui/PixelIcons";

type Props = {
  images: string[];
  altPrefix?: string;
};

export function PackGallery({ images, altPrefix }: Props) {
  const t = useT();
  const alt = altPrefix ?? t("pack.gallery.screenshot");
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  // +1 when moving forward, -1 backward: slides enter from that side.
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);
  const count = images.length;

  const go = useCallback(
    (next: number, direction?: number) => {
      if (count === 0) return;
      const target = ((next % count) + count) % count;
      if (target === index) return;
      setDir(direction ?? (next > index ? 1 : -1));
      setPrev(index);
      setIndex(target);
    },
    [count, index],
  );

  useEffect(() => {
    if (count <= 1 || paused) return;
    const id = window.setTimeout(() => go(index + 1, 1), TIMING.galleryAutoplay);
    return () => window.clearTimeout(id);
  }, [count, go, index, paused]);

  if (count === 0) return null;

  return (
    <div
      className={`pack-gallery${paused ? " is-paused" : ""}`}
      style={
        {
          ["--gallery-dir"]: dir,
          ["--gallery-autoplay"]: `${TIMING.galleryAutoplay}ms`,
        } as CSSProperties
      }
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(index - 1, -1);
        if (e.key === "ArrowRight") go(index + 1, 1);
      }}
    >
      <div className="pack-gallery-stage" tabIndex={0}>
        {images.map((src, i) => (
          <div
            key={src}
            className={`pack-gallery-slide${i === index ? " is-active" : ""}${
              i === prev ? " is-leaving" : ""
            }`}
            aria-hidden={i !== index}
          >
            <img src={src} alt={`${alt} ${i + 1}`} draggable={false} />
          </div>
        ))}

        {count > 1 ? (
          <>
            <span className="pack-gallery-count" aria-hidden>
              {index + 1} / {count}
            </span>
            <button
              type="button"
              className="pack-gallery-nav is-prev"
              aria-label={t("pack.gallery.previous")}
              onClick={() => go(index - 1, -1)}
            >
              <PixelChevronLeftIcon />
            </button>
            <button
              type="button"
              className="pack-gallery-nav is-next"
              aria-label={t("pack.gallery.next")}
              onClick={() => go(index + 1, 1)}
            >
              <PixelChevronRightIcon />
            </button>
            <span key={index} className="pack-gallery-progress" aria-hidden />
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="pack-gallery-thumbs" role="tablist" aria-label={t("pack.gallery.gallery")}>
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={t("pack.gallery.slide", { n: i + 1 })}
              className={`pack-gallery-thumb${i === index ? " is-active" : ""}`}
              onClick={() => go(i)}
            >
              <img src={src} alt="" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
