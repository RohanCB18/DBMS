import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on :8100 (see README). /api is proxied so the app uses relative URLs
// in development and behind nginx in production alike.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.ZTDB_API ?? "http://localhost:8100", changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 2500 },
  test: { environment: "node" },
} as any);
