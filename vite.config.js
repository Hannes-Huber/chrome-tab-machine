import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    rollupOptions: {
      input: fileURLToPath(new URL("./popup.html", import.meta.url))
    }
  },
  plugins: [{
    name: "copy-extension-manifest",
    closeBundle() {
      copyFileSync(`${projectRoot}manifest.json`, `${projectRoot}dist/manifest.json`);
    }
  }]
});
