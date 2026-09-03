import { mountCircuitWebMcp as mountCircuitWebMcpCore } from "./circuitPageIntegrationCore.js";

function hardHideUnavailableAssistant() {
  for (const root of document.querySelectorAll(".assistant-card")) {
    const availability = root.dataset.assistantAvailability;
    if (!availability || availability === "available") continue;
    root.hidden = true;
    root.inert = true;
    root.style.setProperty("display", "none", "important");
    root.style.setProperty("pointer-events", "none", "important");
  }
}

function surfaceNewPendingAction() {
  const pendingCard = document.querySelector("#webmcp-pending-card");
  const agentPanel = document.querySelector("#circuit-agent-panel");
  if (!pendingCard || pendingCard.hidden || !agentPanel?.hidden) return;
  document.querySelector("#circuit-tab-agent")?.click();
}

export async function mountCircuitWebMcp(options = {}) {
  const handle = await mountCircuitWebMcpCore(options);
  if (!handle || typeof document === "undefined") return handle;

  hardHideUnavailableAssistant();
  surfaceNewPendingAction();

  const pendingCard = document.querySelector("#webmcp-pending-card");
  const pendingObserver = pendingCard ? new MutationObserver(() => surfaceNewPendingAction()) : null;
  pendingObserver?.observe(pendingCard, { attributes: true, attributeFilter: ["hidden"] });

  const assistantObserver = new MutationObserver(() => hardHideUnavailableAssistant());
  assistantObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-assistant-availability"]
  });

  globalThis.addEventListener("pagehide", () => {
    pendingObserver?.disconnect();
    assistantObserver.disconnect();
  }, { once: true });

  return handle;
}
