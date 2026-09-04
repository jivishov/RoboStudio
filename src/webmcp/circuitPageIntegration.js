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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCircuitActionAdapter(timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.querySelector(".assistant-card") && typeof window.__circuitLabCycle4?.executeAssistantAction === "function") return true;
    await sleep(25);
  }
  return false;
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

function installPendingGenerationGuard(handle) {
  let pendingGenerationAdvanced = false;

  const pendingVisible = () => {
    const card = document.querySelector("#webmcp-pending-card");
    return Boolean(card && !card.hidden);
  };

  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (!pendingVisible()) {
      pendingGenerationAdvanced = false;
      return;
    }

    const pendingAction = target.closest("[data-webmcp-pending-action]")?.dataset.webmcpPendingAction;
    if (!pendingAction && target.closest("#circuit-component-list [data-component-id], #circuit-wire-list [data-connection-id], [data-circuit-mode]")) {
      pendingGenerationAdvanced = true;
      return;
    }

    if (pendingAction !== "confirm" || !pendingGenerationAdvanced) return;

    const project = handle?.getProject?.();
    const alternate = project?.components?.find((component) => component.id !== project.selectedComponentId);
    if (!alternate) return;
    const escape = globalThis.CSS?.escape ? globalThis.CSS.escape(alternate.id) : String(alternate.id).replace(/(["\\])/g, "\\$1");
    const item = document.querySelector(`#circuit-component-list [data-component-id="${escape}"]`);
    if (!item) return;

    // Circuit Lab increments its internal transaction generation even when a selection
    // resolves to the same canonical design. Re-selecting a different component here
    // mirrors that generation advance into the full project fingerprint so the existing
    // commitStagedMutation() stale-base check rejects the pending destructive plan.
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    pendingGenerationAdvanced = false;
  };

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

export async function mountCircuitWebMcp(options = {}) {
  // Circuit Lab mounts its page-action adapter after workspace hydration. Waiting here
  // keeps WebMCP tool results atomic with the canonical page action instead of returning
  // mechanically_blocked while a deferred synthetic click commits later.
  await waitForCircuitActionAdapter();
  const disposeWireCommitBridge = installCanonicalTerminalClickBridge();
  const handle = await mountCircuitWebMcpCore(options);
  if (!handle || typeof document === "undefined") {
    disposeWireCommitBridge();
    return handle;
  }

  const componentEditRegistration = await mountOrdinaryComponentEditing(handle);
  const disposeBenchmarkStatusGuard = installBenchmarkInterruptionStatusGuard(handle);
  const disposePendingGenerationGuard = installPendingGenerationGuard(handle);

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
    disposePendingGenerationGuard();
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
