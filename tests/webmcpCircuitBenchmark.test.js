import assert from "node:assert/strict";
import test from "node:test";

import { circuitDesignRevision, fnv1a64Hex } from "../src/circuits/designRevision.js";
import { SERVO_REPAIR_REQUIRED_COMPONENTS, createServoRepairMission, servoRepairMissionMetadata } from "../src/circuits/demoMissions.js";
import { connectTerminals, removeConnection, setProjectMode, updateComponent } from "../src/circuits/model.js";
import { runCircuitLabTest } from "../src/circuits/testBench.js";
import { createHistory, commitHistory, subscribeHistoryChanges } from "../src/history.js";
import {
  compareBenchmarkConfigurations,
  createBenchmarkRunMetadata,
  evaluateServoRepairFinalState,
  scoreServoRepairProcess,
  scoreServoRepairRun,
  summarizeBenchmarkRun,
  validateStoredBenchmarkRun
} from "../src/webmcp/circuitBenchmark.js";

function repairedMission() {
  let project = createServoRepairMission();
  project = removeConnection(project, "unsafe_servo_power");
  project = connectTerminals(project, { componentId: "breadboard", terminalId: "bp5" }, { componentId: "servo", terminalId: "vplus" }, { id: "repair_servo_power" });
  project = connectTerminals(project, { componentId: "arduino", terminalId: "GND" }, { componentId: "breadboard", terminalId: "bn2" }, { id: "repair_common_ground" });
  return project;
}

test("canonical Circuit Lab revision is fixed-width and ignores UI-only state", () => {
  const project = createServoRepairMission();
  const revision = circuitDesignRevision(project);
  const uiOnly = { ...project, name: "Renamed mission", mode: "wire", updatedAt: "2030-01-01T00:00:00.000Z", selectedComponentId: "breadboard", selectedConnectionId: "unsafe_servo_power", app: { ...project.app, notes: "UI note" }, connections: project.connections.map((connection) => ({ ...connection, name: `Display ${connection.id}`, color: "#abcdef" })) };
  assert.match(revision, /^clp1-[0-9a-f]{16}$/);
  assert.equal(circuitDesignRevision(uiOnly), revision);
  assert.equal(fnv1a64Hex("hello"), "a430d84680aabd0b");
  assert.notEqual(circuitDesignRevision(updateComponent(project, "servo", { position: [160, 210] })), revision);
  assert.equal(circuitDesignRevision(setProjectMode(project, "test")), revision);
});

test("servo-repair-v1 fixture has the required unsafe state and exact built-in components", () => {
  const project = createServoRepairMission();
  const codes = new Set(runCircuitLabTest(project).issues.map((issue) => issue.code));
  assert.equal(codes.has("servo-controller-power"), true);
  assert.equal(codes.has("missing-common-ground"), true);
  assert.deepEqual(Object.fromEntries(project.components.map((component) => [component.id, component.typeId])), SERVO_REPAIR_REQUIRED_COMPONENTS);
  assert.equal(project.connections.some((connection) => connection.id === "servo_signal" && connection.endpoints.some((endpoint) => endpoint.componentId === "arduino" && endpoint.terminalId === "D9")), true);
  assert.equal(servoRepairMissionMetadata().initialRevision, circuitDesignRevision(project));
});

test("benchmark evaluator accepts graph-equivalent valid repair and rejects component deletion", () => {
  const repaired = repairedMission();
  const evaluated = evaluateServoRepairFinalState({ project: repaired, agentOnly: true, pendingConfirmation: null });
  assert.equal(evaluated.pass, true);
  assert.equal(evaluated.criteria.zeroErrors, true);
  assert.equal(evaluated.criteria.externalPower, true);
  assert.equal(evaluated.criteria.commonGround, true);
  assert.equal(evaluated.criteria.d9Signal, true);
  const missingServo = { ...repaired, components: repaired.components.filter((component) => component.id !== "servo") };
  assert.equal(evaluateServoRepairFinalState({ project: missingServo, agentOnly: true }).pass, false);
});

test("process score requires matching preview pair and revision before successful connect", () => {
  const revisionA = "clp1-0000000000000001";
  const revisionB = "clp1-0000000000000002";
  const events = [
    { sequence: 1, status: "complete", toolName: "diagnose_circuit", code: "issues_found", revisionBefore: revisionA, revisionAfter: revisionA },
    { sequence: 2, status: "complete", toolName: "remove_connection", code: "pending_confirmation", revisionBefore: revisionA, revisionAfter: revisionA },
    { sequence: 3, status: "complete", actor: "human-confirmation", code: "confirmed", revisionBefore: revisionA, revisionAfter: revisionB },
    { sequence: 4, status: "complete", toolName: "preview_connection", code: "preview_safe", revisionBefore: revisionB, revisionAfter: revisionB, endpointPairKey: "breadboard:bp5|servo:vplus" },
    { sequence: 5, status: "complete", toolName: "connect_terminals", code: "committed", revisionBefore: revisionB, revisionAfter: "clp1-0000000000000003", endpointPairKey: "breadboard:bp5|servo:vplus" },
    { sequence: 6, status: "complete", toolName: "diagnose_circuit", code: "review_required", revisionBefore: "clp1-0000000000000003", revisionAfter: "clp1-0000000000000003" },
    { sequence: 7, status: "complete", toolName: "get_build_evidence", code: "review_required", revisionBefore: "clp1-0000000000000003", revisionAfter: "clp1-0000000000000003" }
  ];
  const score = scoreServoRepairProcess(events);
  assert.equal(score.checks.diagnoseBeforeWrite, true);
  assert.equal(score.checks.previewedConnects, true);
  assert.equal(score.checks.diagnosedAfterFinalMutation, true);
  assert.equal(score.checks.evidenceAfterFinalDiagnosis, true);
  events[3] = { ...events[3], revisionBefore: revisionA };
  assert.equal(scoreServoRepairProcess(events).checks.previewedConnects, false);
});

test("benchmark labels remain conservative until two configurations are comparable", () => {
  const make = (modelLabel, pass, index) => summarizeBenchmarkRun({ metadata: createBenchmarkRunMetadata({ modelLabel, clientLabel: "Chrome", configLabel: "high" }), id: `${modelLabel}_${index}`, status: "completed", agentOnly: true, score: { pass, totalScore: pass ? 95 : 40, processScore: 25, correctnessScore: pass ? 70 : 15, warningCodes: [] }, callCount: 8, validCallCount: 8, durationMs: 1000 + index });
  const oneConfig = [0, 1, 2].map((index) => make("Model A", true, index));
  assert.equal(compareBenchmarkConfigurations(oneConfig).bestObservedGroupingKey, null);
  const twoConfigs = [...oneConfig, ...[0, 1, 2].map((index) => make("Model B", index !== 2, index))];
  const comparison = compareBenchmarkConfigurations(twoConfigs);
  assert.ok(comparison.bestObservedGroupingKey);
  assert.equal(comparison.configurations.every((row) => row.evidenceLabel === "Comparable"), true);
});

test("full scoring preserves pass/fail precedence independent of numeric score", () => {
  const score = scoreServoRepairRun({ project: repairedMission(), events: [], agentOnly: true });
  assert.equal(score.pass, true);
  assert.equal(score.correctnessScore, 70);
  assert.equal(score.totalScore >= 70, true);
});

test("stored benchmark validation strips unexpected imported fields and raw payloads", () => {
  const original = summarizeBenchmarkRun({ metadata: createBenchmarkRunMetadata({ modelLabel: "Model A", clientLabel: "Chrome", configLabel: "high" }), status: "completed", agentOnly: true, score: { pass: true, totalScore: 95, processScore: 25, correctnessScore: 70, warningCodes: [] }, callCount: 8, validCallCount: 8, durationMs: 900 });
  const sanitized = validateStoredBenchmarkRun({ ...original, rawToolOutput: { secret: "do not keep" }, project: { components: ["raw"] } });
  assert.ok(sanitized);
  assert.equal("rawToolOutput" in sanitized, false);
  assert.equal("project" in sanitized, false);
});

test("history change subscription is session-only and reports canonical source transitions", () => {
  const history = createHistory(createServoRepairMission());
  const changes = [];
  const unsubscribe = subscribeHistoryChanges(history, (event) => changes.push(event));
  commitHistory(history, repairedMission());
  unsubscribe();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "commit");
  assert.notEqual(circuitDesignRevision(changes[0].previous), circuitDesignRevision(changes[0].current));
});

test("pending connect earns preview credit only after linked human confirmation commits", () => {
  const revisionA = "clp1-0000000000000010";
  const revisionB = "clp1-0000000000000011";
  const pair = "breadboard:bp5|servo:vplus";
  const base = [
    { sequence: 1, activityId: "d", actor: "webmcp", status: "complete", toolName: "diagnose_circuit", code: "issues_found", revisionBefore: revisionA, revisionAfter: revisionA },
    { sequence: 2, activityId: "p", actor: "webmcp", status: "complete", toolName: "preview_connection", code: "preview_safe", revisionBefore: revisionA, revisionAfter: revisionA, endpointPairKey: pair },
    { sequence: 3, activityId: "c", actor: "webmcp", status: "complete", toolName: "connect_terminals", code: "pending_confirmation", revisionBefore: revisionA, revisionAfter: revisionA, endpointPairKey: pair }
  ];
  assert.equal(scoreServoRepairProcess(base).checks.previewedConnects, false);
  const confirmed = [...base, { sequence: 4, activityId: "c", actor: "human-confirmation", status: "complete", code: "confirmed", revisionBefore: revisionA, revisionAfter: revisionB }];
  assert.equal(scoreServoRepairProcess(confirmed).checks.previewedConnects, true);
});

test("comparison never marks best observed across different build cohorts", () => {
  const make = (modelLabel, buildVersion, index) => summarizeBenchmarkRun({ metadata: { ...createBenchmarkRunMetadata({ modelLabel, clientLabel: "Chrome", configLabel: "high" }), buildVersion }, id: `${modelLabel}_${buildVersion}_${index}`, status: "completed", agentOnly: true, score: { pass: true, totalScore: 95, processScore: 25, correctnessScore: 70, warningCodes: [] }, callCount: 8, validCallCount: 8, durationMs: 1000 });
  const mixed = [...[0, 1, 2].map((index) => make("Model A", "old-build", index)), ...[0, 1, 2].map((index) => make("Model B", "webmcp-v2-2026-09-02", index))];
  assert.equal(compareBenchmarkConfigurations(mixed).bestObservedGroupingKey, null);
});

test("stored benchmark numeric fields are finite and bounded", () => {
  const run = summarizeBenchmarkRun({ metadata: createBenchmarkRunMetadata({ modelLabel: "Model A", clientLabel: "Chrome", configLabel: "high" }), score: { pass: true, totalScore: Number.NaN, processScore: 999, correctnessScore: -5, warningCodes: [] }, callCount: Number.POSITIVE_INFINITY, validCallCount: -2, durationMs: Number.NaN });
  assert.equal(run.totalScore, 0);
  assert.equal(run.processScore, 30);
  assert.equal(run.correctnessScore, 0);
  assert.equal(run.callCount, 0);
  assert.equal(run.validCallCount, 0);
  assert.equal(run.durationMs, 0);
  assert.equal(JSON.stringify(run).includes("null"), false);
});
