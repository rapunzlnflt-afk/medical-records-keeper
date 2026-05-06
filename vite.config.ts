import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

function readGitCommit(): string {
  if (process.env.VITE_BUILD_COMMIT) return process.env.VITE_BUILD_COMMIT;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 8);
  try {
    return execSync("git rev-parse --short=8 HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const BUILD_COMMIT = readGitCommit();
const BUILD_TIME = new Date().toISOString();
const BUILD_TAG = `${BUILD_COMMIT}-${BUILD_TIME.replace(/[:.]/g, "-")}`;

// Substitutes the BUILD_TAG placeholder inside the service worker after it
// has been copied from /public into the build output. Without this, every
// deploy ships an SW with the same cache name and old shells stay pinned.
function stampServiceWorker(outDir: string): Plugin {
  return {
    name: "stamp-service-worker",
    apply: "build",
    closeBundle() {
      const swPath = path.join(outDir, "sw.js");
      try {
        const original = readFileSync(swPath, "utf8");
        const stamped = original.replace(/__BUILD_TAG__/g, BUILD_TAG);
        writeFileSync(swPath, stamped, "utf8");
      } catch (err) {
        console.warn(`[stamp-service-worker] could not stamp ${swPath}:`, err);
      }
    },
  };
}

const outDir = path.resolve(import.meta.dirname, "dist/public");

export default defineConfig({
  plugins: [react(), stampServiceWorker(outDir)],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  envDir: path.resolve(import.meta.dirname),
  base: process.env.VITE_BASE_PATH || "./",
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
