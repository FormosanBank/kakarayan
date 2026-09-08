import react from "@vitejs/plugin-react";
import {defineConfig} from "vitest/config";
import {loadEnv} from "vite";
import {offlineShell} from "./shellPlugin.ts";

export default defineConfig(({mode}) => ({
  base: process.env.KAKARAYAN_BASE_PATH ?? "/kakarayan/",
  plugins: [react(), offlineShell(), {
    name: "download-frame-policy",
    transformIndexHtml(html) {
      const apiOrigin = new URL(loadEnv(mode, process.cwd(), "VITE_").VITE_KAKARAYAN_API_URL || "http://127.0.0.1:8000").origin;
      return html.replace("frame-src https://ai4commsci.gitbook.io;", `frame-src 'self' https://ai4commsci.gitbook.io ${apiOrigin};`);
    },
  }],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        app: "index.html",
        notFound: "404.html",
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    globals: true,
  },
}));
