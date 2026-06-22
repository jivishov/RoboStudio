import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/",
  build: {
    rollupOptions: {
      input: {
        calibration: resolve(process.cwd(), "tools/circuit-visual-calibration/index.html")
      }
    }
  },
  server: {
    host: "127.0.0.1"
  }
});
