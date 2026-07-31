import react from "@vitejs/plugin-react";
import {defineConfig} from "vitest/config";

export default defineConfig({
  base: process.env.KAKARAYAN_BASE_PATH ?? "/kakarayan/",
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    globals: true,
  },
});
