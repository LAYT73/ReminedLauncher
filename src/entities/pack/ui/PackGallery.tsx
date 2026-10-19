import { useCallback, useEffect, useState } from "react";
import { TIMING } from "@/shared/config/timings";

type Props = {
  images: string[];
  altPrefix?: string;
};

export function PackGallery({ images, altPrefix = "Screenshot" }: Props) {
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
            alt={`${altPrefix} ${i + 1}`}
            className={`pack-gallery-slide ${i === index ? "is-active" : ""}`}
            draggable={false}
          />
        ))}

        {count > 1 ? (
          <>
            <button
              type="button"
              className="pack-gallery-nav is-prev"
              aria-label="Previous"
              onClick={() => go(index - 1)}
            >
              <svg viewBox="0 0 12 20" aria-hidden>
                <path
                  d="M10 2 2 10l8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="pack-gallery-nav is-next"
              aria-label="Next"
              onClick={() => go(index + 1)}
            >
              <svg viewBox="0 0 12 20" aria-hidden>
                <path
                  d="M2 2l8 8-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="pack-gallery-dots" role="tablist" aria-label="Gallery">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}`}
              className={`pack-gallery-dot ${i === index ? "is-active" : ""}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
