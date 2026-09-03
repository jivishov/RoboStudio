import "./webmcp.css";
import { commitHistory, currentHistoryValue, resetHistory, subscribeHistoryChanges } from "../history.js";
import { normalizeMechatronicsBinding } from "../mechatronics/model.js";
import { normalizeProject } from "../circuits/model.js";
import { commitStagedMutation } from "../circuits/transactions.js";
import { circuitDesignRevision } from "../circuits/designRevision.js";
import {
  SERVO_REPAIR_MISSION_ID,
  SERVO_REPAIR_PROMPT,
  createServoRepairMission,
  servoRepairMissionMetadata
} from "../circuits/demoMissions.js";
import { createWorkspaceStore } from "../workspaceStore.js";
import { createActivityLog } from "./activityLog.js";
import { createCircuitWebMcpTools } from "./circuitTools.js";
import { registerWebMcpTools } from "./registerTools.js";
import {
  compareBenchmarkConfigurations,
  createBenchmarkRunMetadata,
  loadBenchmarkRuns,
  saveBenchmarkRuns,
  scoreServoRepairRun,
  summarizeBenchmarkRun
} from "./circuitBenchmark.js";

const mountedHistories = new WeakSet();
const INVALID_CALL_CODES = new Set(["invalid_arguments", "unknown_id", "mechanically_blocked", "stale_revision"]);

function queryState() {
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  return {
    missionId: params.get("mission"),
    mission: params.get("mission") === SERVO_REPAIR_MISSION_ID,
    benchmarkVisible: params.get("benchmark") === "1"
  };
}

function dispatchClick(element) {
  if (!element) return false;
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: globalThis.window }));
  return true;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/(["\\])/g, "\\$1");
}

function downloadText(name, content, type = "application/json;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && globalThis.isSecureContext) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function safeLabel(value, max = 64) {
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownCell(value) {
  return safeLabel(value, 80).replace(/\|/g, "\\|");
}

function benchmarkMarkdown(runs) {
  const comparison = compareBenchmarkConfigurations(runs);
  const lines = [
    "# RoboStudio Quick Model Benchmark",
    "",
    comparison.disclaimer,
    "",
    "| Model | Client | Configuration | Runs | Pass rate | Median passing score | Evidence |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |"
  ];
  for (const row of comparison.configurations) {
    lines.push(`| ${markdownCell(row.modelLabel)} | ${markdownCell(row.clientLabel)} | ${markdownCell(row.configLabel)} | ${row.runCount} | ${(row.passRate * 100).toFixed(0)}% | ${row.medianPassingScore.toFixed(1)} | ${markdownCell(row.evidenceLabel)}${comparison.bestObservedComparisonKey === row.comparisonKey ? " / Best observed on this mission" : ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

function createAgentUi(state) {
  const nav = document.querySelector(".circuit-workflow-tabs");
  const workflowPanel = document.querySelector("#circuit-workflow-panel");
  const drawer = document.querySelector("#circuit-workflow-drawer");
  if (!nav || !workflowPanel || !drawer) return null;

  const tab = document.createElement("button");
  tab.id = "circuit-tab-agent";
  tab.type = "button";
  tab.role = "tab";
  tab.textContent = "Agent";
  tab.setAttribute("aria-selected", "false");
  tab.setAttribute("aria-controls", "circuit-agent-panel");
  nav.append(tab);

  const panel = document.createElement("section");
  panel.id = "circuit-agent-panel";
  panel.className = "webmcp-agent-panel";
  panel.role = "tabpanel";
  panel.setAttribute("aria-labelledby", tab.id);
  panel.hidden = true;
  panel.innerHTML = `
    <section class="webmcp-card">
      <div class="webmcp-card__header"><strong>WebMCP Agent</strong><output id="webmcp-status">Checking support…</output></div>
      <p id="webmcp-revision" class="webmcp-mono"></p>
    </section>
    <section id="webmcp-mission-card" class="webmcp-card" hidden>
      <div class="webmcp-card__header"><strong>Servo Repair Mission</strong><span>servo-repair-v1</span></div>
      <p>Repair servo power and common ground while preserving Arduino D9 signal. RoboStudio remains the deterministic engineering authority.</p>
      <div class="webmcp-actions">
        <button type="button" data-webmcp-action="copy-prompt">Copy Prompt</button>
        <button type="button" data-webmcp-action="open-benchmark">Open Benchmark</button>
        <button type="button" data-webmcp-action="reset-mission">Reset Mission</button>
        <button type="button" data-webmcp-action="save-mission">Save as Current Project</button>
        <button type="button" data-webmcp-action="exit-demo">Exit Demo</button>
      </div>
    </section>
    <section id="webmcp-pending-card" class="webmcp-card webmcp-card--pending" hidden>
      <div class="webmcp-card__header"><strong>Pending Action</strong><span>Awaiting user</span></div>
      <p id="webmcp-pending-summary"></p>
      <div id="webmcp-pending-ids" class="webmcp-mono"></div>
      <div id="webmcp-pending-actions" class="webmcp-actions"></div>
    </section>
    <section class="webmcp-card">
      <div class="webmcp-card__header"><strong>Recent Activity</strong><span>Session only</span></div>
      <div id="webmcp-activity" class="webmcp-activity"><p>No agent activity yet.</p></div>
    </section>
    <section id="webmcp-benchmark-card" class="webmcp-card" ${state.benchmarkVisible ? "" : "hidden"}>
      <div class="webmcp-card__header"><strong>Quick Model Benchmark</strong><span>Mission-specific</span></div>
      <p class="webmcp-fineprint">Labels are entered manually. Results measure this scenario/toolset/rubric only, not general model intelligence.</p>
      <label>Model<input id="webmcp-model-label" maxlength="64" autocomplete="off"></label>
      <label>Client<input id="webmcp-client-label" maxlength="64" autocomplete="off" value="ChatGPT in-app browser"></label>
      <label>Configuration<input id="webmcp-config-label" maxlength="64" autocomplete="off"></label>
      <label>Narrative review<select id="webmcp-manual-review"><option value="not-reviewed">Not reviewed</option><option value="pass">Pass</option><option value="fail">Fail</option></select></label>
      <div class="webmcp-actions">
        <button type="button" data-webmcp-action="start-run">Start Run</button>
        <button type="button" data-webmcp-action="finish-run" disabled>Finish and Score</button>
        <button type="button" data-webmcp-action="abort-run" disabled>Abort Run</button>
      </div>
      <p id="webmcp-run-status" class="webmcp-mono">No active run.</p>
      <div class="webmcp-actions">
        <button type="button" data-webmcp-action="export-runs">Export JSON</button>
        <button type="button" data-webmcp-action="export-summary">Export Markdown</button>
        <button type="button" data-webmcp-action="import-runs">Import JSON</button>
        <input id="webmcp-import-input" type="file" accept="application/json,.json" hidden>
      </div>
      <div id="webmcp-comparison" class="webmcp-comparison"></div>
    </section>
  `;
  drawer.append(panel);

  let agentActive = false;
  function activateAgent() {
    agentActive = true;
    workflowPanel.hidden = true;
    panel.hidden = false;
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    for (const button of nav.querySelectorAll("[data-circuit-tab]")) {
      button.classList.remove("is-active");
      button.setAttribute("aria-selected", "false");
    }
  }
  function deactivateAgent() {
    agentActive = false;
    panel.hidden = true;
    workflowPanel.hidden = false;
    tab.classList.remove("is-active");
    tab.setAttribute("aria-selected", "false");
  }
  tab.addEventListener("click", activateAgent);
  for (const button of nav.querySelectorAll("[data-circuit-tab]")) button.addEventListener("click", deactivateAgent);

  return { tab, panel, workflowPanel, activateAgent, deactivateAgent, isAgentActive: () => agentActive };
}

function hideUnavailableAssistantInDemo(state) {
  if (!state.mission && !state.benchmarkVisible) return () => {};
  const apply = () => {
    for (const root of document.querySelectorAll(".assistant-card")) {
      if (root.dataset.assistantAvailability && root.dataset.assistantAvailability !== "available") root.hidden = true;
    }
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export async function mountCircuitWebMcp({ history } = {}) {
  if (!history || mountedHistories.has(history) || typeof document === "undefined") return null;
  mountedHistories.add(history);
  const state = queryState();
  const activityLog = createActivityLog();
  let registration = null;
  let agentPending = null;
  let internalInteraction = false;
  let historyMutationActor = null;
  let protectedSave = false;
  let benchmarkLock = false;
  let activeRun = null;
  let activeRunAgentOnly = true;
  let activeRunStartedPerf = 0;
  let lastObservedRevision = circuitDesignRevision(normalizeProject(currentHistoryValue(history)));
  let ordinaryRobotDesign = null;
  const workspaceStore = createWorkspaceStore();

  if (state.mission) {
    withInternalInteraction(() => resetHistory(history, createServoRepairMission()), "system");
    lastObservedRevision = circuitDesignRevision(normalizeProject(currentHistoryValue(history)));
  } else {
    workspaceStore.readCurrentRobotDesign().then((design) => { ordinaryRobotDesign = design ?? null; }).catch(() => {});
  }

  const ui = createAgentUi(state);
  if (!ui) return null;
  const statusEl = ui.panel.querySelector("#webmcp-status");
  const revisionEl = ui.panel.querySelector("#webmcp-revision");
  const missionCard = ui.panel.querySelector("#webmcp-mission-card");
  const pendingCard = ui.panel.querySelector("#webmcp-pending-card");
  const pendingSummary = ui.panel.querySelector("#webmcp-pending-summary");
  const pendingIds = ui.panel.querySelector("#webmcp-pending-ids");
  const pendingActions = ui.panel.querySelector("#webmcp-pending-actions");
  const activityEl = ui.panel.querySelector("#webmcp-activity");
  const benchmarkCard = ui.panel.querySelector("#webmcp-benchmark-card");
  const runStatus = ui.panel.querySelector("#webmcp-run-status");
  const comparisonEl = ui.panel.querySelector("#webmcp-comparison");
  const importInput = ui.panel.querySelector("#webmcp-import-input");
  if (state.mission) missionCard.hidden = false;
  if (state.mission || state.benchmarkVisible) ui.activateAgent();

  function getProject() {
    return normalizeProject(currentHistoryValue(history));
  }

  function revision() {
    return circuitDesignRevision(getProject());
  }

  function existingElectricalConfirmationVisible() {
    const element = document.querySelector("#circuit-mutation-confirmation");
    return Boolean(element && !element.hidden);
  }

  function pendingState() {
    if (agentPending) return { ...agentPending };
    if (existingElectricalConfirmationVisible()) return { kind: "electrical-hazard", connectionIds: [] };
    return null;
  }

  function bindingFromUi() {
    if (state.mission) return normalizeMechatronicsBinding();
    const textarea = document.querySelector("#circuit-binding-json");
    if (!textarea?.value?.trim()) return normalizeMechatronicsBinding();
    try { return normalizeMechatronicsBinding(JSON.parse(textarea.value)); } catch { return normalizeMechatronicsBinding(); }
  }

  function renderActivity() {
    const events = activityLog.recent(12).reverse();
    activityEl.innerHTML = events.length ? events.map((event) => `
      <article class="webmcp-event">
        <div><strong>${escapeHtml(event.toolName ?? event.actor)}</strong><span>${escapeHtml(event.code ?? event.status)}</span></div>
        <small>${escapeHtml(event.revisionBefore ?? "—")}${event.revisionAfter && event.revisionAfter !== event.revisionBefore ? ` → ${escapeHtml(event.revisionAfter)}` : ""}${event.durationMs != null ? ` / ${Number(event.durationMs)} ms` : ""}</small>
      </article>
    `).join("") : "<p>No agent activity yet.</p>";
  }

  function renderPending() {
    const pending = pendingState();
    pendingCard.hidden = !pending;
    if (!pending) return;
    pendingSummary.textContent = pending.kind === "agent-destructive"
      ? "An agent-requested connection removal is waiting for your confirmation."
      : "An electrically hazardous change is waiting for your confirmation in the bench confirmation panel.";
    pendingIds.textContent = (pending.connectionIds ?? []).join(", ") || pending.kind;
    pendingActions.replaceChildren();
    if (pending.kind === "agent-destructive") {
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.textContent = "Confirm removal";
      confirm.dataset.webmcpPendingAction = "confirm";
      confirm.className = "webmcp-danger";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.dataset.webmcpPendingAction = "cancel";
      pendingActions.append(confirm, cancel);
    }
  }

  function renderComparison() {
    const runs = loadBenchmarkRuns();
    const comparison = compareBenchmarkConfigurations(runs);
    if (!comparison.configurations.length) {
      comparisonEl.innerHTML = "<p>No completed benchmark records yet.</p>";
      return;
    }
    const recentRuns = runs.slice(-5).reverse();
    comparisonEl.innerHTML = comparison.configurations.slice(0, 6).map((row) => `
      <article class="webmcp-comparison-row">
        <strong>${escapeHtml(row.modelLabel)} / ${escapeHtml(row.configLabel)}</strong>
        <span>${row.runCount} runs / ${(row.passRate * 100).toFixed(0)}% pass / ${escapeHtml(row.evidenceLabel)}${comparison.bestObservedComparisonKey === row.comparisonKey ? " / Best observed on this mission" : ""}</span>
      </article>
    `).join("") + (recentRuns.length ? `
      <div class="webmcp-recent-runs">
        <strong>Recent preserved runs</strong>
        ${recentRuns.map((run) => `<span>${escapeHtml(run.modelLabel)} / ${escapeHtml(run.configLabel)} — ${escapeHtml(run.status === "completed" ? (run.pass ? "PASS" : "FAIL") : run.status.toUpperCase())}${run.status === "completed" ? ` / ${Number(run.totalScore).toFixed(0)}` : ""}</span>`).join("")}
      </div>` : "") + `<p class="webmcp-fineprint">${escapeHtml(comparison.disclaimer)}</p>`;
  }

  function renderBenchmarkState() {
    const start = ui.panel.querySelector('[data-webmcp-action="start-run"]');
    const finish = ui.panel.querySelector('[data-webmcp-action="finish-run"]');
    const abort = ui.panel.querySelector('[data-webmcp-action="abort-run"]');
    start.disabled = Boolean(activeRun);
    finish.disabled = !activeRun;
    abort.disabled = !activeRun;
    runStatus.textContent = activeRun
      ? `Active: ${activeRun.modelLabel} / ${activeRun.clientLabel} / ${activeRun.configLabel}${activeRunAgentOnly ? " / agent-only" : " / assisted-unranked"}`
      : "No active run.";
    renderComparison();
  }

  function renderAgent() {
    revisionEl.textContent = `Revision ${revision()}`;
    renderPending();
    renderActivity();
    renderBenchmarkState();
    if (ui.isAgentActive()) ui.activateAgent();
  }

  function withInternalInteraction(fn, actor = "webmcp") {
    const previousInteraction = internalInteraction;
    const previousActor = historyMutationActor;
    internalInteraction = true;
    historyMutationActor = actor;
    try { return fn(); } finally {
      internalInteraction = previousInteraction;
      historyMutationActor = previousActor;
    }
  }

  function forcePageRender() {
    const selectButton = document.querySelector('[data-circuit-mode="select"]');
    if (selectButton) withInternalInteraction(() => dispatchClick(selectButton));
    lastObservedRevision = revision();
    renderAgent();
  }

  function cancelAnyPending(reason = "system_cancelled") {
    const pending = agentPending;
    if (pending) {
      activityLog.record({ activityId: pending.activityId, actor: "system", status: "complete", code: reason, revisionBefore: revision(), revisionAfter: revision(), affectedConnectionIds: pending.connectionIds ?? [] });
      agentPending = null;
    }
    const cancel = document.querySelector("#cancel-circuit-mutation");
    if (existingElectricalConfirmationVisible() && cancel) withInternalInteraction(() => dispatchClick(cancel), "system");
    renderAgent();
  }

  function resetMission({ record = true } = {}) {
    const before = revision();
    cancelAnyPending("pending_cancelled_by_mission_reset");
    withInternalInteraction(() => resetHistory(history, createServoRepairMission()), "system");
    forcePageRender();
    const after = revision();
    if (record) activityLog.record({ actor: "system", status: "complete", code: "mission_reset", revisionBefore: before, revisionAfter: after });
    lastObservedRevision = after;
    renderAgent();
  }

  async function focusIssue(issueId, focusTarget) {
    const tab = document.querySelector("#circuit-tab-test-results");
    if (tab) dispatchClick(tab);
    await Promise.resolve();
    const issue = document.querySelector(`[data-issue-id="${cssEscape(issueId)}"]`);
    if (issue) dispatchClick(issue);
    if (focusTarget?.type === "connection" && focusTarget.id) {
      const connection = document.querySelector(`#circuit-wire-list [data-connection-id="${cssEscape(focusTarget.id)}"]`);
      if (connection) dispatchClick(connection);
    }
    const componentId = focusTarget?.type === "component"
      ? focusTarget.id
      : focusTarget?.type === "terminal"
        ? focusTarget.endpoint?.componentId
        : null;
    if (componentId) {
      const component = document.querySelector(`#circuit-component-list [data-component-id="${cssEscape(componentId)}"]`);
      if (component) dispatchClick(component);
    }
    const frame = document.querySelector("#circuit-view-frame");
    if (frame) dispatchClick(frame);
  }

  function terminalElement(endpoint) {
    return [...document.querySelectorAll("[data-terminal-component][data-terminal-id]")].find((element) => (
      element.dataset.terminalComponent === endpoint.componentId && element.dataset.terminalId === endpoint.terminalId
    )) ?? null;
  }

  async function connectEndpoints(endpointA, endpointB, options = {}) {
    if (options.expectedRevision !== revision()) return { status: "blocked", code: "stale_revision", summary: "Circuit revision changed before the live interaction." };
    const before = revision();
    const beforeIds = new Set(getProject().connections.map((connection) => connection.id));
    withInternalInteraction(() => {
      dispatchClick(document.querySelector('[data-circuit-mode="select"]'));
      dispatchClick(document.querySelector('[data-circuit-mode="wire"]'));
      const first = terminalElement(endpointA);
      if (!first) return;
      dispatchClick(first);
      const second = terminalElement(endpointB);
      if (second) dispatchClick(second);
    });
    await Promise.resolve();
    const after = revision();
    const afterProject = getProject();
    const added = afterProject.connections.filter((connection) => !beforeIds.has(connection.id)).map((connection) => connection.id);
    if (after !== before) {
      lastObservedRevision = after;
      if (benchmarkLock) withInternalInteraction(() => dispatchClick(document.querySelector('[data-circuit-mode="select"]')));
      return { status: "committed", connectionIds: added };
    }
    if (existingElectricalConfirmationVisible()) {
      agentPending = {
        kind: "electrical-hazard",
        connectionIds: options.predictedConnectionIds ?? [],
        activityId: options.activityId ?? null,
        requestedAt: new Date().toISOString(),
        revisionBefore: before
      };
      renderAgent();
      return { status: "pending_confirmation" };
    }
    return { status: "blocked", code: "mechanically_blocked", summary: "The live page did not commit or present a confirmation for the requested connection." };
  }

  async function requestRemoval(connectionIds, options = {}) {
    if (options.expectedRevision !== revision()) return { status: "blocked", code: "stale_revision", summary: "Circuit revision changed before the removal request could be staged." };
    if (!options.mutation || options.mutation.status === "mechanically-impossible") return { status: "blocked", code: "mechanically_blocked", summary: "The disconnect transaction could not be staged." };
    agentPending = {
      kind: "agent-destructive",
      connectionIds: [...connectionIds],
      activityId: options.activityId ?? null,
      requestedAt: new Date().toISOString(),
      revisionBefore: revision(),
      mutation: options.mutation
    };
    renderAgent();
  }

  function confirmAgentRemoval() {
    if (!agentPending || agentPending.kind !== "agent-destructive") return;
    const pending = agentPending;
    const before = revision();
    if (before !== pending.revisionBefore) {
      activityLog.record({ activityId: pending.activityId, actor: "human-confirmation", status: "error", code: "stale_confirmation", revisionBefore: pending.revisionBefore, revisionAfter: before, affectedConnectionIds: pending.connectionIds });
      agentPending = null;
      renderAgent();
      return;
    }
    const committed = commitStagedMutation(getProject(), pending.mutation?.baseGeneration ?? 0, pending.mutation);
    if (!committed.ok) {
      activityLog.record({ activityId: pending.activityId, actor: "human-confirmation", status: "error", code: "stale_confirmation", revisionBefore: before, revisionAfter: before, affectedConnectionIds: pending.connectionIds });
      agentPending = null;
      renderAgent();
      return;
    }
    agentPending = null;
    withInternalInteraction(() => commitHistory(history, committed.project), "human-confirmation");
    forcePageRender();
    const after = revision();
    activityLog.record({ activityId: pending.activityId, actor: "human-confirmation", status: "complete", code: "confirmed", revisionBefore: before, revisionAfter: after, affectedConnectionIds: pending.connectionIds });
    lastObservedRevision = after;
    renderAgent();
  }

  function cancelAgentRemoval() {
    if (!agentPending || agentPending.kind !== "agent-destructive") return;
    const pending = agentPending;
    agentPending = null;
    activityLog.record({ activityId: pending.activityId, actor: "human-confirmation", status: "complete", code: "user_cancelled", revisionBefore: revision(), revisionAfter: revision(), affectedConnectionIds: pending.connectionIds });
    renderAgent();
  }

  const runtime = {
    getProject,
    getPendingConfirmation: pendingState,
    getMissionStatus: () => state.mission ? { id: SERVO_REPAIR_MISSION_ID, isolated: true } : null,
    getBinding: bindingFromUi,
    getRobotDesign: () => state.mission ? null : ordinaryRobotDesign,
    focusIssue,
    connectEndpoints,
    requestRemoval,
    activityLog,
    onActivity: () => {
      lastObservedRevision = revision();
      renderAgent();
    }
  };

  const tools = createCircuitWebMcpTools(runtime);
  registration = await registerWebMcpTools(tools, {
    onStatus(info) {
      if (info.state === "ready") statusEl.textContent = `Ready - ${info.registered} tools`;
      else if (info.state === "unsupported") statusEl.textContent = "Unsupported";
      else if (info.state === "failed") statusEl.textContent = "Registration failed";
      else statusEl.textContent = `Registering ${info.registered}/${info.total}`;
    }
  });

  const modelContext = document.modelContext;
  const handleToolChange = async () => {
    if (!activeRun || typeof modelContext?.getTools !== "function") return;
    try {
      const available = await modelContext.getTools();
      const names = new Set((available ?? []).map((tool) => tool?.name).filter(Boolean));
      if (!tools.every((tool) => names.has(tool.name))) abortBenchmark("interrupted");
    } catch {
      abortBenchmark("interrupted");
    }
  };
  modelContext?.addEventListener?.("toolchange", handleToolChange);

  const sourceMutationSelectors = [
    "#new-circuit-lab", "#save-circuit-lab", "#open-circuit-lab", "#undo-circuit-lab", "#redo-circuit-lab",
    "#apply-circuit-component", "#remove-circuit-component", "#apply-circuit-binding", "#save-circuit-binding",
    "[data-starter-template]", "[data-add-hardware]", "[data-remove-connection]", "[data-import-fritzing]", "[data-edit-custom-component]", "[data-delete-custom-component]",
    "#circuit-lab-file-input", "#fritzing-fzp-input", "#fritzing-svg-input", ".circuit-control-panel button", ".circuit-control-panel input"
  ].join(",");

  function shouldBlockSourceEvent(event) {
    if (internalInteraction) return false;
    const pending = Boolean(pendingState());
    const locked = benchmarkLock;
    const missionBindingLock = state.mission && Boolean(event.target?.closest?.("#apply-circuit-binding, #save-circuit-binding"));
    if (!pending && !locked && !missionBindingLock) return false;
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest("#confirm-circuit-mutation, #cancel-circuit-mutation, [data-webmcp-pending-action], #circuit-tab-agent, [data-circuit-tab], #circuit-view-frame, #circuit-view-overview, #circuit-zoom-in, #circuit-zoom-out, #circuit-zoom-reset")) return false;
    if (target.closest(sourceMutationSelectors)) return true;
    if (["pointerdown", "click"].includes(event.type) && target.closest(".bench-component, [data-terminal-component], .resize-handle")) return true;
    if (["drop", "dragstart"].includes(event.type) && target.closest("#circuit-bench, #hardware-list")) return true;
    if (event.type === "change" && target.matches("#circuit-component-name, #circuit-component-x, #circuit-component-y, #circuit-component-scale, #circuit-component-rotation, [id^='circuit-engineering-']")) return true;
    return false;
  }

  for (const eventName of ["click", "pointerdown", "change", "drop", "dragstart"]) {
    document.addEventListener(eventName, (event) => {
      if (!shouldBlockSourceEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const message = pendingState() ? "Resolve the pending confirmation before editing the circuit." : state.mission && !benchmarkLock ? "Mission binding edits are disabled to keep evidence deterministic." : "Manual source edits are locked during an active benchmark run.";
      const live = document.querySelector("#circuit-live-region");
      if (live) live.textContent = message;
    }, true);
  }
  document.addEventListener("keydown", (event) => {
    if (!pendingState() && !benchmarkLock) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("#circuit-bench")) return;
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const live = document.querySelector("#circuit-live-region");
    if (live) live.textContent = pendingState() ? "Resolve the pending confirmation before wiring." : "Manual wiring is locked during an active benchmark run.";
  }, true);

  const saveButton = document.querySelector("#save-circuit-lab");
  saveButton?.addEventListener("click", (event) => {
    if (!state.mission || protectedSave || internalInteraction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (benchmarkLock) return;
    const approved = globalThis.confirm("Save this demo mission as the current Circuit Lab project? This replaces the saved Circuit Lab project and binding.");
    if (!approved) return;
    protectedSave = true;
    try { saveButton.click(); } finally { protectedSave = false; }
  }, true);

  const confirmCircuitButton = document.querySelector("#confirm-circuit-mutation");
  const cancelCircuitButton = document.querySelector("#cancel-circuit-mutation");
  confirmCircuitButton?.addEventListener("click", (event) => {
    const pending = agentPending;
    if (!pending || pending.kind !== "electrical-hazard") return;
    const before = revision();
    if (before !== pending.revisionBefore) {
      event.preventDefault();
      event.stopImmediatePropagation();
      agentPending = null;
      withInternalInteraction(() => dispatchClick(cancelCircuitButton), "system");
      activityLog.record({ activityId: pending.activityId, actor: "human-confirmation", status: "error", code: "stale_confirmation", revisionBefore: pending.revisionBefore, revisionAfter: before, affectedConnectionIds: pending.connectionIds ?? [] });
      renderAgent();
      return;
    }
    historyMutationActor = "human-confirmation";
    queueMicrotask(() => {
      const after = revision();
      historyMutationActor = null;
      activityLog.record({ activityId: pending.activityId, actor: "human-confirmation", status: "complete", code: after !== before ? "confirmed" : "stale_confirmation", revisionBefore: before, revisionAfter: after, affectedConnectionIds: pending.connectionIds ?? [] });
      agentPending = null;
      lastObservedRevision = after;
      if (benchmarkLock) withInternalInteraction(() => dispatchClick(document.querySelector('[data-circuit-mode="select"]')), "system");
      renderAgent();
    });
  }, true);
  cancelCircuitButton?.addEventListener("click", () => {
    const pending = agentPending;
    if (!pending || pending.kind !== "electrical-hazard") return;
    queueMicrotask(() => {
      activityLog.record({ activityId: pending.activityId, actor: "human-confirmation", status: "complete", code: "user_cancelled", revisionBefore: revision(), revisionAfter: revision(), affectedConnectionIds: pending.connectionIds ?? [] });
      agentPending = null;
      renderAgent();
    });
  });

  pendingActions.addEventListener("click", (event) => {
    const action = event.target.closest("[data-webmcp-pending-action]")?.dataset.webmcpPendingAction;
    if (action === "confirm") confirmAgentRemoval();
    if (action === "cancel") cancelAgentRemoval();
  });

  function lockStaticControls() {
    const selectors = ["#new-circuit-lab", "#save-circuit-lab", "#open-circuit-lab", "#undo-circuit-lab", "#redo-circuit-lab", "#apply-circuit-component", "#remove-circuit-component", "#circuit-lab-file-input", "#fritzing-fzp-input", "#fritzing-svg-input"];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      if (benchmarkLock) {
        if (!("webmcpDisabledBeforeLock" in element.dataset)) element.dataset.webmcpDisabledBeforeLock = element.disabled ? "true" : "false";
        element.disabled = true;
      } else if ("webmcpDisabledBeforeLock" in element.dataset) {
        element.disabled = element.dataset.webmcpDisabledBeforeLock === "true";
        delete element.dataset.webmcpDisabledBeforeLock;
      }
    }
    const bindingLocked = Boolean(state.mission || benchmarkLock);
    for (const selector of ["#apply-circuit-binding", "#save-circuit-binding"]) {
      const element = document.querySelector(selector);
      if (!element) continue;
      if (bindingLocked) {
        if (!("webmcpDisabledBeforeBindingLock" in element.dataset)) element.dataset.webmcpDisabledBeforeBindingLock = element.disabled ? "true" : "false";
        element.disabled = true;
      } else if ("webmcpDisabledBeforeBindingLock" in element.dataset) {
        element.disabled = element.dataset.webmcpDisabledBeforeBindingLock === "true";
        delete element.dataset.webmcpDisabledBeforeBindingLock;
      }
    }
    const bindingEditor = document.querySelector("#circuit-binding-json");
    if (bindingEditor) {
      if (bindingLocked) {
        if (!("webmcpReadOnlyBeforeBindingLock" in bindingEditor.dataset)) bindingEditor.dataset.webmcpReadOnlyBeforeBindingLock = bindingEditor.readOnly ? "true" : "false";
        bindingEditor.readOnly = true;
      } else if ("webmcpReadOnlyBeforeBindingLock" in bindingEditor.dataset) {
        bindingEditor.readOnly = bindingEditor.dataset.webmcpReadOnlyBeforeBindingLock === "true";
        delete bindingEditor.dataset.webmcpReadOnlyBeforeBindingLock;
      }
    }
    const saveMission = ui.panel.querySelector('[data-webmcp-action="save-mission"]');
    if (saveMission) saveMission.hidden = benchmarkLock;
    const resetMissionButton = ui.panel.querySelector('[data-webmcp-action="reset-mission"]');
    if (resetMissionButton) resetMissionButton.disabled = benchmarkLock;
  }

  function webMcpReadyForBenchmark() {
    return Boolean(registration?.supported && !registration?.error && registration?.registered === 7);
  }

  function startBenchmark() {
    if (!webMcpReadyForBenchmark()) {
      runStatus.textContent = "Benchmark requires WebMCP Ready - 7 tools.";
      return;
    }
    const modelLabel = safeLabel(ui.panel.querySelector("#webmcp-model-label")?.value);
    const clientLabel = safeLabel(ui.panel.querySelector("#webmcp-client-label")?.value);
    const configLabel = safeLabel(ui.panel.querySelector("#webmcp-config-label")?.value);
    let metadata;
    try { metadata = createBenchmarkRunMetadata({ modelLabel, clientLabel, configLabel }); }
    catch (error) { runStatus.textContent = error.message; return; }
    resetMission({ record: false });
    activityLog.clear();
    if (revision() !== metadata.initialRevision) {
      runStatus.textContent = "Mission fixture revision mismatch; benchmark did not start.";
      return;
    }
    activeRun = metadata;
    activeRunAgentOnly = true;
    activeRunStartedPerf = globalThis.performance?.now?.() ?? Date.now();
    benchmarkLock = true;
    activityLog.record({ actor: "system", status: "complete", code: "benchmark_started", revisionBefore: revision(), revisionAfter: revision() });
    lastObservedRevision = revision();
    lockStaticControls();
    renderAgent();
  }

  function finishBenchmark() {
    if (!activeRun) return;
    const events = activityLog.all();
    const toolStarts = events.filter((event) => event.actor === "webmcp" && event.status === "start");
    const completeToolEvents = events.filter((event) => event.actor === "webmcp" && event.status === "complete");
    const score = scoreServoRepairRun({ project: getProject(), events, pendingConfirmation: pendingState(), agentOnly: activeRunAgentOnly });
    const run = summarizeBenchmarkRun({
      metadata: activeRun,
      status: "completed",
      agentOnly: activeRunAgentOnly,
      score,
      callCount: toolStarts.length,
      validCallCount: completeToolEvents.filter((event) => !INVALID_CALL_CODES.has(event.code)).length,
      durationMs: (globalThis.performance?.now?.() ?? Date.now()) - activeRunStartedPerf,
      manualReview: ui.panel.querySelector("#webmcp-manual-review")?.value
    });
    saveBenchmarkRuns([...loadBenchmarkRuns(), run]);
    activityLog.record({ actor: "system", status: "complete", code: score.pass ? "benchmark_pass" : "benchmark_fail", revisionBefore: revision(), revisionAfter: revision() });
    activeRun = null;
    benchmarkLock = false;
    lockStaticControls();
    runStatus.textContent = `${score.pass ? "PASS" : "FAIL"} / ${score.totalScore}/100 / ${activeRunAgentOnly ? "agent-only" : "assisted-unranked"}`;
    renderActivity();
    renderComparison();
  }

  function abortBenchmark(status = "aborted") {
    if (!activeRun) return;
    activityLog.record({ actor: "system", status: "complete", code: status === "interrupted" ? "benchmark_interrupted" : "benchmark_aborted", revisionBefore: revision(), revisionAfter: revision() });
    const events = activityLog.all();
    const toolStarts = events.filter((event) => event.actor === "webmcp" && event.status === "start");
    const completeToolEvents = events.filter((event) => event.actor === "webmcp" && event.status === "complete");
    const run = summarizeBenchmarkRun({
      metadata: activeRun,
      status,
      agentOnly: activeRunAgentOnly,
      score: { pass: false, totalScore: 0, processScore: 0, correctnessScore: 0, warningCodes: [] },
      callCount: toolStarts.length,
      validCallCount: completeToolEvents.filter((event) => !INVALID_CALL_CODES.has(event.code)).length,
      durationMs: (globalThis.performance?.now?.() ?? Date.now()) - activeRunStartedPerf,
      manualReview: ui.panel.querySelector("#webmcp-manual-review")?.value
    });
    saveBenchmarkRuns([...loadBenchmarkRuns(), run]);
    activeRun = null;
    benchmarkLock = false;
    lockStaticControls();
    runStatus.textContent = status === "interrupted" ? "Run interrupted and preserved." : "Run aborted and preserved.";
    renderAgent();
  }

  ui.panel.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-webmcp-action]")?.dataset.webmcpAction;
    if (!action) return;
    if (action === "copy-prompt") {
      await copyText(SERVO_REPAIR_PROMPT);
      runStatus.textContent = "Mission prompt copied.";
    } else if (action === "open-benchmark") {
      benchmarkCard.hidden = false;
      renderBenchmarkState();
    } else if (action === "reset-mission") {
      resetMission();
    } else if (action === "exit-demo") {
      globalThis.location.href = "./circuits.html";
    } else if (action === "save-mission") {
      saveButton?.click();
    } else if (action === "start-run") {
      startBenchmark();
    } else if (action === "finish-run") {
      finishBenchmark();
    } else if (action === "abort-run") {
      abortBenchmark();
    } else if (action === "export-runs") {
      downloadText("robostudio-webmcp-benchmark-v2.json", JSON.stringify(loadBenchmarkRuns(), null, 2));
    } else if (action === "export-summary") {
      downloadText("robostudio-webmcp-benchmark-summary.md", benchmarkMarkdown(loadBenchmarkRuns()), "text/markdown;charset=utf-8");
    } else if (action === "import-runs") {
      importInput.click();
    }
  });

  importInput.addEventListener("change", async () => {
    const [file] = importInput.files ?? [];
    importInput.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : [];
      saveBenchmarkRuns([...loadBenchmarkRuns(), ...incoming]);
      runStatus.textContent = "Validated benchmark records imported.";
      renderComparison();
    } catch {
      runStatus.textContent = "Benchmark import rejected.";
    }
  });

  const unsubscribeHistory = subscribeHistoryChanges(history, ({ kind, previous, current }) => {
    const before = circuitDesignRevision(normalizeProject(previous));
    const after = circuitDesignRevision(normalizeProject(current));
    if (before === after) return;
    const actor = historyMutationActor ?? "human";
    activityLog.record({
      actor,
      status: "complete",
      code: `source_${kind}`,
      revisionBefore: before,
      revisionAfter: after
    });
    if (activeRun && !["webmcp", "human-confirmation"].includes(actor)) activeRunAgentOnly = false;
    lastObservedRevision = after;
    queueMicrotask(renderAgent);
  });

  const monitor = setInterval(() => {
    const currentRevision = revision();
    if (activeRun && currentRevision !== lastObservedRevision) {
      activeRunAgentOnly = false;
      activityLog.record({ actor: "human", status: "complete", code: "unexpected_source_change", revisionBefore: lastObservedRevision, revisionAfter: currentRevision });
      lastObservedRevision = currentRevision;
      renderAgent();
    }
  }, 250);

  const cleanupAssistantObserver = hideUnavailableAssistantInDemo(state);
  globalThis.addEventListener("pagehide", () => {
    if (activeRun) abortBenchmark("interrupted");
    clearInterval(monitor);
    unsubscribeHistory();
    cleanupAssistantObserver();
    modelContext?.removeEventListener?.("toolchange", handleToolChange);
    registration?.dispose?.();
  }, { once: true });

  if (state.mission) {
    const expected = servoRepairMissionMetadata().initialRevision;
    if (revision() !== expected) resetMission({ record: false });
    requestAnimationFrame(forcePageRender);
  }
  renderAgent();
  lockStaticControls();
  return { tools, registration, activityLog, resetMission, getProject, revision };
}
