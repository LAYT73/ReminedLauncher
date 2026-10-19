import { useEffect, useRef } from "react";
import { SkinViewer } from "skinview3d";
import steveUrl from "@/shared/assets/steve.png";
import { applyNameTag } from "../lib/nameTag";
import { normalizeSkinModel, type SkinModelKind } from "../lib/skinModel";
import { enableHomeSkinShading, enableSkinAntiAlias } from "../lib/viewerEffects";
import { createHeadIdle, createStandingIdle, frameBust, frameFull, frameFullHome } from "../lib/viewerMotion";
import type { Preset, Variant } from "../lib/viewerTypes";

type Props = {
  skinUrl: string | null;
  variant?: Variant;
  className?: string;
  /** Camera / controls preset. Default `profile` (git framing). */
  preset?: Preset;
  /** Clear WebGL clear color — character floats over page art. */
  transparent?: boolean;
  /** Minecraft nametag above the head (home). */
  nameTag?: string | null;
  /** Classic wide (`default`) or slim arms. */
  skinModel?: SkinModelKind | null;
};

export function SkinModel({
  skinUrl,
  variant = "full",
  className,
  preset = "profile",
  transparent = false,
  nameTag = null,
  skinModel = "default",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const canOrbit = variant === "full" && preset === "profile";
  const model = normalizeSkinModel(skinModel);

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

    let viewer: SkinViewer;
    try {
      viewer = new SkinViewer({
        canvas,
        width,
        height,
        skin: source,
        model,
        enableControls: canOrbit,
        animation:
          variant === "full" ? createStandingIdle() : createHeadIdle(),
      });
    } catch (err) {
      // No WebGL (headless / blocked GPU): leave the slot empty instead of crashing the app.
      console.warn("SkinModel: WebGL unavailable", err);
      host.replaceChildren();
      return;
    }

    if (transparent) {
      viewer.background = null;
    }

    if (preset === "home") {
      enableHomeSkinShading(viewer);
    }
    const syncAntiAlias = enableSkinAntiAlias(viewer);

    viewer.controls.enablePan = false;
    viewer.controls.enableZoom = false;
    viewer.controls.enableRotate = canOrbit;
    viewer.controls.enabled = canOrbit;

    if (variant === "bust") {
      frameBust(viewer);
    } else {
      frameFull(viewer, preset);
    }
    applyNameTag(viewer, nameTag);

    viewerRef.current = viewer;

    const ro = new ResizeObserver(() => {
      if (viewer.disposed) return;
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      viewer.setSize(w, h);
      syncAntiAlias();
      if (variant === "bust") frameBust(viewer);
      else if (preset === "home") frameFullHome(viewer);
      // profile: keep orbit pose after resize (original behavior)
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skin/nameTag/model via other effects
  }, [variant, transparent, preset, canOrbit]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;
    const result = viewer.loadSkin(skinUrl ?? steveUrl, { model });
    void Promise.resolve(result).then(() => {
      if (viewer.disposed) return;
      if (variant === "bust") frameBust(viewer);
      else frameFull(viewer, preset);
    });
  }, [skinUrl, model, variant, preset]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.disposed) return;
    applyNameTag(viewer, nameTag);
  }, [nameTag]);

  return <div ref={hostRef} className={className} />;
}
