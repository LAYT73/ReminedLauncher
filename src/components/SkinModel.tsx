import { useEffect, useRef } from "react";
import { IdleAnimation, SkinViewer } from "skinview3d";
import steveUrl from "../assets/steve.png";

type Variant = "full" | "bust";

type Props = {
  skinUrl: string | null;
  variant?: Variant;
  className?: string;
};

/**
 * PlayerObject shifts SkinObject by +8.
 * Head mesh center ≈ y 12; chest ≈ y 2. Header bust must target the head.
 */
function frameBust(viewer: SkinViewer) {
  const skin = viewer.playerObject.skin;
  skin.body.visible = false;
  skin.leftArm.visible = false;
  skin.rightArm.visible = false;
  skin.leftLeg.visible = false;
  skin.rightLeg.visible = false;
  skin.head.visible = true;

  viewer.fov = 34;
  viewer.zoom = 3.15;
  // head group at y=8, mesh center +4 → ~12; slight pullback so face fits
  viewer.controls.target.set(0, 12.4, 0);
  viewer.camera.position.set(0, 13, 50);
  viewer.adjustCameraDistance();
  viewer.controls.update();
  viewer.autoRotate = false;
}

function frameFull(viewer: SkinViewer) {
  const skin = viewer.playerObject.skin;
  skin.body.visible = true;
  skin.leftArm.visible = true;
  skin.rightArm.visible = true;
  skin.leftLeg.visible = true;
  skin.rightLeg.visible = true;
  skin.head.visible = true;

  viewer.fov = 50;
  viewer.zoom = 0.9;
  viewer.resetCameraPose();
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 0.5;
}

export function SkinModel({ skinUrl, variant = "full", className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.replaceChildren(canvas);

    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const source = skinUrl ?? steveUrl;

    const viewer = new SkinViewer({
      canvas,
      width,
      height,
      skin: source,
      enableControls: variant === "full",
      animation: variant === "full" ? new IdleAnimation() : undefined,
    });

    viewer.controls.enablePan = false;
    viewer.controls.enableZoom = false;
    viewer.controls.enableRotate = variant === "full";

    if (variant === "bust") {
      frameBust(viewer);
    } else {
      frameFull(viewer);
    }

    viewerRef.current = viewer;

    const ro = new ResizeObserver(() => {
      if (viewer.disposed) return;
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      viewer.setSize(w, h);
      if (variant === "bust") frameBust(viewer);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [variant]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;
    const result = viewer.loadSkin(skinUrl ?? steveUrl);
    void Promise.resolve(result).then(() => {
      if (viewer.disposed) return;
      if (variant === "bust") frameBust(viewer);
      else frameFull(viewer);
    });
  }, [skinUrl, variant]);

  return <div ref={hostRef} className={className} />;
}
