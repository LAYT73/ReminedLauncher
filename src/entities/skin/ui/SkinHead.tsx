import { useEffect, useRef } from "react";
import steveUrl from "@/shared/assets/steve.png";

type Props = {
  skinUrl: string | null;
  className?: string;
  size?: number;
};

/** Classic 2D Minecraft face from a 64×64 (or 64×32) skin URL. */
export function SkinHead({ skinUrl, className, size = 40 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let alive = true;
    const gen = { n: 0 };

    function paint(img: HTMLImageElement) {
      if (!alive || !ctx) return;
      const s = 8;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      // head base 8×8 at (8,8), hat layer at (40,8)
      ctx.drawImage(img, 8, 8, s, s, 0, 0, size, size);
      if (img.width >= 64 && img.height >= 32) {
        ctx.drawImage(img, 40, 8, s, s, 0, 0, size, size);
      }
    }

    function load(src: string, fallback = false) {
      const my = ++gen.n;
      const img = new Image();
      if (/^https?:\/\//i.test(src)) {
        img.crossOrigin = "anonymous";
      }
      img.onload = () => {
        if (!alive || my !== gen.n) return;
        paint(img);
      };
      img.onerror = () => {
        if (!alive || my !== gen.n) return;
        if (!fallback) load(steveUrl, true);
      };
      img.src = src;
    }

    load(skinUrl?.trim() || steveUrl);
    return () => {
      alive = false;
      gen.n += 1;
    };
  }, [skinUrl, size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
