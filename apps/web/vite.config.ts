import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverTarget = process.env.OMNI_SERVER_URL || "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.OMNI_WEB_PORT || 5173),
    proxy: {
      "/api": { target: serverTarget, changeOrigin: true },
      "/tutti": { target: serverTarget, changeOrigin: true },
      "/healthz": { target: serverTarget, changeOrigin: true },
    },
  },
});
