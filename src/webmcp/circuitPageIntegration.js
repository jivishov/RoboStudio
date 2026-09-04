import { mountCircuitWebMcp as mountCircuitWebMcpCore } from "./circuitPageIntegrationCore.js";
import { ORDINARY_WEBMCP_TOOL_COUNT, registerCircuitComponentEditTool } from "./componentEditTool.js";
import { installCanonicalTerminalClickBridge } from "./wireCommitBridge.js";

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

function ordinaryComponentEditingEnabled() {
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  return !params.has("mission") && params.get("benchmark") !== "1";
}

async function mountOrdinaryComponentEditing(handle) {
  if (!ordinaryComponentEditingEnabled()) return null;
  if (!handle?.registration?.supported || handle.registration?.error || handle.registration?.registered !== 7) return null;
  const supplemental = await registerCircuitComponentEditTool({
    getProject: handle.getProject,
    activityLog: handle.activityLog,
    onActivity: () => {
      const revision = document.querySelector("#webmcp-revision");
      if (revision && handle.revision) revision.textContent = `Revision ${handle.revision()}`;
    }
  });
  const status = document.querySelector("#webmcp-status");
  if (supplemental?.registered) {
    if (status) status.textContent = `Ready - ${ORDINARY_WEBMCP_TOOL_COUNT} tools`;
  } else if (supplemental?.error && status) {
    status.textContent = "Ready - 7 tools; component edit unavailable";
  }
  return supplemental;
}

function installBenchmarkInterruptionStatusGuard(handle) {
  const modelContext = document.modelContext;
  const panel = document.querySelector("#circuit-agent-panel");
  if (!panel || typeof modelContext?.addEventListener !== "function" || typeof modelContext?.getTools !== "function") {
    return () => {};
  }

  let runActive = false;
  const expectedToolNames = (handle?.tools ?? []).slice(0, 7).map((tool) => tool.name);

  const onPanelClick = (event) => {
    const action = event.target?.closest?.("[data-webmcp-action]")?.dataset.webmcpAction;
    if (action === "start-run") {
      queueMicrotask(() => {
        runActive = document.querySelector("#webmcp-run-status")?.textContent?.startsWith("Active:") === true;
      });
    } else if (action === "finish-run" || action === "abort-run") {
      runActive = false;
    }
  };

  const markInterrupted = () => {
    setTimeout(() => {
      const status = document.querySelector("#webmcp-run-status");
      if (status?.textContent === "No active run.") status.textContent = "Run interrupted and preserved.";
      runActive = false;
    }, 0);
  };

  const onToolChange = async () => {
    if (!runActive) return;
    try {
      const available = await modelContext.getTools();
      const names = new Set((available ?? []).map((tool) => tool?.name).filter(Boolean));
      if (expectedToolNames.every((name) => names.has(name))) return;
      markInterrupted();
    } catch {
      markInterrupted();
    }
  };

  panel.addEventListener("click", onPanelClick);
  modelContext.addEventListener("toolchange", onToolChange);
  return () => {
    panel.removeEventListener("click", onPanelClick);
    modelContext.removeEventListener?.("toolchange", onToolChange);
  };
}

export async function mountCircuitWebMcp(options = {}) {
  const disposeWireCommitBridge = installCanonicalTerminalClickBridge();
  const handle = await mountCircuitWebMcpCore(options);
  if (!handle || typeof document === "undefined") {
    disposeWireCommitBridge();
    return handle;
  }

  const componentEditRegistration = await mountOrdinaryComponentEditing(handle);
  const disposeBenchmarkStatusGuard = installBenchmarkInterruptionStatusGuard(handle);

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
    componentEditRegistration?.dispose?.();
    disposeBenchmarkStatusGuard();
    disposeWireCommitBridge();
  }, { once: true });

  if (!componentEditRegistration?.registered) return handle;
  return {
    ...handle,
    tools: [...handle.tools, componentEditRegistration.tool],
    componentEditRegistration
  };
}
