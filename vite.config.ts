import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Relative asset paths, so the built game works from any URL —
  // including GitHub Pages' https://<user>.github.io/remnant/ subfolder.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
  },
  build: {
    // three.js alone is ~600 kB minified; that's expected for this project.
    chunkSizeWarningLimit: 900,
  },
});
