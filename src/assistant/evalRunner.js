import "./assistant.css";
import {
  ASSISTANT_EVAL_MODEL,
  ASSISTANT_EVAL_REASONING_EFFORT,
  ASSISTANT_EVAL_SCENARIOS,
  ASSISTANT_EVAL_STORAGE_KEY,
  evaluateScenarioResult,
  getAssistantEvalScenarios,
  isAssistantEvalEnabled
} from "./evalScenarios.js";
import { runAssistantTurn, summarizeAction } from "./turnRunner.js";

function createElement(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readStoredEval() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ASSISTANT_EVAL_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? { results: parsed.results ?? {} } : { results: {} };
  } catch {
    return { results: {} };
  }
}

function writeStoredEval(data) {
  try {
    sessionStorage.setItem(ASSISTANT_EVAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage is best-effort; the visible panel remains the source of truth.
  }
}

function storeScenarioSummary(summary) {
  const data = readStoredEval();
  data.results[summary.scenarioId] = {
    scenarioId: summary.scenarioId,
    title: summary.title,
    pageId: summary.pageId,
    pass: summary.pass,
    actualCalls: summary.actualCalls,
    guardedCalls: summary.guardedCalls,
    failedAssertions: summary.failedAssertions,
    latencyMs: summary.latencyMs,
    usage: summary.usage,
    finalText: summary.finalText
  };
  writeStoredEval(data);
}

function storedSummariesInOrder() {
  const data = readStoredEval();
  return ASSISTANT_EVAL_SCENARIOS
    .map((scenario) => data.results[scenario.id])
    .filter(Boolean);
}

function formatUsage(usage) {
  if (!usage) return "n/a";
  if (Number.isFinite(usage.total_tokens)) return `${usage.total_tokens} tokens`;
  return `${usage.input_tokens ?? 0} in / ${usage.output_tokens ?? 0} out`;
}

function formatLatency(latencyMs) {
  return Number.isFinite(latencyMs) ? `${latencyMs} ms` : "n/a";
}

function scenarioSummaryHtml(summary) {
  const status = summary.pass ? "Pass" : "Fail";
  const failures = summary.failedAssertions?.length
    ? `<ul>${summary.failedAssertions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>No failed assertions.</p>";
  return `
    <div class="assistant-eval-row__status" data-state="${summary.pass ? "pass" : "fail"}">${status}</div>
    <div class="assistant-eval-row__metrics">
      <span>${escapeHtml(formatLatency(summary.latencyMs))}</span>
      <span>${escapeHtml(formatUsage(summary.usage))}</span>
    </div>
    <dl class="assistant-eval-row__details">
      <div><dt>Actual calls</dt><dd>${escapeHtml(summary.actualCalls?.join(", ") || "none")}</dd></div>
      <div><dt>Guarded staged</dt><dd>${escapeHtml(summary.guardedCalls?.join(", ") || "none")}</dd></div>
      <div><dt>Assistant final text</dt><dd>${escapeHtml(summary.finalText || "n/a")}</dd></div>
    </dl>
    <div class="assistant-eval-row__failures">${failures}</div>
  `;
}

function renderScenarioRow(row, scenario, summary = null, stateText = "Not run") {
  row.dataset.status = summary ? (summary.pass ? "pass" : "fail") : stateText.toLowerCase().replaceAll(" ", "-");
  row.innerHTML = `
    <header class="assistant-eval-row__header">
      <div>
        <strong>${escapeHtml(scenario.title)}</strong>
        <p>${escapeHtml(scenario.prompt)}</p>
      </div>
      <span>${escapeHtml(summary ? (summary.pass ? "Pass" : "Fail") : stateText)}</span>
    </header>
    <dl class="assistant-eval-row__expectations">
      <div><dt>Required calls</dt><dd>${escapeHtml(scenario.requiredCalls.join(", ") || "none")}</dd></div>
      <div><dt>Required guarded</dt><dd>${escapeHtml(scenario.requiredGuardedCalls.join(", ") || "none")}</dd></div>
    </dl>
    ${summary ? scenarioSummaryHtml(summary) : ""}
  `;
}

function renderAggregate(container) {
  const summaries = storedSummariesInOrder();
  const passCount = summaries.filter((summary) => summary.pass).length;
  container.innerHTML = `
    <strong>Aggregate</strong>
    <span>${passCount}/${ASSISTANT_EVAL_SCENARIOS.length} passed</span>
    <span>${summaries.length}/${ASSISTANT_EVAL_SCENARIOS.length} recorded</span>
  `;
}

async function waitForAdapterReady(adapter, statusEl, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const context = adapter.getContext();
    if (context?.ready) return context;
    statusEl.textContent = "Waiting for page to finish loading...";
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Page did not become ready for assistant eval.");
}

async function runSetupActions(adapter, setupActions = []) {
  for (const action of setupActions) {
    await adapter.executeAction(action.name, action.args ?? {});
  }
}

function guardedOutput(toolCall, definition, args) {
  return {
    ok: false,
    action: toolCall.name,
    status: "pending_confirmation",
    message: definition.confirmation ?? summarizeAction(definition, args)
  };
}

async function runScenario(adapter, scenario, row, statusEl) {
  renderScenarioRow(row, scenario, null, "Running");
  statusEl.textContent = `Running ${scenario.title}...`;
  await waitForAdapterReady(adapter, statusEl);
  await runSetupActions(adapter, scenario.setupActions);
  const runResult = await runAssistantTurn({
    adapter,
    model: ASSISTANT_EVAL_MODEL,
    reasoningEffort: ASSISTANT_EVAL_REASONING_EFFORT,
    message: scenario.prompt,
    previousResponseId: null,
    onGuardedToolCall: ({ toolCall, definition, args }) => ({
      output: guardedOutput(toolCall, definition, args)
    })
  });
  const summary = evaluateScenarioResult(scenario, runResult, adapter.getContext());
  renderScenarioRow(row, scenario, summary);
  storeScenarioSummary(summary);
  return summary;
}

export function mountAssistantEvalPanel({ adapter, continueUrl = "/physics.html?assistantEval=1" }) {
  if (!isAssistantEvalEnabled()) return null;
  const scenarios = getAssistantEvalScenarios(adapter.pageId);
  const root = createElement("section", "assistant-eval-panel");
  root.setAttribute("data-testid", "assistant-eval-panel");
  root.innerHTML = `
    <header class="assistant-eval-panel__header">
      <div>
        <span>Live assistant eval</span>
        <strong>${escapeHtml(adapter.title ?? adapter.pageId)}</strong>
      </div>
      <button type="button" data-testid="assistant-eval-run-page">Run Page Eval</button>
    </header>
    <p class="assistant-eval-panel__meta">Model ${escapeHtml(ASSISTANT_EVAL_MODEL)} / reasoning ${escapeHtml(ASSISTANT_EVAL_REASONING_EFFORT)}</p>
    <div class="assistant-eval-panel__aggregate"></div>
    <div class="assistant-eval-panel__rows"></div>
    <footer class="assistant-eval-panel__footer">
      <p role="status">Ready.</p>
      <button type="button" data-testid="assistant-eval-continue-workbench">Continue to Workbench</button>
    </footer>
  `;

  const runButton = root.querySelector("[data-testid='assistant-eval-run-page']");
  const continueButton = root.querySelector("[data-testid='assistant-eval-continue-workbench']");
  const rowsContainer = root.querySelector(".assistant-eval-panel__rows");
  const aggregateEl = root.querySelector(".assistant-eval-panel__aggregate");
  const statusEl = root.querySelector("[role='status']");

  if (adapter.pageId !== "studio") {
    continueButton.hidden = true;
  }

  const rowsById = new Map();
  for (const scenario of scenarios) {
    const row = createElement("article", "assistant-eval-row");
    row.setAttribute("data-testid", `assistant-eval-row-${scenario.id}`);
    renderScenarioRow(row, scenario);
    rowsById.set(scenario.id, row);
    rowsContainer.append(row);
  }
  renderAggregate(aggregateEl);

  runButton.addEventListener("click", async () => {
    runButton.disabled = true;
    continueButton.disabled = true;
    try {
      const summaries = [];
      for (const scenario of scenarios) {
        const summary = await runScenario(adapter, scenario, rowsById.get(scenario.id), statusEl);
        summaries.push(summary);
        renderAggregate(aggregateEl);
      }
      const passed = summaries.filter((summary) => summary.pass).length;
      statusEl.textContent = `${passed}/${summaries.length} page scenarios passed.`;
      window.dispatchEvent(new CustomEvent("assistant-eval-complete", {
        detail: { pageId: adapter.pageId, summaries }
      }));
    } catch (error) {
      statusEl.textContent = error.message ?? "Assistant eval failed.";
    } finally {
      runButton.disabled = false;
      continueButton.disabled = false;
    }
  });

  continueButton.addEventListener("click", () => {
    window.location.href = continueUrl;
  });

  document.body.append(root);
  return { root, adapter };
}
