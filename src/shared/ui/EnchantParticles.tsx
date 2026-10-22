import { burstEnchantFrom } from "./enchantBurst";
import { useEffect, useRef } from "react";

type Props = {
  className?: string;
  count?: number;
  /** Glyphs pop into a mini burst on click (pack pages only). */
  interactive?: boolean;
};

/** Latin A–Z → Standard Galactic glyphs via "Minecraft Enchanting" @font-face. */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type Particle = {
  root: HTMLSpanElement;
  glow: HTMLSpanElement;
  core: HTMLSpanElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  spin: number;
  rot: number;
};

function readAccent(el: HTMLElement): string {
  const styles = getComputedStyle(el);
  return (
    styles.getPropertyValue("--accent-text").trim() ||
    styles.getPropertyValue("--mc-green").trim() ||
    "#6cc349"
  );
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * DOM particles — WKWebView/Safari safe.
 * Opacity is driven every frame (smooth fade). Glow is a separate low-alpha layer.
 */
export function EnchantParticles({
  className,
  count = 16,
  interactive = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const layer = document.createElement("div");
    layer.className = "enchant-particles-layer";
    if (interactive)
      layer.classList.add("enchant-particles-layer--interactive");
    host.replaceChildren(layer);

    let accent = readAccent(host);
    let particles: Particle[] = [];
    let raf = 0;
    let running = true;
    let w = 1;
    let h = 1;

    function paintAccent(p: Particle) {
      p.glow.style.color = accent;
      p.glow.style.textShadow = `0 0 8px ${accent}, 0 0 16px ${accent}`;
      p.core.style.color = accent;
    }

    function setGlyph(p: Particle, ch: string) {
      p.glow.textContent = ch;
      p.core.textContent = ch;
    }

    function resetParticle(p: Particle, scatter: boolean) {
      p.x = Math.random() * w;
      p.y = scatter ? Math.random() * h : h + 12 + Math.random() * 36;
      p.vx = (Math.random() - 0.5) * 0.24;
      p.vy = -(0.18 + Math.random() * 0.32);
      p.size = 12 + Math.random() * 10;
      p.maxLife = 6 + Math.random() * 3;
      p.life = scatter ? Math.random() * p.maxLife * 0.6 : 0;
      p.spin = (Math.random() - 0.5) * 0.035;
      p.rot = Math.random() * Math.PI * 2;
      p.root.style.fontSize = `${p.size}px`;
      setGlyph(p, GLYPHS[(Math.random() * GLYPHS.length) | 0]!);
      paintAccent(p);
      p.root.style.opacity = "0";
    }

    function makeParticle(): Particle {
      const root = document.createElement("span");
      root.className = "enchant-glyph";
      root.setAttribute("aria-hidden", "true");

      const glow = document.createElement("span");
      glow.className = "enchant-glyph-glow";

      const core = document.createElement("span");
      core.className = "enchant-glyph-core";

      root.append(glow, core);
      layer.appendChild(root);

      const p: Particle = {
        root,
        glow,
        core,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 14,
        life: 0,
        maxLife: 6,
        spin: 0,
        rot: 0,
      };
      resetParticle(p, true);
      return p;
    }

    function measure() {
      const node = hostRef.current;
      if (!node) return;
      w = Math.max(node.clientWidth, 1);
      h = Math.max(node.clientHeight, 1);
      accent = readAccent(node);
      while (particles.length < count) particles.push(makeParticle());
      for (const p of particles) paintAccent(p);
    }

    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    measure();

    const themeWatch = new MutationObserver(() => {
      const node = hostRef.current;
      if (!node) return;
      accent = readAccent(node);
      for (const p of particles) paintAccent(p);
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });

    function onPointerDown(e: PointerEvent) {
      const root = (e.target as Element | null)?.closest<HTMLElement>(
        ".enchant-glyph",
      );
      if (!root) return;
      const p = particles.find((q) => q.root === root);
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      burstEnchantFrom(root, {
        count: 4 + ((Math.random() * 2) | 0),
        distance: [24, 48],
        sizeScale: 0.7,
        duration: [500, 700],
        host: document.body,
      });
      resetParticle(p, false);
      // Short pause before it drifts back in.
      p.life = -(0.8 + Math.random() * 1.6);
      p.root.style.pointerEvents = "none";
      p.root.style.transform = "translate3d(-9999px, -9999px, 0)";
    }
    if (interactive) layer.addEventListener("pointerdown", onPointerDown);

    let last = performance.now();
    function tick(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      for (const p of particles) {
        p.life += dt;
        if (p.life < 0) continue;
        p.x += p.vx + Math.sin(p.life * 0.85 + p.size) * 0.08;
        p.y += p.vy;
        p.rot += p.spin;

        if (p.life >= p.maxLife) {
          resetParticle(p, false);
          p.root.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}rad)`;
          continue;
        }

        const t = p.life / p.maxLife;
        const fadeIn = smoothstep(0, 0.18, t);
        const fadeOut = 1 - smoothstep(0.5, 1, t);
        const topFade = smoothstep(-6, 24, p.y);
        const alpha = fadeIn * fadeOut * topFade * 0.72;

        p.root.style.opacity = String(Math.max(0, Math.min(1, alpha)));
        if (interactive)
          p.root.style.pointerEvents = alpha > 0.12 ? "auto" : "none";
        p.root.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}rad)`;
      }

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      themeWatch.disconnect();
      layer.removeEventListener("pointerdown", onPointerDown);
      host.replaceChildren();
      particles = [];
    };
  }, [count, interactive]);

  return <div ref={hostRef} className={className} aria-hidden />;
}
