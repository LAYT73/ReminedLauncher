#!/usr/bin/env node
// Bundles scripts/check-schematic.ts with esbuild (already a vite dependency) and runs it.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const out = join(mkdtempSync(join(tmpdir(), "schem-bundle-")), "check.mjs");
await build({
  entryPoints: [resolve("scripts/check-schematic.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "error",
  alias: { "@": resolve("src") },
});
writeFileSync(out + ".pkg", "");
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
