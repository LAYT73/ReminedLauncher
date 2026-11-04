import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { createReadStream, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Plugin } from "vite";

/** Dev only: serves dev-data/<file> at /__dev-data/<file> (real recipe indexes for the harness). Never part of a build. */
const devData = (): Plugin => ({
  name: "dev-data",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__dev-data", (req, res, next) => {
      const file = resolve("dev-data", basename((req.url ?? "").split("?")[0]));
      if (!existsSync(file)) return next();
      res.setHeader("Content-Type", file.endsWith(".png") ? "image/png" : "application/json");
      createReadStream(file).pipe(res);
    });
  },
});

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), devData()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
