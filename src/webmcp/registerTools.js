export const WEBMCP_TOOL_COUNT = 7;

function validateToolSet(tools) {
  if (!Array.isArray(tools) || tools.length !== WEBMCP_TOOL_COUNT) throw new Error(`Circuit Lab WebMCP requires exactly ${WEBMCP_TOOL_COUNT} completed tools.`);
  const names = new Set();
  for (const tool of tools) {
    if (!tool?.name || !tool?.title || !tool?.description || !tool?.inputSchema || typeof tool?.execute !== "function" || !tool?.annotations) {
      throw new Error(`Incomplete WebMCP tool definition: ${tool?.name ?? "unknown"}.`);
    }
    if (names.has(tool.name)) throw new Error(`Duplicate WebMCP tool name: ${tool.name}.`);
    names.add(tool.name);
  }
}

export function webMcpCapability(modelContext = globalThis.document?.modelContext) {
  if (!modelContext || typeof modelContext.registerTool !== "function") {
    return { supported: false, code: "unsupported", message: "WebMCP is not available in this browser." };
  }
  return { supported: true, code: "supported", message: "WebMCP is available." };
}

export async function registerWebMcpTools(tools, options = {}) {
  validateToolSet(tools);
  const modelContext = options.modelContext ?? globalThis.document?.modelContext;
  const capability = webMcpCapability(modelContext);
  if (!capability.supported) {
    options.onStatus?.({ state: "unsupported", registered: 0, total: tools.length });
    return { supported: false, registered: 0, controller: null, dispose() {} };
  }
  const controller = new AbortController();
  const pagehide = () => controller.abort();
  globalThis.addEventListener?.("pagehide", pagehide, { once: true });
  let registered = 0;
  try {
    options.onStatus?.({ state: "registering", registered, total: tools.length });
    for (const tool of tools) {
      if (controller.signal.aborted) throw new DOMException("WebMCP registration aborted", "AbortError");
      await modelContext.registerTool(tool, { signal: controller.signal });
      registered += 1;
      options.onStatus?.({ state: "registering", registered, total: tools.length });
    }
    options.onStatus?.({ state: "ready", registered, total: tools.length });
    return {
      supported: true,
      registered,
      controller,
      dispose() {
        controller.abort();
        globalThis.removeEventListener?.("pagehide", pagehide);
      }
    };
  } catch (error) {
    controller.abort();
    options.onStatus?.({ state: "failed", registered, total: tools.length, error: error?.message ?? String(error) });
    return { supported: true, registered, controller, error, dispose() { controller.abort(); } };
  }
}
