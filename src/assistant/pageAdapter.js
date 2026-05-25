import { getActionDefinition, validateActionArguments } from "./actionCatalog.js";

function normalizeActionResult(actionName, result) {
  if (result && typeof result === "object" && "ok" in result) return result;
  return {
    ok: true,
    action: actionName,
    message: typeof result === "string" ? result : "Action completed.",
    data: result && typeof result === "object" ? result : undefined
  };
}

export function createPageAssistantAdapter({ pageId, title, getContext, actions }) {
  if (!pageId) throw new Error("Assistant page adapter requires a pageId.");
  if (!actions || typeof actions !== "object") throw new Error("Assistant page adapter requires actions.");

  return {
    pageId,
    title,
    getContext: () => {
      const context = getContext?.() ?? {};
      return JSON.parse(JSON.stringify(context));
    },
    async executeAction(actionName, args = {}) {
      const definition = getActionDefinition(pageId, actionName);
      if (!definition) {
        throw new Error(`Unknown assistant action: ${actionName}`);
      }
      const validation = validateActionArguments(pageId, actionName, args);
      if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
      }
      const handler = actions[actionName];
      if (typeof handler !== "function") {
        throw new Error(`No page handler is registered for ${actionName}`);
      }
      return normalizeActionResult(actionName, await handler(args));
    }
  };
}
