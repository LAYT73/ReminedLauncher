import { useEffect, useRef } from "react";
import { attachTransitionSurface } from "@/shared/lib/pageTransition";

/** Sits over the stage's `.content` cell; drawn by the page transition. */
export function PageTransitionOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    return attachTransitionSurface({ root, canvas });
  }, []);

  return (
    <div ref={rootRef} className="page-transition" aria-hidden>
      <canvas ref={canvasRef} className="page-transition-canvas" />
    </div>
  );
}
