import assert from "node:assert/strict";
import test from "node:test";

import { createServoRepairMission } from "../src/circuits/demoMissions.js";
import { circuitDesignRevision } from "../src/circuits/designRevision.js";
import { connectTerminals, normalizeProject } from "../src/circuits/model.js";
import { createActivityLog } from "../src/webmcp/activityLog.js";
import { createCircuitWebMcpTools } from "../src/webmcp/circuitTools.js";
import { registerWebMcpTools } from "../src/webmcp/registerTools.js";
import { createWorkspaceStore } from "../src/workspaceStore.js";

function runtimeHarness() {
  let project = createServoRepairMission();
  let pending = null;
  const activityLog = createActivityLog();
  return {
    runtime: {
      getProject: () => project,
      getPendingConfirmation: () => pending,
      getMissionStatus: () => ({ id: "servo-repair-v1", isolated: true }),
      getBinding: () => null,
      getRobotDesign: () => null,
      activityLog,
      focusIssue: async () => {},
      connectEndpoints: async (endpointA, endpointB) => {
        const before = new Set(project.connections.map((connection) => connection.id));
        project = connectTerminals(project, endpointA, endpointB);
        return { status: "committed", connectionIds: project.connections.filter((connection) => !before.has(connection.id)).map((connection) => connection.id) };
      },
      requestRemoval: async (connectionIds) => { pending = { kind: "agent-destructive", connectionIds }; }
    },
    getProject: () => project,
    setProject: (next) => { project = normalizeProject(next); },
    setPending: (next) => { pending = next; },
    activityLog
  };
}

function tool(tools, name) {
  const found = tools.find((item) => item.name === name);
  assert.ok(found, `Missing tool ${name}`);
  return found;
}

test("final Circuit Lab WebMCP surface contains exactly seven completed tools", () => {
  const tools = createCircuitWebMcpTools(runtimeHarness().runtime);
  assert.equal(tools.length, 7);
  assert.deepEqual(tools.map((item) => item.name), ["get_circuit_state", "diagnose_circuit", "show_circuit_issue", "preview_connection", "connect_terminals", "remove_connection", "get_build_evidence"]);
  assert.equal(tools.every((item) => item.inputSchema.additionalProperties === false), true);
});

test("preview_connection is nonmutating, bounded, and rejects stale revisions", async () => {
  const harness = runtimeHarness();
  const preview = tool(createCircuitWebMcpTools(harness.runtime), "preview_connection");
  const revision = circuitDesignRevision(harness.getProject());
  const output = await preview.execute({ expectedRevision: revision, endpointA: { componentId: "breadboard", terminalId: "bp5" }, endpointB: { componentId: "servo", terminalId: "vplus" } });
  assert.equal(output.code.startsWith("preview_"), true);
  assert.equal(circuitDesignRevision(harness.getProject()), revision);
  assert.equal(JSON.stringify(output).length <= 1500, true);
  const stale = await preview.execute({ expectedRevision: "clp1-0000000000000000", endpointA: { componentId: "breadboard", terminalId: "bp5" }, endpointB: { componentId: "servo", terminalId: "vplus" } });
  assert.equal(stale.code, "stale_revision");
});

test("writes are blocked while confirmation is pending", async () => {
  const harness = runtimeHarness();
  const tools = createCircuitWebMcpTools(harness.runtime);
  const revision = circuitDesignRevision(harness.getProject());
  const pending = await tool(tools, "remove_connection").execute({ expectedRevision: revision, connectionId: "unsafe_servo_power" });
  assert.equal(pending.code, "pending_confirmation");
  const blocked = await tool(tools, "connect_terminals").execute({ expectedRevision: revision, endpointA: { componentId: "breadboard", terminalId: "bp5" }, endpointB: { componentId: "servo", terminalId: "vplus" } });
  assert.equal(blocked.code, "pending_confirmation_exists");
});

test("diagnostics stay bounded and build evidence distinguishes topology from semantic pin map", async () => {
  const tools = createCircuitWebMcpTools(runtimeHarness().runtime);
  const diagnose = await tool(tools, "diagnose_circuit").execute({ maxIssues: 6 });
  assert.equal(JSON.stringify(diagnose).length <= 1500, true);
  assert.equal(diagnose.data.issues.some((issue) => issue.code === "servo-controller-power"), true);
  const evidence = await tool(tools, "get_build_evidence").execute({});
  assert.equal(evidence.data.semanticPinMapStatus, "absent_binding");
  assert.deepEqual(evidence.data.semanticPinMap, []);
  assert.equal(evidence.data.topologyAssignments.some((row) => row.deviceTerminal === "servo.signal" && row.controllerTerminal === "arduino.D9"), true);
  assert.match(evidence.data.disclaimer, /not built, flashed, executed, or hardware-tested/i);
  assert.equal(JSON.stringify(evidence).length <= 1500, true);
});

test("tool handlers reject additional properties even when browser schema enforcement is absent", async () => {
  const output = await tool(createCircuitWebMcpTools(runtimeHarness().runtime), "diagnose_circuit").execute({ maxIssues: 4, unexpected: true });
  assert.equal(output.code, "invalid_arguments");
});

test("sequential registration exposes all seven tools and shared abort unregisters them", async () => {
  const tools = createCircuitWebMcpTools(runtimeHarness().runtime);
  const registered = [];
  const modelContext = { async registerTool(definition, options = {}) { registered.push({ definition, signal: options.signal }); } };
  const handle = await registerWebMcpTools(tools, { modelContext });
  assert.equal(handle.registered, 7);
  assert.equal(registered.length, 7);
  assert.equal(registered.every((record) => record.signal === handle.controller.signal), true);
  handle.dispose();
  assert.equal(handle.controller.signal.aborted, true);
});

test("mission workspace reads are isolated without touching IndexedDB", async () => {
  const store = createWorkspaceStore({ location: { search: "?mission=servo-repair-v1&benchmark=1" } });
  assert.equal(await store.readCurrentCircuitLabProject(), null);
  assert.equal(await store.readCurrentMechatronicsBinding(), null);
  assert.equal(await store.readCurrentRobotDesign(), null);
});

test("schemas and handlers reject malformed revisions, overlong ids, and unexpected endpoint fields", async () => {
  const harness = runtimeHarness();
  const preview = tool(createCircuitWebMcpTools(harness.runtime), "preview_connection");
  assert.equal((await preview.execute({ expectedRevision: "bad-revision", endpointA: { componentId: "breadboard", terminalId: "bp5" }, endpointB: { componentId: "servo", terminalId: "vplus" } })).code, "invalid_arguments");
  const revision = circuitDesignRevision(harness.getProject());
  assert.equal((await preview.execute({ expectedRevision: revision, endpointA: { componentId: "breadboard", terminalId: "bp5", x: 12 }, endpointB: { componentId: "servo", terminalId: "vplus" } })).code, "invalid_arguments");
  assert.equal((await tool(createCircuitWebMcpTools(harness.runtime), "show_circuit_issue").execute({ issueId: "x".repeat(121) })).code, "invalid_arguments");
});

test("diagnostic output budget keeps omitted counts coherent after budget trimming", async () => {
  const harness = runtimeHarness();
  const long = "Servo ".repeat(80);
  harness.setProject({ ...harness.getProject(), components: harness.getProject().components.map((component) => ({ ...component, name: long + component.id })) });
  const output = await tool(createCircuitWebMcpTools(harness.runtime), "diagnose_circuit").execute({ maxIssues: 6 });
  assert.equal(JSON.stringify(output).length <= 1500, true);
  assert.equal(output.data.omittedIssueCount >= 0, true);
  if (output.data.truncated) assert.equal(output.data.omittedIssueCount > 0, true);
});

test("component detail exposes bounded persistent control state when present", async () => {
  const output = await tool(createCircuitWebMcpTools(runtimeHarness().runtime), "get_circuit_state").execute({ componentId: "supply", limit: 10 });
  assert.equal(Array.isArray(output.data.persistentControls), true);
  assert.equal(output.data.persistentControls.length <= 8, true);
});

test("demo workspace isolation is scoped to Circuit Lab paths", async () => {
  const isolated = createWorkspaceStore({ location: { pathname: "/RoboStudio/circuits.html", search: "?mission=servo-repair-v1" } });
  assert.equal(await isolated.readCurrentCircuitLabProject(), null);
  const calls = [];
  const indexedDb = { open() { calls.push("open"); throw new Error("sentinel"); } };
  const otherPage = createWorkspaceStore({ location: { pathname: "/RoboStudio/physics.html", search: "?mission=servo-repair-v1" }, indexedDb });
  await assert.rejects(otherPage.readCurrentRobotDesign(), /sentinel/);
  assert.deepEqual(calls, ["open"]);
});

test("registration failure aborts the shared tool set instead of leaving a partial public surface", async () => {
  const tools = createCircuitWebMcpTools(runtimeHarness().runtime);
  const signals = [];
  let count = 0;
  const modelContext = { async registerTool(_definition, options = {}) { signals.push(options.signal); count += 1; if (count === 3) throw new Error("registration failed"); } };
  const handle = await registerWebMcpTools(tools, { modelContext });
  assert.ok(handle.error);
  assert.equal(handle.controller.signal.aborted, true);
  assert.equal(signals.every((signal) => signal.aborted), true);
  assert.equal(handle.registered, 2);
});
