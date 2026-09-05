import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build version scheme (YYYY.MM.DD.HH) matches the Datadog sourcemap/version
// convention; injected at build time and readable via import.meta.env.
const buildVersion = new Date().toISOString().slice(0, 13).replace(/[-T]/g, ".");

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(buildVersion),
    "import.meta.env.DD_GIT_REPOSITORY_URL": JSON.stringify(process.env.DD_GIT_REPOSITORY_URL || ""),
    "import.meta.env.DD_GIT_COMMIT_SHA": JSON.stringify(process.env.DD_GIT_COMMIT_SHA || ""),
  },
  server: {
    port: 3000,
    proxy: {
      // Local dev: proxy API calls to the Flask backend (docker-compose maps 8000).
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
