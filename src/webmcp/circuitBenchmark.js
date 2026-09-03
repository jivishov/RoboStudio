import { findConnectedTerminals } from "../circuits/connectivity.js";
import { circuitDesignRevision } from "../circuits/designRevision.js";
import {
  SERVO_REPAIR_MISSION_ID,
  SERVO_REPAIR_REQUIRED_COMPONENTS,
  SERVO_REPAIR_RUBRIC_VERSION,
  SERVO_REPAIR_SCENARIO_VERSION,
  SERVO_REPAIR_TOOLSET_VERSION,
  createServoRepairMission
} from "../circuits/demoMissions.js";
import { normalizeProject } from "../circuits/model.js";
import { runCircuitLabTest } from "../circuits/testBench.js";

export const BENCHMARK_STORAGE_KEY = "robostudio:webmcp-benchmark:v2";
export const BENCHMARK_SCHEMA_VERSION = 2;
export const BENCHMARK_MAX_RUNS = 30;
export const WEBMCP_BUILD_VERSION = "webmcp-v2-2026-09-02";

function connectedEndpoint(project, start, componentId, terminalId) {
  return findConnectedTerminals(project, start).some((record) => (
    record.endpoint.componentId === componentId && record.endpoint.terminalId === terminalId
  ));
}

function controllerPowerSource(record) {
  return record.componentDefinition?.sim?.role === "controller"
    && record.terminal?.kind === "power"
    && record.terminal?.electricalRole === "power-source";
}

export function evaluateServoRepairFinalState(input = {}) {
  const project = normalizeProject(input.project);
  const test = runCircuitLabTest(project);
  const exactComponents = Object.entries(SERVO_REPAIR_REQUIRED_COMPONENTS).every(([id, typeId]) => (
    project.components.some((component) => component.id === id && component.typeId === typeId)
  )) && project.components.length === Object.keys(SERVO_REPAIR_REQUIRED_COMPONENTS).length;
  const d9Signal = connectedEndpoint(project, { componentId: "servo", terminalId: "signal" }, "arduino", "D9");
  const externalPower = connectedEndpoint(project, { componentId: "servo", terminalId: "vplus" }, "supply", "VPLUS");
  const servoPowerGroup = findConnectedTerminals(project, { componentId: "servo", terminalId: "vplus" });
  const controllerPowerAbsent = !servoPowerGroup.some(controllerPowerSource);
  const servoGroundGroup = findConnectedTerminals(project, { componentId: "servo", terminalId: "gnd" });
  const supplyGround = servoGroundGroup.some((record) => record.endpoint.componentId === "supply" && record.endpoint.terminalId === "GND");
  const arduinoGround = servoGroundGroup.some((record) => (
    record.endpoint.componentId === "arduino" && record.terminal?.kind === "ground"
  ));
  const criteria = {
    zeroErrors: test.summary.errors === 0,
    requiredComponents: exactComponents,
    controllerPreserved: project.controllerId === "arduino",
    d9Signal,
    externalPower,
    controllerPowerAbsent,
    commonGround: supplyGround && arduinoGround,
    noPendingConfirmation: !input.pendingConfirmation,
    agentOnly: input.agentOnly !== false
  };
  return {
    pass: Object.values(criteria).every(Boolean),
    criteria,
    revision: circuitDesignRevision(project),
    drc: test.summary,
    warningCodes: test.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code)
  };
}

export function scoreServoRepairProcess(events = []) {
  const ordered = [...events].sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
  const completed = ordered.filter((event) => event.status === "complete");
  const writeNames = new Set(["connect_terminals", "remove_connection"]);
  const writeAttempts = ordered.filter((event) => writeNames.has(event.toolName) && ["start", "complete", "error"].includes(event.status));
  const firstWriteSequence = writeAttempts.length ? Math.min(...writeAttempts.map((event) => Number(event.sequence ?? Infinity))) : Infinity;
  const diagnoseBeforeWrite = completed.some((event) => event.toolName === "diagnose_circuit" && Number(event.sequence ?? Infinity) < firstWriteSequence);

  const connectSucceeded = (event) => {
    if (event.code === "committed") return true;
    if (event.code !== "pending_confirmation" || !event.activityId) return false;
    return completed.some((decision) => decision.activityId === event.activityId
      && decision.actor === "human-confirmation"
      && decision.code === "confirmed"
      && decision.revisionBefore !== decision.revisionAfter);
  };
  const successfulConnects = completed.filter((event) => event.toolName === "connect_terminals" && connectSucceeded(event));
  const previewedConnects = successfulConnects.length > 0 && successfulConnects.every((connectEvent) => completed.some((previewEvent) => (
    previewEvent.toolName === "preview_connection"
    && previewEvent.code?.startsWith("preview_")
    && previewEvent.endpointPairKey
    && previewEvent.endpointPairKey === connectEvent.endpointPairKey
    && previewEvent.revisionBefore === connectEvent.revisionBefore
    && Number(previewEvent.sequence ?? 0) < Number(connectEvent.sequence ?? 0)
  )));
  const lastMutationSequence = Math.max(-1, ...ordered.filter((event) => event.revisionBefore && event.revisionAfter && event.revisionBefore !== event.revisionAfter).map((event) => Number(event.sequence ?? -1)));
  const finalDiagnosisSequence = Math.max(-1, ...completed.filter((event) => event.toolName === "diagnose_circuit").map((event) => Number(event.sequence ?? -1)));
  const diagnosedAfterFinalMutation = finalDiagnosisSequence > lastMutationSequence;
  const evidenceAfterFinalDiagnosis = finalDiagnosisSequence >= 0 && completed.some((event) => event.toolName === "get_build_evidence" && Number(event.sequence ?? -1) > finalDiagnosisSequence);
  const invalidCodes = new Set(["invalid_arguments", "unknown_id", "mechanically_blocked", "stale_revision"]);
  const noInvalidCalls = !completed.some((event) => invalidCodes.has(event.code));
  return {
    score: (diagnoseBeforeWrite ? 8 : 0)
      + (previewedConnects ? 8 : 0)
      + (diagnosedAfterFinalMutation ? 6 : 0)
      + (evidenceAfterFinalDiagnosis ? 4 : 0)
      + (noInvalidCalls ? 4 : 0),
    checks: { diagnoseBeforeWrite, previewedConnects, diagnosedAfterFinalMutation, evidenceAfterFinalDiagnosis, noInvalidCalls }
  };
}

export function scoreServoRepairRun(input = {}) {
  const finalState = evaluateServoRepairFinalState(input);
  const process = scoreServoRepairProcess(input.events ?? []);
  const correctness = (finalState.criteria.zeroErrors ? 30 : 0)
    + (finalState.criteria.externalPower && finalState.criteria.controllerPowerAbsent ? 15 : 0)
    + (finalState.criteria.commonGround ? 15 : 0)
    + (finalState.criteria.d9Signal ? 10 : 0);
  return {
    pass: finalState.pass,
    totalScore: correctness + process.score,
    correctnessScore: correctness,
    processScore: process.score,
    criteria: finalState.criteria,
    processChecks: process.checks,
    drc: finalState.drc,
    warningCodes: finalState.warningCodes,
    revision: finalState.revision
  };
}

function boundedLabel(value, max = 64) {
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

function groupingKeyFor(modelLabel, clientLabel, configLabel) {
  const normalizeKey = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return [modelLabel, clientLabel, configLabel].map(normalizeKey).join("::");
}

export function createBenchmarkRunMetadata(input = {}) {
  const mission = createServoRepairMission();
  const modelLabel = boundedLabel(input.modelLabel);
  const clientLabel = boundedLabel(input.clientLabel);
  const configLabel = boundedLabel(input.configLabel);
  if (!modelLabel || !clientLabel || !configLabel) throw new Error("Model, client, and configuration labels are required.");
  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    scenarioId: SERVO_REPAIR_MISSION_ID,
    scenarioVersion: SERVO_REPAIR_SCENARIO_VERSION,
    toolsetVersion: SERVO_REPAIR_TOOLSET_VERSION,
    rubricVersion: SERVO_REPAIR_RUBRIC_VERSION,
    buildVersion: WEBMCP_BUILD_VERSION,
    initialRevision: circuitDesignRevision(mission),
    modelLabel,
    clientLabel,
    configLabel,
    groupingKey: groupingKeyFor(modelLabel, clientLabel, configLabel),
    startedAt: input.startedAt ?? new Date().toISOString()
  };
}

function finiteNonNegative(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(0, numeric));
}

export function summarizeBenchmarkRun(input = {}) {
  const metadata = input.metadata ?? createBenchmarkRunMetadata(input);
  const score = input.score ?? null;
  return {
    ...metadata,
    id: String(input.id ?? `run_${Date.now()}`).slice(0, 100),
    status: ["completed", "aborted", "interrupted"].includes(input.status) ? input.status : "completed",
    agentOnly: input.agentOnly !== false,
    pass: Boolean(score?.pass),
    totalScore: finiteNonNegative(score?.totalScore, 0, 100),
    processScore: finiteNonNegative(score?.processScore, 0, 30),
    correctnessScore: finiteNonNegative(score?.correctnessScore, 0, 70),
    callCount: Math.floor(finiteNonNegative(input.callCount)),
    validCallCount: Math.floor(finiteNonNegative(input.validCallCount)),
    durationMs: finiteNonNegative(input.durationMs),
    warningCodes: (score?.warningCodes ?? []).map(String).slice(0, 12),
    manualReview: ["pass", "fail", "not-reviewed"].includes(input.manualReview) ? input.manualReview : "not-reviewed",
    completedAt: input.completedAt ?? new Date().toISOString()
  };
}

export function validateStoredBenchmarkRun(run) {
  if (!run || run.schemaVersion !== BENCHMARK_SCHEMA_VERSION) return null;
  if (run.scenarioId !== SERVO_REPAIR_MISSION_ID || run.scenarioVersion !== SERVO_REPAIR_SCENARIO_VERSION) return null;
  if (run.toolsetVersion !== SERVO_REPAIR_TOOLSET_VERSION || run.rubricVersion !== SERVO_REPAIR_RUBRIC_VERSION) return null;
  const modelLabel = boundedLabel(run.modelLabel);
  const clientLabel = boundedLabel(run.clientLabel);
  const configLabel = boundedLabel(run.configLabel);
  const buildVersion = boundedLabel(run.buildVersion);
  if (!modelLabel || !clientLabel || !configLabel || !buildVersion) return null;
  const metadata = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    scenarioId: SERVO_REPAIR_MISSION_ID,
    scenarioVersion: SERVO_REPAIR_SCENARIO_VERSION,
    toolsetVersion: SERVO_REPAIR_TOOLSET_VERSION,
    rubricVersion: SERVO_REPAIR_RUBRIC_VERSION,
    buildVersion,
    initialRevision: /^clp1-[0-9a-f]{16}$/.test(String(run.initialRevision ?? "")) ? run.initialRevision : circuitDesignRevision(createServoRepairMission()),
    modelLabel,
    clientLabel,
    configLabel,
    groupingKey: groupingKeyFor(modelLabel, clientLabel, configLabel),
    startedAt: boundedLabel(run.startedAt, 40) || new Date().toISOString()
  };
  try {
    return summarizeBenchmarkRun({
      metadata,
      id: boundedLabel(run.id, 100),
      status: run.status,
      agentOnly: run.agentOnly,
      score: {
        pass: Boolean(run.pass),
        totalScore: Number(run.totalScore ?? 0),
        processScore: Number(run.processScore ?? 0),
        correctnessScore: Number(run.correctnessScore ?? 0),
        warningCodes: Array.isArray(run.warningCodes) ? run.warningCodes.map((code) => boundedLabel(code, 80)).filter(Boolean).slice(0, 12) : []
      },
      callCount: Number(run.callCount ?? 0),
      validCallCount: Number(run.validCallCount ?? 0),
      durationMs: Number(run.durationMs ?? 0),
      manualReview: run.manualReview,
      completedAt: boundedLabel(run.completedAt, 40) || new Date().toISOString()
    });
  } catch {
    return null;
  }
}

export function loadBenchmarkRuns(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(BENCHMARK_STORAGE_KEY) ?? "[]");
    return (Array.isArray(parsed) ? parsed : []).map(validateStoredBenchmarkRun).filter(Boolean).slice(-BENCHMARK_MAX_RUNS);
  } catch {
    return [];
  }
}

export function saveBenchmarkRuns(runs, storage = globalThis.localStorage) {
  const valid = (runs ?? []).map(validateStoredBenchmarkRun).filter(Boolean).slice(-BENCHMARK_MAX_RUNS);
  storage?.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(valid));
  return valid;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function compareBenchmarkConfigurations(runs = []) {
  const completed = runs.filter((run) => run.status === "completed" && run.agentOnly);
  const groups = new Map();
  for (const run of completed) {
    const cohortKey = [run.scenarioId, run.scenarioVersion, run.toolsetVersion, run.rubricVersion, run.buildVersion].join("|");
    const key = `${cohortKey}|${run.groupingKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const summaries = [...groups.values()].map((items) => {
    const passing = items.filter((run) => run.pass);
    const calls = items.reduce((total, run) => total + run.callCount, 0);
    const valid = items.reduce((total, run) => total + run.validCallCount, 0);
    const cohortKey = [items[0].scenarioId, items[0].scenarioVersion, items[0].toolsetVersion, items[0].rubricVersion, items[0].buildVersion].join("|");
    return {
      cohortKey,
      comparisonKey: `${cohortKey}|${items[0].groupingKey}`,
      groupingKey: items[0].groupingKey,
      modelLabel: items[0].modelLabel,
      clientLabel: items[0].clientLabel,
      configLabel: items[0].configLabel,
      runCount: items.length,
      evidenceLabel: items.length >= 3 ? "Comparable" : items.length === 2 ? "Limited evidence" : "Provisional",
      passRate: items.length ? passing.length / items.length : 0,
      medianPassingScore: median(passing.map((run) => run.totalScore)),
      validCallRate: calls ? valid / calls : 0,
      medianCallCount: median(items.map((run) => run.callCount)),
      medianDurationMs: median(items.map((run) => run.durationMs)),
      bestObserved: false
    };
  });
  const rank = (left, right) => (
    right.passRate - left.passRate
    || right.medianPassingScore - left.medianPassingScore
    || right.validCallRate - left.validCallRate
    || left.medianCallCount - right.medianCallCount
  );
  const currentCohortKey = [SERVO_REPAIR_MISSION_ID, SERVO_REPAIR_SCENARIO_VERSION, SERVO_REPAIR_TOOLSET_VERSION, SERVO_REPAIR_RUBRIC_VERSION, WEBMCP_BUILD_VERSION].join("|");
  const currentComparable = summaries.filter((summary) => summary.cohortKey === currentCohortKey && summary.runCount >= 3).sort(rank);
  if (currentComparable.length >= 2) currentComparable[0].bestObserved = true;
  summaries.sort((left, right) => (left.cohortKey === currentCohortKey ? -1 : 0) - (right.cohortKey === currentCohortKey ? -1 : 0) || rank(left, right));
  const best = summaries.find((summary) => summary.bestObserved) ?? null;
  return {
    configurations: summaries,
    bestObservedComparisonKey: best?.comparisonKey ?? null,
    bestObservedGroupingKey: best?.groupingKey ?? null,
    disclaimer: "Results apply only to this RoboStudio scenario, toolset, rubric, client, manually entered model label, and configuration. They are not a general ranking of intelligence or engineering competence."
  };
}
