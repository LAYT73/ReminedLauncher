import { useEffect, useRef } from "react";
import { FunctionAnimation, SkinViewer } from "skinview3d";
import steveUrl from "../assets/steve.png";

type Variant = "full" | "bust";

type Props = {
  skinUrl: string | null;
  variant?: Variant;
  className?: string;
};

/** Standing idle — breathing, arm sway, weight shift, slow look-around. */
function createStandingIdle() {
  const anim = new FunctionAnimation((player, progress) => {
    const t = progress;
    const breath = Math.sin(t * 1.55) * 0.028;
    player.skin.body.rotation.x = breath;

    const armBase = Math.PI * 0.025;
    player.skin.leftArm.rotation.z = Math.cos(t * 1.05) * 0.14 + armBase;
    player.skin.rightArm.rotation.z = Math.cos(t * 1.05 + Math.PI) * 0.14 - armBase;
    player.skin.leftArm.rotation.x = Math.sin(t * 0.85) * 0.08 + breath * 0.4;
    player.skin.rightArm.rotation.x = Math.sin(t * 0.85 + 0.9) * 0.08 + breath * 0.4;

    player.skin.leftLeg.rotation.z = Math.sin(t * 0.65) * 0.03;
    player.skin.rightLeg.rotation.z = -Math.sin(t * 0.65) * 0.03;
    player.skin.leftLeg.rotation.x = Math.sin(t * 0.65) * 0.02;
    player.skin.rightLeg.rotation.x = -Math.sin(t * 0.65) * 0.02;

    // Uneven look — not a perfect sine loop
    player.skin.head.rotation.y =
      Math.sin(t * 0.42) * 0.38 + Math.sin(t * 0.16) * 0.18;
    player.skin.head.rotation.x = Math.sin(t * 0.5) * 0.1 + breath * 0.5;
  });
  anim.speed = 0.85;
  return anim;
}

/** Bust / avatar — only head is visible. */
function createHeadIdle() {
  const anim = new FunctionAnimation((player, progress) => {
    const t = progress;
    player.skin.head.rotation.y =
      Math.sin(t * 0.55) * 0.22 + Math.sin(t * 0.19) * 0.1;
    player.skin.head.rotation.x = Math.sin(t * 0.7) * 0.08;
  });
  anim.speed = 0.7;
  return anim;
}

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
  // Gentle spin so idle body motion stays readable
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 0.28;
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
      animation:
        variant === "full" ? createStandingIdle() : createHeadIdle(),
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
