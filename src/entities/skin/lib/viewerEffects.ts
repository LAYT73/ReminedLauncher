import { DirectionalLight } from "three";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import type { SkinViewer } from "skinview3d";

/**
 * Soften silhouette “stairs” (aliasing).
 * skinview3d already runs FXAA; SMAA + mild supersample looks cleaner on blocky skins.
 */
export function enableSkinAntiAlias(viewer: SkinViewer): () => void {
  // Render sharper than CSS pixels (capped so retina doesn’t melt the GPU)
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  viewer.pixelRatio = Math.min(dpr * 1.5, 2.5);

  viewer.fxaaPass.enabled = false;
  const pr = viewer.renderer.getPixelRatio();
  const smaa = new SMAAPass(viewer.width * pr, viewer.height * pr);
  viewer.composer.addPass(smaa);

  return () => {
    if (viewer.disposed) return;
    const nextPr = viewer.renderer.getPixelRatio();
    smaa.setSize(viewer.width * nextPr, viewer.height * nextPr);
  };
}

/**
 * Home splash only — form shading on the character (no ground shadow).
 * Profile keeps skinview3d defaults (even light from all sides).
 */
export function enableHomeSkinShading(viewer: SkinViewer) {
  viewer.renderer.shadowMap.enabled = false;

  viewer.globalLight.intensity = 0.7;
  viewer.cameraLight.intensity = 0.45;

  const key = new DirectionalLight(0xffffff, 3.55);
  key.position.set(40, 22, 44);
  key.castShadow = false;
  viewer.scene.add(key);

  const fill = new DirectionalLight(0xfff4ea, 0.35);
  fill.position.set(14, 6, -8);
  fill.castShadow = false;
  viewer.scene.add(fill);
}
