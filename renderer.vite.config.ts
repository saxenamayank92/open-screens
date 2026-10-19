import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "receiver",
  base: "./",
  plugins: [react()],
  publicDir: "../public",
  build: {
    outDir: "../android/app/src/main/assets/renderer",
    emptyOutDir: true,
  },
});
