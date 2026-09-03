import { TERMINAL_KINDS, catalog } from "../circuits/catalog.js";
import { findConnectedTerminals, firstControllerTerminalFor, projectController } from "../circuits/connectivity.js";
import { buildCircuitArtifacts } from "../circuits/artifacts.js";
import { generateCircuitLabSource } from "../circuits/codegen.js";
import { canonicalDrcIssueIdentity, deriveDrcFingerprintDelta } from "../circuits/drcFingerprint.js";
import { circuitDesignRevision, isCircuitDesignRevision } from "../circuits/designRevision.js";
import { inspectDirectInsertionState } from "../circuits/insertion.js";
import { normalizeProject } from "../circuits/model.js";
import { derivePhysicalOccupancy } from "../circuits/occupancy.js";
import { runCircuitLabTest } from "../circuits/testBench.js";
import { stageDisconnectMutation, stageWireMutation } from "../circuits/transactions.js";
import { canonicalEndpointPairKey } from "./activityLog.js";

const BUDGET = 1500;
const ID_PATTERN = "^[A-Za-z0-9_.:-]{1,120}$";
const REV_PATTERN = "^clp1-[0-9a-f]{16}$";
const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const text = (value, max = 180) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
const size = (value) => JSON.stringify(value).length;

function fit(value) {
  if (size(value) <= BUDGET) return value;
  const copy = JSON.parse(JSON.stringify(value));
  copy.summary = text(copy.summary, 100);
  if (copy.data) {
    const originalIssueCount = Array.isArray(copy.data.issues) ? copy.data.issues.length : 0;
    for (const key of ["components", "connections", "terminals", "positiveContacts", "groundContacts", "semanticPinMap", "topologyAssignments"]) {
      if (Array.isArray(copy.data[key]) && copy.data[key].length > 2) copy.data[key] = copy.data[key].slice(0, 2);
    }
    if (Array.isArray(copy.data.issues)) {
      while (copy.data.issues.length > 1 && size(copy) > BUDGET) copy.data.issues.pop();
      const budgetOmitted = originalIssueCount - copy.data.issues.length;
      if (budgetOmitted > 0) {
        copy.data.truncated = true;
        copy.data.omittedIssueCount = Math.max(0, Number(copy.data.omittedIssueCount ?? 0)) + budgetOmitted;
      }
    }
    copy.data.outputTruncated = true;
  }
  if (size(copy) <= BUDGET) return copy;
  const compact = { ok: copy.ok, code: copy.code, revision: copy.revision, summary: copy.summary, data: { outputTruncated: true } };
  if (copy.data?.issues?.[0]) compact.data.issues = [copy.data.issues[0]];
  if (copy.data?.totals) compact.data.totals = copy.data.totals;
  if (copy.data?.omittedIssueCount != null) compact.data.omittedIssueCount = copy.data.omittedIssueCount;
  return compact;
}
const out = (ok, code, revision, summary, data = {}) => fit({ ok, code, revision, summary: text(summary, 220), data });
const schema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const revisionSchema = { type: "string", pattern: REV_PATTERN, maxLength: 21 };
const endpointSchema = schema({ componentId: { type: "string", pattern: ID_PATTERN, maxLength: 120 }, terminalId: { type: "string", pattern: ID_PATTERN, maxLength: 120 } }, ["componentId", "terminalId"]);

function invalidKeys(input, allowed, required = []) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Input must be an object.";
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) return `Unexpected property: ${extra}.`;
  const missing = required.find((key) => !(key in input));
  return missing ? `Missing required property: ${missing}.` : null;
}
function invalidEndpoint(endpoint) {
  return invalidKeys(endpoint, ["componentId", "terminalId"], ["componentId", "terminalId"])
    ?? (!ID_RE.test(String(endpoint.componentId)) || !ID_RE.test(String(endpoint.terminalId)) ? "Endpoint IDs must be stable Circuit Lab IDs." : null);
}
function abort(signal) { if (signal?.aborted) throw new DOMException("WebMCP execution aborted", "AbortError"); }
function state(runtime) { const project = normalizeProject(runtime.getProject()); return { project, revision: circuitDesignRevision(project) }; }
function gate(runtime, expectedRevision) {
  const current = state(runtime);
  const pending = runtime.getPendingConfirmation?.();
  if (pending) return { ...current, error: out(false, "pending_confirmation_exists", current.revision, "A visible user confirmation is already pending.", { kind: pending.kind }) };
  if (expectedRevision !== current.revision) return { ...current, error: out(false, "stale_revision", current.revision, "Circuit state changed. Read state and restage.", { expectedRevision }) };
  return current;
}
function writeArgs(input) {
  return invalidKeys(input, ["expectedRevision", "endpointA", "endpointB"], ["expectedRevision", "endpointA", "endpointB"])
    ?? (!isCircuitDesignRevision(input.expectedRevision) ? "Invalid expectedRevision." : null)
    ?? invalidEndpoint(input.endpointA) ?? invalidEndpoint(input.endpointB);
}
function role(typeId) { const def = catalog.getComponent(typeId); return def?.engineering?.robotics?.role ?? def?.sim?.role ?? "unknown"; }
function issueRow(issue) {
  return { id: text(issue.id, 120), code: text(issue.code, 80), severity: issue.severity, message: text(issue.message, 150), componentIds: (issue.targets?.componentIds ?? []).slice(0, 6), terminalRefs: (issue.targets?.terminalRefs ?? issue.endpoints ?? []).slice(0, 6), connectionIds: (issue.targets?.connectionIds ?? issue.connectionIds ?? []).slice(0, 6) };
}
function freeRails(project) {
  if (!project.components.some((item) => item.id === "supply")) return { positiveContacts: [], groundContacts: [] };
  const occupancy = derivePhysicalOccupancy(project);
  const collect = (terminalId, kind) => findConnectedTerminals(project, { componentId: "supply", terminalId })
    .filter((r) => r.component.id === "breadboard" && r.terminal.kind === kind)
    .filter((r) => (occupancy.occupancyByEndpoint.get(r.endpointKey)?.length ?? 0) < Math.max(1, Number(r.terminal.attachmentCapacity ?? 1)))
    .map((r) => r.endpoint.terminalId).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 4);
  return { positiveContacts: collect("VPLUS", TERMINAL_KINDS.POWER), groundContacts: collect("GND", TERMINAL_KINDS.GROUND) };
}
function deltas(base, candidate) {
  const delta = deriveDrcFingerprintDelta(base.issues, candidate.issues);
  const candidateIds = new Set(candidate.issues.map(canonicalDrcIssueIdentity));
  const codes = (rows) => [...new Set(rows.map((row) => row.code))].filter(Boolean).slice(0, 10);
  return { resolvedIssueCodes: codes(base.issues.filter((row) => !candidateIds.has(canonicalDrcIssueIdentity(row)))), addedIssueCodes: codes(delta.added), worsenedIssueCodes: codes(delta.worsened) };
}
const signalOutput = (terminal) => terminal.kind === TERMINAL_KINDS.SIGNAL && Boolean(terminal.capabilities?.digitalOutput ?? terminal.capabilities?.includes?.("output")) && !terminal.inputOnly;
function topologyAssignments(project) {
  return project.components.flatMap((component) => {
    const def = catalog.getComponent(component.typeId);
    if (def?.sim?.role !== "servo") return [];
    const terminalId = def.sim.signalTerminal ?? "signal";
    const controller = firstControllerTerminalFor(project, { componentId: component.id, terminalId }, signalOutput);
    return controller ? [{ deviceTerminal: `${component.id}.${terminalId}`, controllerTerminal: `${controller.component.id}.${controller.terminal.id}`, basis: "topology-derived" }] : [];
  }).slice(0, 6);
}
const hasBinding = (binding) => Boolean((binding?.actuatorBindings?.length ?? 0) || (binding?.sensorBindings?.length ?? 0) || (binding?.firmwareChannels?.length ?? 0));

export function createCircuitWebMcpTools(runtime) {
  if (!runtime?.getProject) throw new Error("Circuit WebMCP runtime requires getProject().");
  let activity = 0;
  const wrap = (name, fn) => async (input = {}, client = {}) => {
    abort(client.signal);
    const before = state(runtime).revision, started = performance?.now?.() ?? Date.now(), activityId = `activity_webmcp_${++activity}`;
    runtime.activityLog?.record({ activityId, actor: "webmcp", toolName: name, status: "start", revisionBefore: before });
    try {
      const result = await fn(input, { ...client, activityId }); abort(client.signal);
      const after = state(runtime).revision;
      runtime.activityLog?.record({ activityId, actor: "webmcp", toolName: name, status: "complete", code: result.code, revisionBefore: before, revisionAfter: after, affectedComponentIds: [input.componentId, input.endpointA?.componentId, input.endpointB?.componentId].filter(Boolean), affectedConnectionIds: [input.connectionId].filter(Boolean), endpointPairKey: input.endpointA && input.endpointB ? canonicalEndpointPairKey(input.endpointA, input.endpointB) : null, durationMs: (performance?.now?.() ?? Date.now()) - started });
      runtime.onActivity?.(); return result;
    } catch (error) {
      runtime.activityLog?.record({ activityId, actor: "webmcp", toolName: name, status: "error", code: "internal_error", revisionBefore: before, revisionAfter: state(runtime).revision }); runtime.onActivity?.(); throw error;
    }
  };

  const tools = [
    { name: "get_circuit_state", title: "Get Circuit State", description: "Inspect compact Circuit Lab state, revision, occupancy, or one component's terminals.", inputSchema: schema({ componentId: { type: "string", pattern: ID_PATTERN, maxLength: 120 }, limit: { type: "integer", minimum: 1, maximum: 10 } }), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: wrap("get_circuit_state", async (input) => {
      const bad = invalidKeys(input, ["componentId", "limit"]) ?? (input.componentId != null && !ID_RE.test(input.componentId) ? "Invalid componentId." : null) ?? (input.limit != null && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) ? "limit must be 1..10." : null);
      const { project, revision } = state(runtime); if (bad) return out(false, "invalid_arguments", revision, bad); const limit = input.limit ?? 8;
      if (input.componentId) {
        const component = project.components.find((item) => item.id === input.componentId), def = component && catalog.getComponent(component.typeId);
        if (!def) return out(false, "unknown_id", revision, `Unknown component ID ${text(input.componentId, 120)}.`);
        const occupancy = derivePhysicalOccupancy(project), terminals = def.terminals.slice(0, limit).map((terminal) => { const attachments = occupancy.occupancyByEndpoint.get(`${component.id}:${terminal.id}`) ?? []; return { id: terminal.id, label: text(terminal.physicalLabel ?? terminal.label ?? terminal.id, 60), electricalRole: terminal.electricalRole ?? terminal.kind, capacity: Math.max(1, Number(terminal.attachmentCapacity ?? 1)), occupied: attachments.length, connectionIds: attachments.map((row) => row.connectionId).slice(0, 4) }; });
        const persistentControls = Object.entries(component.props?.controls ?? {}).slice(0, 8).map(([id, value]) => ({ id: text(id, 80), value: typeof value === "boolean" || typeof value === "number" || typeof value === "string" ? value : null }));
        return out(true, "component_state", revision, `${component.id} terminal detail.`, { component: { id: component.id, typeId: component.typeId, role: role(component.typeId) }, terminals, persistentControls, truncated: def.terminals.length > terminals.length || Object.keys(component.props?.controls ?? {}).length > persistentControls.length });
      }
      const rails = freeRails(project), pending = runtime.getPendingConfirmation?.();
      return out(true, "circuit_state", revision, `${project.components.length} components and ${project.connections.length} connections.`, { mission: runtime.getMissionStatus?.() ?? null, controllerId: projectController(project)?.instance?.id ?? null, components: project.components.slice(0, limit).map((c) => ({ id: c.id, typeId: c.typeId, role: role(c.typeId) })), connections: project.connections.slice(0, limit).map((c) => ({ id: c.id, kind: c.kind ?? "wire", endpoints: c.endpoints.map((e) => `${e.componentId}.${e.terminalId}`) })), pendingConfirmation: pending ? { kind: pending.kind, connectionIds: pending.connectionIds ?? [] } : null, ...rails, truncated: project.components.length > limit || project.connections.length > limit });
    }) },
    { name: "diagnose_circuit", title: "Diagnose Circuit", description: "Run deterministic Circuit Lab DRC and return bounded stable issue targets.", inputSchema: schema({ maxIssues: { type: "integer", minimum: 1, maximum: 6 } }), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: wrap("diagnose_circuit", async (input) => {
      const bad = invalidKeys(input, ["maxIssues"]) ?? (input.maxIssues != null && (!Number.isInteger(input.maxIssues) || input.maxIssues < 1 || input.maxIssues > 6) ? "maxIssues must be 1..6." : null); const { project, revision } = state(runtime); if (bad) return out(false, "invalid_arguments", revision, bad);
      const test = runCircuitLabTest(project), rows = test.issues.slice(0, input.maxIssues ?? 4).map(issueRow); return out(true, test.summary.errors ? "issues_found" : test.summary.warnings ? "review_required" : "clear", revision, `${test.summary.errors} errors, ${test.summary.warnings} warnings, ${test.summary.info} info.`, { totals: test.summary, issues: rows, truncated: test.issues.length > rows.length, omittedIssueCount: Math.max(0, test.issues.length - rows.length) });
    }) },
    { name: "show_circuit_issue", title: "Show Circuit Issue", description: "Focus a current DRC issue in the Circuit Lab Test Results UI without changing design state.", inputSchema: schema({ issueId: { type: "string", pattern: ID_PATTERN, maxLength: 120 } }, ["issueId"]), annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: wrap("show_circuit_issue", async (input) => {
      const { project, revision } = state(runtime), bad = invalidKeys(input, ["issueId"], ["issueId"]) ?? (!ID_RE.test(String(input.issueId)) ? "Invalid issueId." : null); if (bad) return out(false, "invalid_arguments", revision, bad); const issue = runCircuitLabTest(project).issues.find((row) => row.id === input.issueId); if (!issue) return out(false, "unknown_id", revision, "Issue is not present in current DRC.");
      const focus = issue.targets?.connectionIds?.[0] ? { type: "connection", id: issue.targets.connectionIds[0] } : issue.targets?.terminalRefs?.[0] ? { type: "terminal", endpoint: issue.targets.terminalRefs[0] } : issue.targets?.componentIds?.[0] ? { type: "component", id: issue.targets.componentIds[0] } : { type: "project" }; await runtime.focusIssue?.(issue.id, focus); return out(true, "issue_focused", revision, `Focused issue ${issue.id}.`, { issueId: issue.id, focusTarget: focus });
    }) },
    { name: "preview_connection", title: "Preview Connection", description: "Evaluate an exact endpoint pair against capacity and candidate DRC without mutation.", inputSchema: schema({ expectedRevision: revisionSchema, endpointA: endpointSchema, endpointB: endpointSchema }, ["expectedRevision", "endpointA", "endpointB"]), annotations: { readOnlyHint: true }, execute: wrap("preview_connection", async (input) => {
      const bad = writeArgs(input), now = state(runtime); if (bad) return out(false, "invalid_arguments", now.revision, bad); const checked = gate(runtime, input.expectedRevision); if (checked.error) return checked.error; const mutation = stageWireMutation(checked.project, input.endpointA, input.endpointB, 0); if (mutation.status === "mechanically-impossible") return out(false, "mechanically_blocked", checked.revision, mutation.mechanical.message, { reasonCode: mutation.mechanical.reasonCode });
      const delta = deltas(runCircuitLabTest(checked.project), runCircuitLabTest(mutation.candidateProject)); return out(true, mutation.requiresConfirmation ? "preview_hazard" : "preview_safe", checked.revision, mutation.requiresConfirmation ? "Connection is mechanically valid but creates or worsens an electrical hazard." : "Connection is mechanically valid and adds no electrical hazard.", { mechanicallyValid: true, requiresConfirmation: mutation.requiresConfirmation, ...delta });
    }) },
    { name: "connect_terminals", title: "Connect Terminals", description: "Restage an exact connection and execute it through the live Circuit Lab transaction path.", inputSchema: schema({ expectedRevision: revisionSchema, endpointA: endpointSchema, endpointB: endpointSchema }, ["expectedRevision", "endpointA", "endpointB"]), annotations: { readOnlyHint: false }, execute: wrap("connect_terminals", async (input, context) => {
      const bad = writeArgs(input), now = state(runtime); if (bad) return out(false, "invalid_arguments", now.revision, bad); const checked = gate(runtime, input.expectedRevision); if (checked.error) return checked.error; const mutation = stageWireMutation(checked.project, input.endpointA, input.endpointB, 0); if (mutation.status === "mechanically-impossible") return out(false, "mechanically_blocked", checked.revision, mutation.mechanical.message, { reasonCode: mutation.mechanical.reasonCode });
      const execution = await runtime.connectEndpoints(input.endpointA, input.endpointB, { expectedRevision: checked.revision, predictedConnectionIds: mutation.addedConnectionIds, activityId: context.activityId }); const revised = state(runtime).revision; if (execution?.status === "pending_confirmation") return out(false, "pending_confirmation", revised, "Connection awaits visible user confirmation.", { connectionIds: mutation.addedConnectionIds, kind: "electrical-hazard" }); if (execution?.status !== "committed") return out(false, execution?.code ?? "mechanically_blocked", revised, execution?.summary ?? "Connection did not commit."); return out(true, "committed", revised, "Connection committed through live Circuit Lab transactions.", { connectionIds: execution.connectionIds ?? mutation.addedConnectionIds });
    }) },
    { name: "remove_connection", title: "Remove Connection", description: "Stage removal of an existing connection and require visible human confirmation.", inputSchema: schema({ expectedRevision: revisionSchema, connectionId: { type: "string", pattern: ID_PATTERN, maxLength: 120 } }, ["expectedRevision", "connectionId"]), annotations: { readOnlyHint: false }, execute: wrap("remove_connection", async (input, context) => {
      const bad = invalidKeys(input, ["expectedRevision", "connectionId"], ["expectedRevision", "connectionId"]) ?? (!isCircuitDesignRevision(input.expectedRevision) ? "Invalid expectedRevision." : null) ?? (!ID_RE.test(String(input.connectionId)) ? "Invalid connectionId." : null); const now = state(runtime); if (bad) return out(false, "invalid_arguments", now.revision, bad); const checked = gate(runtime, input.expectedRevision); if (checked.error) return checked.error; const connection = checked.project.connections.find((row) => row.id === input.connectionId); if (!connection) return out(false, "unknown_id", checked.revision, "Unknown connection ID.");
      let ids = [connection.id]; if ((connection.kind ?? "wire") === "direct-insertion") ids = inspectDirectInsertionState(checked.project).find((group) => group.connectionIds.includes(connection.id))?.connectionIds ?? ids; const mutation = stageDisconnectMutation(checked.project, ids, 0); if (mutation.status === "mechanically-impossible") return out(false, "mechanically_blocked", checked.revision, mutation.mechanical.message); const request = await runtime.requestRemoval(ids, { expectedRevision: checked.revision, activityId: context.activityId, mutation }); const revised = state(runtime).revision; if (request?.status === "blocked") return out(false, request.code ?? "stale_revision", revised, request.summary ?? "Removal request could not be staged."); return out(false, "pending_confirmation", checked.revision, "Wire removal awaits visible user confirmation.", { connectionIds: ids, kind: "agent-destructive" });
    }) },
    { name: "get_build_evidence", title: "Get Build Evidence", description: "Return bounded source-only readiness and distinguish topology assignments from semantic pin-map evidence.", inputSchema: schema(), annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: wrap("get_build_evidence", async (input) => {
      const { project, revision } = state(runtime), bad = invalidKeys(input, []); if (bad) return out(false, "invalid_arguments", revision, bad); const binding = runtime.getBinding?.() ?? null, robotDesign = runtime.getRobotDesign?.() ?? null, artifacts = buildCircuitArtifacts({ circuitLabProject: project, robotDesign, mechatronicsBinding: binding }), source = generateCircuitLabSource(project, { robotDesign, mechatronicsBinding: binding, artifacts });
      const semantic = (artifacts.pinMapRows ?? []).slice(0, 4).map((row) => ({ channelId: row["firmware channel ID"], controllerTerminalId: row["controller terminal ID"], deviceComponentId: row["device component ID"], deviceTerminalId: row["device terminal ID"] })), semanticStatus = !hasBinding(binding) ? "absent_binding" : artifacts.bindingValidation?.ok !== true ? "blocked" : semantic.length ? "ready" : "empty", warnings = artifacts.test.issues.filter((row) => row.severity === "warning").map((row) => row.code).slice(0, 12), code = artifacts.test.summary.errors ? "blocked" : warnings.length ? "review_required" : "ready";
      return out(true, code, revision, code === "blocked" ? "Build evidence is blocked by Circuit Lab errors." : code === "review_required" ? "Circuit is electrically clear but requires physical review." : "Circuit is clear for source-only generation.", { drcStatus: artifacts.readiness?.electrical?.status ?? code, readinessStatus: artifacts.readiness?.overallStatus ?? code, sourceReady: Boolean(source.ready), sourceTarget: source.target, remainingWarnings: warnings, topologyAssignments: topologyAssignments(project), semanticPinMapStatus: semanticStatus, semanticPinMap: semantic, bomGroupCount: artifacts.bomRows?.length ?? 0, harnessConnectionCount: artifacts.harnessRows?.length ?? 0, disclaimer: "Source-only; not built, flashed, executed, or hardware-tested." });
    }) }
  ];
  if (tools.length !== 7) throw new Error("Challenge WebMCP surface must contain exactly seven tools.");
  return tools;
}

export function circuitWebMcpSchemas() { return { endpointSchema, expectedRevisionSchema: revisionSchema, stableIdPattern: ID_PATTERN, revisionPattern: REV_PATTERN }; }
