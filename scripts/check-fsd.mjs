#!/usr/bin/env node
/**
 * Feature-Sliced Design import linter.
 *
 * Rules:
 *  1. Layers import only downward: app > pages > widgets > features > entities > shared.
 *  2. Slices of pages / widgets / features never import sibling slices.
 *     (Entities may import other entities through their public API.)
 *  3. Cross-slice imports go through the slice public API (`@/layer/slice`).
 *  4. A slice never imports itself through its own public API (use relative paths).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC = resolve("src");
const LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"];
const SLICELESS = new Set(["app", "shared"]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** `src/entities/pack/model/x.ts` → { layer: "entities", slice: "pack" } */
function locate(file) {
  const [layer, slice] = relative(SRC, file).split(sep);
  if (!LAYERS.includes(layer)) return { layer: null, slice: null };
  return { layer, slice: SLICELESS.has(layer) ? null : slice };
}

const importRe = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;
const errors = [];

for (const file of walk(SRC)) {
  const from = locate(file);
  if (!from.layer) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(importRe)) {
    const spec = m[1] ?? m[2];
    let target;
    if (spec.startsWith("@/")) target = resolve(SRC, spec.slice(2));
    else if (spec.startsWith(".")) target = resolve(dirname(file), spec);
    else continue;
    const to = locate(target);
    if (!to.layer) continue;
    const rel = relative(SRC, file);
    const fail = (msg) => errors.push(`${rel}: ${msg}  (${spec})`);

    const fromIdx = LAYERS.indexOf(from.layer);
    const toIdx = LAYERS.indexOf(to.layer);
    if (toIdx < fromIdx) {
      fail(`layer "${from.layer}" must not import upward from "${to.layer}"`);
      continue;
    }
    if (to.layer === "shared" || (to.layer === from.layer && !from.slice)) continue;

    const sameSlice = to.layer === from.layer && to.slice === from.slice;
    if (sameSlice) {
      if (!spec.startsWith(".")) fail("import within a slice must be relative");
      continue;
    }
    if (to.layer === from.layer && from.layer !== "entities") {
      fail(`slice "${from.slice}" must not import sibling slice "${to.slice}"`);
      continue;
    }
    // cross-slice → public API only
    const publicApi = resolve(SRC, to.layer, to.slice);
    if (target !== publicApi && target !== join(publicApi, "index")) {
      fail(`import "${to.layer}/${to.slice}" through its public API (index.ts)`);
    }
  }
}

if (errors.length) {
  console.error(`FSD violations (${errors.length}):\n` + errors.map((e) => "  " + e).join("\n"));
  process.exit(1);
}
console.log("FSD: no violations");
