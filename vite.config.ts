import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the built game works from any URL —
  // including GitHub Pages' https://<user>.github.io/remnant/ subfolder.
  base: "./",
  server: {
    port: 5173,
  },
  build: {
    // three.js alone is ~600 kB minified; that's expected for this project.
    chunkSizeWarningLimit: 900,
  },
});
