import { canonicalDrcIssueFingerprint, deriveDrcFingerprintDelta } from "./drcFingerprint.js";
import {
  applyInsertionPlan,
  directInsertionEndpointPairsForComponent,
  resolveInsertionOutcome
} from "./insertion.js";
import { connectTerminals, endpointKey, normalizeProject, removeConnection } from "./model.js";
import { directInsertionConnectionsForComponent } from "./occupancy.js";
import { runCircuitLabTest } from "./testBench.js";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function projectFingerprint(project) {
  return JSON.stringify(normalizeProject(project));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function endpointPair(sourceEndpoint, targetEndpoint) {
  return { sourceEndpoint: cloneJson(sourceEndpoint), targetEndpoint: cloneJson(targetEndpoint) };
}

function canonicalEndpointPair(pair) {
  return [endpointKey(pair.sourceEndpoint), endpointKey(pair.targetEndpoint)].sort().join("|");
}

function connectionDiff(baseProject, candidateProject) {
  const baseIds = new Set(baseProject.connections.map((connection) => connection.id));
  const candidateIds = new Set(candidateProject.connections.map((connection) => connection.id));
  return {
    addedConnectionIds: [...candidateIds].filter((id) => !baseIds.has(id)).sort(),
    removedConnectionIds: [...baseIds].filter((id) => !candidateIds.has(id)).sort()
  };
}

function mutationId(operationKind, baseGeneration, exactEndpointPairs) {
  const signature = `${operationKind}|${baseGeneration}|${exactEndpointPairs.map(canonicalEndpointPair).sort().join(";")}`;
  return `mutation_${operationKind}_${stableHash(signature)}`;
}

function drcDelta(baseProject, candidateProject) {
  const base = runCircuitLabTest(baseProject);
  const candidate = runCircuitLabTest(candidateProject);
  return {
    base,
    candidate,
    ...deriveDrcFingerprintDelta(base.issues, candidate.issues)
  };
}

function finalizedMutation({
  operationKind,
  baseProject,
  candidateProject,
  baseGeneration,
  exactEndpointPairs = [],
  mechanicalState = "resolved",
  mechanicalMessage = "Mechanical constraints resolved.",
  operation,
  insertionPlan = null,
  explicitAddedConnectionIds = null,
  explicitRemovedConnectionIds = null
}) {
  const normalizedBase = normalizeProject(baseProject);
  const normalizedCandidate = normalizeProject(candidateProject);
  const delta = drcDelta(normalizedBase, normalizedCandidate);
  const diff = connectionDiff(normalizedBase, normalizedCandidate);
  const hazards = delta.electricalHazards;
  return {
    id: mutationId(operationKind, baseGeneration, exactEndpointPairs),
    operationKind,
    baseGeneration,
    baseProjectFingerprint: projectFingerprint(normalizedBase),
    exactEndpointPairs: cloneJson(exactEndpointPairs),
    candidateProject: normalizedCandidate,
    addedConnectionIds: explicitAddedConnectionIds ?? diff.addedConnectionIds,
    removedConnectionIds: explicitRemovedConnectionIds ?? diff.removedConnectionIds,
    drcDelta: {
      addedFingerprints: delta.addedFingerprints,
      worsenedFingerprints: delta.worsenedFingerprints,
      electricalHazardFingerprints: delta.electricalHazardFingerprints,
      hazards: cloneJson(hazards)
    },
    mechanical: {
      state: mechanicalState,
      resolved: mechanicalState === "resolved" || mechanicalState === "not-applicable",
      message: mechanicalMessage
    },
    electrical: {
      state: hazards.length ? "hazardous" : "safe",
      safe: hazards.length === 0,
      hazards: cloneJson(hazards)
    },
    status: hazards.length ? "electrically-hazardous" : "electrically-safe",
    requiresConfirmation: hazards.length > 0,
    insertionPlan: insertionPlan ? cloneJson({
      componentId: insertionPlan.componentId,
      patternId: insertionPlan.patternId,
      position: insertionPlan.position,
      maximumResidualMm: insertionPlan.maximumResidualMm,
      maximumAngularResidualDeg: insertionPlan.maximumAngularResidualDeg,
      totalMovementMm: insertionPlan.totalMovementMm,
      stableEndpointOrder: insertionPlan.stableEndpointOrder
    }) : null,
    operation: cloneJson(operation)
  };
}

function blockedMutation(operationKind, baseProject, baseGeneration, outcome, operation) {
  return {
    id: mutationId(operationKind, baseGeneration, []),
    operationKind,
    baseGeneration,
    baseProjectFingerprint: projectFingerprint(baseProject),
    exactEndpointPairs: [],
    candidateProject: null,
    addedConnectionIds: [],
    removedConnectionIds: [],
    drcDelta: {
      addedFingerprints: [],
      worsenedFingerprints: [],
      electricalHazardFingerprints: [],
      hazards: []
    },
    mechanical: {
      state: "impossible",
      resolved: false,
      reasonCode: outcome?.reasonCode ?? "mechanically-impossible",
      message: outcome?.message ?? "The requested physical connection is mechanically impossible."
    },
    electrical: { state: "not-evaluated", safe: false, hazards: [] },
    status: "mechanically-impossible",
    requiresConfirmation: false,
    insertionPlan: null,
    operation: cloneJson(operation)
  };
}

export function stageInsertionMutation(baseProject, proposedProject, componentId, baseGeneration, options = {}) {
  const base = normalizeProject(baseProject);
  const proposed = normalizeProject(proposedProject);
  const existingDirectIds = directInsertionConnectionsForComponent(base, componentId).map((connection) => connection.id).sort();
  const requiredEndpointPairs = options.requiredEndpointPairs
    ?? (options.repairMode ? directInsertionEndpointPairsForComponent(base, componentId) : []);
  const operationKind = options.operationKind ?? (options.repairMode ? "re-seat" : "place");
  const operation = {
    type: "insertion",
    operationKind,
    componentId,
    proposedProject: proposed,
    repairMode: Boolean(options.repairMode),
    requiredEndpointPairs,
    maxDistance: options.maxDistance
  };
  const outcome = resolveInsertionOutcome(proposed, componentId, {
    removableConnectionIds: existingDirectIds,
    requiredEndpointPairs,
    maxDistance: options.maxDistance
  });
  if (outcome.state === "blocked" || (existingDirectIds.length && !outcome.plan)) {
    return blockedMutation(operationKind, base, baseGeneration, outcome, operation);
  }
  let candidate = proposed;
  let exactEndpointPairs = [];
  let explicitAddedConnectionIds = null;
  let explicitRemovedConnectionIds = null;
  if (outcome.plan) {
    const applied = applyInsertionPlan(proposed, {
      ...outcome.plan,
      removeConnectionIds: existingDirectIds
    });
    candidate = applied.project;
    explicitAddedConnectionIds = [...applied.addedConnectionIds].sort();
    explicitRemovedConnectionIds = [...existingDirectIds];
    exactEndpointPairs = outcome.plan.matches.map((match) => endpointPair(match.source.endpoint, match.target.endpoint));
  }
  return finalizedMutation({
    operationKind,
    baseProject: base,
    candidateProject: candidate,
    baseGeneration,
    exactEndpointPairs,
    mechanicalState: outcome.plan ? "resolved" : "not-applicable",
    mechanicalMessage: outcome.message,
    operation,
    insertionPlan: outcome.plan,
    explicitAddedConnectionIds,
    explicitRemovedConnectionIds
  });
}

export function stageWireMutation(baseProject, endpointA, endpointB, baseGeneration, options = {}) {
  const base = normalizeProject(baseProject);
  const operation = {
    type: "wire",
    endpointA,
    endpointB,
    name: options.name ?? null,
    color: options.color ?? null
  };
  try {
    const candidate = connectTerminals(base, endpointA, endpointB, {
      name: options.name,
      color: options.color
    });
    return finalizedMutation({
      operationKind: "connect",
      baseProject: base,
      candidateProject: candidate,
      baseGeneration,
      exactEndpointPairs: [endpointPair(endpointA, endpointB)],
      mechanicalState: "resolved",
      mechanicalMessage: "Both endpoints exist and have physical attachment capacity.",
      operation
    });
  } catch (error) {
    return blockedMutation("connect", base, baseGeneration, {
      reasonCode: /capacity filled/i.test(error.message) ? "full-contact" : "invalid-endpoint",
      message: error.message
    }, operation);
  }
}

export function stageDisconnectMutation(baseProject, connectionIds, baseGeneration, options = {}) {
  const base = normalizeProject(baseProject);
  const ids = [...new Set(connectionIds ?? [])].sort();
  const operation = { type: "disconnect", connectionIds: ids, componentId: options.componentId ?? null };
  try {
    let candidate = base;
    for (const connectionId of ids) candidate = removeConnection(candidate, connectionId);
    return finalizedMutation({
      operationKind: "disconnect",
      baseProject: base,
      candidateProject: candidate,
      baseGeneration,
      exactEndpointPairs: [],
      mechanicalState: "resolved",
      mechanicalMessage: `${ids.length} direct-insertion record${ids.length === 1 ? "" : "s"} selected for removal.`,
      operation
    });
  } catch (error) {
    return blockedMutation("disconnect", base, baseGeneration, {
      reasonCode: "missing-connection",
      message: error.message
    }, operation);
  }
}

function planSignature(mutation) {
  return JSON.stringify({
    operationKind: mutation.operationKind,
    exactEndpointPairs: mutation.exactEndpointPairs.map(canonicalEndpointPair).sort(),
    addedConnectionIds: mutation.addedConnectionIds,
    removedConnectionIds: mutation.removedConnectionIds,
    hazardFingerprints: mutation.drcDelta.electricalHazardFingerprints
  });
}

function restageMutation(project, generation, mutation) {
  const operation = mutation.operation;
  if (operation.type === "insertion") {
    return stageInsertionMutation(project, operation.proposedProject, operation.componentId, generation, {
      operationKind: operation.operationKind,
      repairMode: operation.repairMode,
      requiredEndpointPairs: operation.requiredEndpointPairs,
      maxDistance: operation.maxDistance
    });
  }
  if (operation.type === "wire") {
    return stageWireMutation(project, operation.endpointA, operation.endpointB, generation, {
      name: operation.name,
      color: operation.color
    });
  }
  if (operation.type === "disconnect") {
    return stageDisconnectMutation(project, operation.connectionIds, generation, { componentId: operation.componentId });
  }
  return null;
}

export function commitStagedMutation(currentProject, currentGeneration, mutation) {
  const current = normalizeProject(currentProject);
  if (!mutation || mutation.status === "mechanically-impossible") {
    return { ok: false, reason: "mechanically-impossible", project: current, mutation: null };
  }
  if (currentGeneration !== mutation.baseGeneration) {
    return { ok: false, reason: "stale-generation", project: current, mutation: null };
  }
  if (projectFingerprint(current) !== mutation.baseProjectFingerprint) {
    return { ok: false, reason: "stale-base-project", project: current, mutation: null };
  }
  const refreshed = restageMutation(current, currentGeneration, mutation);
  if (!refreshed || refreshed.status === "mechanically-impossible") {
    return { ok: false, reason: "mechanically-impossible", project: current, mutation: refreshed };
  }
  if (planSignature(refreshed) !== planSignature(mutation)) {
    return { ok: false, reason: "stale-plan", project: current, mutation: refreshed };
  }
  return { ok: true, reason: null, project: refreshed.candidateProject, mutation: refreshed };
}

export function mutationHazardSummary(mutation) {
  return (mutation?.electrical?.hazards ?? []).map((issue) => ({
    fingerprint: canonicalDrcIssueFingerprint(issue),
    code: issue.code,
    message: issue.message,
    endpoints: issue.targets?.terminalRefs ?? issue.endpoints ?? []
  }));
}
