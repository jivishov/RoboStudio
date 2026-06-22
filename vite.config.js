import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import { createAssistantAttachmentStore } from "./src/assistant/attachments.js";
import { createAssistantAttachmentsMiddleware, createAssistantProxyMiddleware } from "./src/assistant/serverProxy.js";
import { createAdvancedCadCompileMiddleware } from "./src/cad/advancedCadMiddleware.js";

function assistantProxyPlugin(apiKeyProvider, options = {}) {
  const attachmentStore = createAssistantAttachmentStore();
  const advancedCadMiddleware = createAdvancedCadCompileMiddleware({
    pythonCommand: options.cadPythonCommand
  });
  return {
    name: "robotic-arm-assistant-proxy",
    configureServer(server) {
      server.middlewares.use("/api/assistant/attachments", createAssistantAttachmentsMiddleware({ apiKeyProvider, attachmentStore }));
      server.middlewares.use("/api/assistant/respond", createAssistantProxyMiddleware({ apiKeyProvider, attachmentStore }));
      server.middlewares.use("/api/cad/compile", advancedCadMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/assistant/attachments", createAssistantAttachmentsMiddleware({ apiKeyProvider, attachmentStore }));
      server.middlewares.use("/api/assistant/respond", createAssistantProxyMiddleware({ apiKeyProvider, attachmentStore }));
      server.middlewares.use("/api/cad/compile", advancedCadMiddleware);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKeyProvider = () => env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const cadPythonCommand = env.ROBOSTUDIO_CAD_PYTHON || process.env.ROBOSTUDIO_CAD_PYTHON || "python";
  const isProduction = mode === "production";

  return {
    base: isProduction ? "/RoboStudio/" : "/",
    plugins: [assistantProxyPlugin(apiKeyProvider, { cadPythonCommand })],
    publicDir: isProduction ? false : "STL_files",
    build: {
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          physics: resolve(__dirname, "physics.html"),
          parts: resolve(__dirname, "parts.html"),
          circuits: resolve(__dirname, "circuits.html"),
          electronics: resolve(__dirname, "electronics.html"),
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
