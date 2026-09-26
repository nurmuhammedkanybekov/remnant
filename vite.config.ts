import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    // three.js alone is ~600 kB minified; that's expected for this project.
    chunkSizeWarningLimit: 900,
  },
});
