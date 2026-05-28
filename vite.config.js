import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import { createAssistantProxyMiddleware } from "./src/assistant/serverProxy.js";

function assistantProxyPlugin(apiKeyProvider) {
  return {
    name: "robotic-arm-assistant-proxy",
    configureServer(server) {
      server.middlewares.use("/api/assistant/respond", createAssistantProxyMiddleware({ apiKeyProvider }));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/assistant/respond", createAssistantProxyMiddleware({ apiKeyProvider }));
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKeyProvider = () => env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const isProduction = mode === "production";

  return {
    base: isProduction ? "/RoboStudio/" : "/",
    plugins: [assistantProxyPlugin(apiKeyProvider)],
    publicDir: isProduction ? false : "STL_files",
    build: {
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          physics: resolve(__dirname, "physics.html"),
          parts: resolve(__dirname, "parts.html"),
          authCallback: resolve(__dirname, "auth-callback.html")
        }
      }
    },
    server: {
      host: "127.0.0.1"
    },
    preview: {
      host: "127.0.0.1"
    }
  };
});
