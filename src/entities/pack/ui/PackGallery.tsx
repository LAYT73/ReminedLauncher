import { useCallback, useEffect, useState } from "react";
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
  const count = images.length;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (count <= 1) return;
    const id = window.setInterval(() => go(index + 1), TIMING.galleryAutoplay);
    return () => window.clearInterval(id);
  }, [count, go, index]);

  if (count === 0) return null;

  return (
    <div className="pack-gallery">
      <div className="pack-gallery-stage">
        {images.map((src, i) => (
          <img
            key={src}
            src={src}
            alt={`${alt} ${i + 1}`}
            className={`pack-gallery-slide ${i === index ? "is-active" : ""}`}
            draggable={false}
          />
        ))}

        {count > 1 ? (
          <>
            <button
              type="button"
              className="pack-gallery-nav is-prev"
              aria-label={t("pack.gallery.previous")}
              onClick={() => go(index - 1)}
            >
              <PixelChevronLeftIcon />
            </button>
            <button
              type="button"
              className="pack-gallery-nav is-next"
              aria-label={t("pack.gallery.next")}
              onClick={() => go(index + 1)}
            >
              <PixelChevronRightIcon />
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="pack-gallery-dots" role="tablist" aria-label={t("pack.gallery.gallery")}>
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={t("pack.gallery.slide", { n: i + 1 })}
              className={`pack-gallery-dot ${i === index ? "is-active" : ""}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
