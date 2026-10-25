import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type Props = {
  /** Banner art; without it the hero falls back to the plain gradient fill. */
  image?: string | null;
  kicker: ReactNode;
  title: ReactNode;
};

const EASE = 0.08;

/**
 * Pack page banner: the art drifts with the pointer and scrolls slower than the page (parallax), the copy
 * lifts and fades as you scroll, and a slow Ken Burns pan keeps it alive. Motion is skipped entirely when
 * the OS asks for reduced motion.
 */
export function PackHero({ image, kicker, title }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const hero = ref.current;
    if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scroller = hero.closest<HTMLElement>(".content");
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    let raf = 0;

    const frame = () => {
      raf = 0;
      px += (tx - px) * EASE;
      py += (ty - py) * EASE;
      const scroll = Math.min(scroller?.scrollTop ?? 0, hero.offsetHeight);
      hero.style.setProperty("--hero-px", px.toFixed(4));
      hero.style.setProperty("--hero-py", py.toFixed(4));
      hero.style.setProperty("--hero-scroll", scroll.toFixed(1));
      if (Math.abs(tx - px) > 0.0005 || Math.abs(ty - py) > 0.0005) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };

    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
    scroller?.addEventListener("scroll", kick, { passive: true });
    kick();
    return () => {
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      scroller?.removeEventListener("scroll", kick);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header
      ref={ref}
      className={`hero pack-hero${image ? " has-art" : ""}`}
      style={image ? ({ ["--hero-image"]: `url("${image}")` } as CSSProperties) : undefined}
    >
      {image ? (
        <div className="pack-hero-art" aria-hidden>
          <div className="pack-hero-art-img" />
        </div>
      ) : null}
      <div className="pack-hero-scrim" aria-hidden />
      <div className="pack-hero-sheen" aria-hidden />
      <div className="pack-hero-copy">
        <p className="hero-kicker">{kicker}</p>
        <h1 className="hero-title">{title}</h1>
      </div>
    </header>
  );
}
