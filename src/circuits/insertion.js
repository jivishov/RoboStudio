import { TERMINAL_KINDS, catalog } from "./catalog.js";
import {
  clampComponentPosition,
  componentScale,
  componentWorldVector,
  terminalWorldPosition
} from "./geometry.js";
import { connectTerminals, endpointKey, normalizeProject, updateComponent } from "./model.js";
import {
  derivePhysicalOccupancy,
  directInsertionConnectionsForComponent
} from "./occupancy.js";
import { directConnectorInterfacesCompatible, relativeScalesMatch } from "./physicalCatalog.js";

const DEFAULT_INSERT_DISTANCE_MM = 1.27;
const EXISTING_ALIGNMENT_TOLERANCE_MM = 0.01;
const SUPPORTED_RIGIDITY = new Set(["rigid", "fixed-lead-span", "flexible"]);

const MECHANICAL_BLOCK_MESSAGES = Object.freeze({
  "custom-wire-only": "Custom components are wire-only and cannot be directly inserted.",
  "invalid-rotation": "The component rotation is not allowed by its insertion pattern.",
  "relative-scale": "Direct insertion requires matching physical scale.",
  "wrong-interface-or-gender": "The nearest contacts have incompatible connector interfaces or genders.",
  "ordinary-wire-present": "An ordinary wire already uses a source or target contact; it was left unchanged.",
  "full-contact": "The nearest physical contact is already at attachment capacity.",
  "multiple-target-components": "A complete insertion must resolve on one target component.",
  "duplicate-target-contact": "A complete insertion cannot reuse the same target contact.",
  "incomplete-pattern": "Every contact in the declared insertion pattern must mate successfully.",
  "excessive-residual": "The contact constellation exceeds its position tolerance.",
  "angular-tolerance": "The connector direction exceeds its angular tolerance.",
  "contact-order": "The physical contact order does not match the target housing.",
  "unsupported-rigidity": "The insertion pattern has an unsupported rigidity declaration.",
  "clamped-position": "The required insertion position falls outside the usable bench.",
  "no-nearby-contact": "No physical insertion target is within range."
});

const BLOCK_REASON_PRIORITY = Object.freeze([
  "ordinary-wire-present",
  "full-contact",
  "wrong-interface-or-gender",
  "invalid-rotation",
  "relative-scale",
  "multiple-target-components",
  "duplicate-target-contact",
  "contact-order",
  "angular-tolerance",
  "unsupported-rigidity",
  "clamped-position",
  "excessive-residual",
  "incomplete-pattern",
  "no-nearby-contact"
]);

function endpointPairKey(left, right) {
  return [endpointKey(left), endpointKey(right)].sort().join("|");
}

function samePoint(left, right, tolerance = 0.0001) {
  return Math.abs(left[0] - right[0]) <= tolerance && Math.abs(left[1] - right[1]) <= tolerance;
}

function distanceBetween(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function normalizedAngleDelta(leftDeg, rightDeg) {
  const raw = Math.abs(((leftDeg - rightDeg + 540) % 360) - 180);
  return Math.min(180, raw);
}

function vectorAngleDeg(vector) {
  return Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
}

function angleBetweenVectors(left, right) {
  if (Math.hypot(...left) < 1e-9 || Math.hypot(...right) < 1e-9) return 180;
  return normalizedAngleDelta(vectorAngleDeg(left), vectorAngleDeg(right));
}

function stablePairOrder(matches) {
  return matches
    .map((match) => endpointPairKey(match.source.endpoint, match.target.endpoint))
    .sort()
    .join(";");
}

function insertionColor(role) {
  if (role === "positive") return "#dc2626";
  if (role === "negative") return "#111827";
  if (role === "signal") return "#f59e0b";
  if (role === "load") return "#22c55e";
  return "#64748b";
}

function insertionName(sourceComponent, sourceTerminal, targetComponent, targetTerminal) {
  return `${sourceComponent.name} ${sourceTerminal.label ?? sourceTerminal.id} inserted into ${targetComponent.name} ${targetTerminal.label ?? targetTerminal.id}`;
}

export function terminalInsertionRole(terminal) {
  if (!terminal) return "passive";
  if (terminal.electricalRole === "power-input" || terminal.electricalRole === "power-source") return "positive";
  if (terminal.electricalRole === "ground") return "negative";
  if (terminal.electricalRole === "signal-input" || terminal.electricalRole === "signal-output") return "signal";
  if (terminal.kind === TERMINAL_KINDS.POWER) return "positive";
  if (terminal.kind === TERMINAL_KINDS.GROUND) return "negative";
  if (terminal.kind === TERMINAL_KINDS.SIGNAL) return "signal";
  if (terminal.kind === TERMINAL_KINDS.LOAD) return "load";
  return "passive";
}

export function terminalsMechanicallyMate(sourceTerminal, targetTerminal) {
  return directConnectorInterfacesCompatible(
    sourceTerminal?.connectorInterface,
    targetTerminal?.connectorInterface
  );
}

// Retained as a mechanical-only compatibility alias for callers outside this module.
export function terminalsCanInsert(sourceTerminal, targetTerminal) {
  return terminalsMechanicallyMate(sourceTerminal, targetTerminal);
}

function componentRecord(project, componentId) {
  const component = project.components.find((item) => item.id === componentId);
  const componentDefinition = component ? catalog.getComponent(component.typeId) : null;
  return component && componentDefinition ? { component, componentDefinition } : null;
}

function terminalRecord(project, endpoint) {
  const component = project.components.find((item) => item.id === endpoint?.componentId);
  const componentDefinition = component ? catalog.getComponent(component.typeId) : null;
  const terminal = componentDefinition?.terminals?.find((item) => item.id === endpoint?.terminalId);
  if (!component || !componentDefinition || !terminal) return null;
  return {
    component,
    componentDefinition,
    terminal,
    endpoint: { componentId: component.id, terminalId: terminal.id },
    worldPosition: terminalWorldPosition(component, terminal)
  };
}

function sourceTerminals(component, componentDefinition, pattern) {
  return pattern.terminalIds.map((terminalId) => {
    const terminal = componentDefinition.terminals.find((item) => item.id === terminalId);
    return terminal
      ? {
          component,
          componentDefinition,
          terminal,
          endpoint: { componentId: component.id, terminalId: terminal.id },
          worldPosition: terminalWorldPosition(component, terminal)
        }
      : null;
  }).filter(Boolean);
}

function targetTerminals(project, sourceComponentId) {
  const targets = [];
  for (const component of project.components) {
    if (component.id === sourceComponentId) continue;
    const componentDefinition = catalog.getComponent(component.typeId);
    if (!componentDefinition) continue;
    if (componentDefinition.custom || component.typeId.startsWith("custom:")) continue;
    for (const terminal of componentDefinition.terminals) {
      targets.push({
        component,
        componentDefinition,
        terminal,
        endpoint: { componentId: component.id, terminalId: terminal.id },
        worldPosition: terminalWorldPosition(component, terminal)
      });
    }
  }
  return targets;
}

function spatialCell(value, cellSize) {
  return Math.floor(value / cellSize);
}

function buildSpatialLookup(records, cellSize) {
  const resolvedCellSize = Math.max(0.05, Number(cellSize) || DEFAULT_INSERT_DISTANCE_MM);
  const buckets = new Map();
  for (const record of records) {
    const key = `${spatialCell(record.worldPosition[0], resolvedCellSize)}:${spatialCell(record.worldPosition[1], resolvedCellSize)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }
  return {
    query(point, radius) {
      const safeRadius = Math.max(0, Number(radius) || 0);
      const minX = spatialCell(point[0] - safeRadius, resolvedCellSize);
      const maxX = spatialCell(point[0] + safeRadius, resolvedCellSize);
      const minY = spatialCell(point[1] - safeRadius, resolvedCellSize);
      const maxY = spatialCell(point[1] + safeRadius, resolvedCellSize);
      const found = [];
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          for (const record of buckets.get(`${x}:${y}`) ?? []) {
            const distance = distanceBetween(point, record.worldPosition);
            if (distance <= safeRadius + 1e-9) found.push({ record, distance });
          }
        }
      }
      return found.sort((left, right) => left.distance - right.distance
        || endpointKey(left.record.endpoint).localeCompare(endpointKey(right.record.endpoint)));
    }
  };
}

function physicalPortForTerminal(definition, terminalId) {
  return definition?.physicalPorts?.find((port) => port.terminalIds.includes(terminalId)) ?? null;
}

function matingRule(sourceInterface, targetInterface) {
  if (sourceInterface === "servo-female-plug" && targetInterface === "servo-male-header") {
    return { normalRelation: "aligned", contactOrder: "same" };
  }
  return { normalRelation: "not-applicable", contactOrder: "not-applicable" };
}

function portNormalWorld(component, port) {
  return port?.outwardNormalLocal ? componentWorldVector(component, port.outwardNormalLocal) : null;
}

function endpointOccupancy(occupancy, endpoint) {
  return occupancy.occupancyByEndpoint.get(endpointKey(endpoint)) ?? [];
}

export function occupancyBlockReason(occupancy, endpoint, attachmentCapacity = 1) {
  const records = endpointOccupancy(occupancy, endpoint);
  if (!records.length) return null;
  if (records.some((record) => record.kind === "wire")) return "ordinary-wire-present";
  const capacity = Number.isFinite(Number(attachmentCapacity))
    ? Math.max(1, Math.floor(Number(attachmentCapacity)))
    : 1;
  return records.length >= capacity ? "full-contact" : null;
}

function removeConnectionIds(project, connectionIds) {
  const ids = new Set(connectionIds);
  return normalizeProject({
    ...project,
    connections: project.connections.filter((connection) => !ids.has(connection.id))
  });
}

function requiredPairMap(pairs = []) {
  const map = new Map();
  for (const pair of pairs) {
    if (!pair?.sourceEndpoint || !pair?.targetEndpoint) continue;
    map.set(endpointKey(pair.sourceEndpoint), endpointKey(pair.targetEndpoint));
  }
  return map;
}

function nearestOnly(candidates) {
  if (!candidates.length) return [];
  const minimum = candidates[0].distance;
  return candidates.filter((candidate) => Math.abs(candidate.distance - minimum) <= 1e-9);
}

function patternRotationAllowed(component, pattern) {
  const rotation = ((Math.round(Number(component.rotation) || 0) % 360) + 360) % 360;
  return (pattern.allowedRotationsDeg ?? [0, 90, 180, 270]).includes(rotation);
}

function candidatePortChecks(matches, angularToleranceDeg) {
  const grouped = new Map();
  let maximumAngularResidual = 0;
  for (const match of matches) {
    const sourcePort = physicalPortForTerminal(match.source.componentDefinition, match.source.terminal.id);
    const targetPort = physicalPortForTerminal(match.target.componentDefinition, match.target.terminal.id);
    const rule = matingRule(match.source.terminal.connectorInterface, match.target.terminal.connectorInterface);
    if (sourcePort && targetPort && rule.normalRelation !== "not-applicable") {
      const sourceNormal = portNormalWorld(match.source.component, sourcePort);
      const targetNormal = portNormalWorld(match.target.component, targetPort);
      const expectedTargetNormal = rule.normalRelation === "opposed"
        ? [-targetNormal[0], -targetNormal[1]]
        : targetNormal;
      const residual = angleBetweenVectors(sourceNormal, expectedTargetNormal);
      maximumAngularResidual = Math.max(maximumAngularResidual, residual);
      if (residual > angularToleranceDeg + 1e-9) return { ok: false, reasonCode: "angular-tolerance" };
    }
    if (!sourcePort || !targetPort || rule.contactOrder === "not-applicable") continue;
    const key = `${sourcePort.id}|${targetPort.id}|${rule.contactOrder}`;
    if (!grouped.has(key)) grouped.set(key, { sourcePort, targetPort, rule, matches: [] });
    grouped.get(key).matches.push(match);
  }
  for (const group of grouped.values()) {
    if (group.matches.length < 2) continue;
    const sourceIndexes = group.matches.map((match) => group.sourcePort.terminalIds.indexOf(match.source.terminal.id));
    const targetIndexes = group.matches.map((match) => group.targetPort.terminalIds.indexOf(match.target.terminal.id));
    const sourceStart = Math.min(...sourceIndexes);
    const targetStart = Math.min(...targetIndexes);
    const sourceNormalized = sourceIndexes.map((index) => index - sourceStart);
    const targetNormalized = targetIndexes.map((index) => index - targetStart);
    const expected = group.rule.contactOrder === "reverse" ? [...targetNormalized].reverse() : targetNormalized;
    if (sourceNormalized.some((value, index) => value !== expected[index])) {
      return { ok: false, reasonCode: "contact-order" };
    }
  }
  return { ok: true, maximumAngularResidual };
}

function rigidityChecks(matches, rigidity, positionToleranceMm, angularToleranceDeg) {
  if (!SUPPORTED_RIGIDITY.has(rigidity)) return { ok: false, reasonCode: "unsupported-rigidity" };
  if (rigidity === "flexible" || matches.length < 2) return { ok: true, maximumAngularResidual: 0 };
  let maximumAngularResidual = 0;
  for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < matches.length; rightIndex += 1) {
      const sourceVector = [
        matches[rightIndex].source.worldPosition[0] - matches[leftIndex].source.worldPosition[0],
        matches[rightIndex].source.worldPosition[1] - matches[leftIndex].source.worldPosition[1]
      ];
      const targetVector = [
        matches[rightIndex].target.worldPosition[0] - matches[leftIndex].target.worldPosition[0],
        matches[rightIndex].target.worldPosition[1] - matches[leftIndex].target.worldPosition[1]
      ];
      if (Math.abs(Math.hypot(...sourceVector) - Math.hypot(...targetVector)) > positionToleranceMm * 2 + 1e-9) {
        return { ok: false, reasonCode: "excessive-residual" };
      }
      const residual = angleBetweenVectors(sourceVector, targetVector);
      maximumAngularResidual = Math.max(maximumAngularResidual, residual);
      if (residual > angularToleranceDeg + 1e-9) return { ok: false, reasonCode: "angular-tolerance" };
    }
  }
  return { ok: true, maximumAngularResidual };
}

export function evaluateInsertionConstellation({
  proposedComponent,
  componentDefinition,
  pattern,
  targetComponentId,
  targetLookup,
  targetByKey,
  occupancy,
  requiredTargets
}) {
  const positionToleranceMm = Math.max(0, Number(pattern.positionToleranceMm ?? DEFAULT_INSERT_DISTANCE_MM));
  const angularToleranceDeg = Math.max(0, Number(pattern.angularToleranceDeg ?? 1));
  const sources = sourceTerminals(proposedComponent, componentDefinition, pattern);
  if (sources.length !== pattern.terminalIds.length) return { ok: false, reasonCode: "incomplete-pattern" };
  const matches = [];
  const usedTargets = new Set();
  for (const source of sources) {
    const sourceBlock = occupancyBlockReason(occupancy, source.endpoint, source.terminal.attachmentCapacity);
    if (sourceBlock) return { ok: false, reasonCode: sourceBlock };
    const requiredTargetKey = requiredTargets.get(endpointKey(source.endpoint));
    let candidates;
    if (requiredTargetKey) {
      const required = targetByKey.get(requiredTargetKey);
      candidates = required ? [{ record: required, distance: distanceBetween(source.worldPosition, required.worldPosition) }] : [];
    } else {
      candidates = targetLookup.query(source.worldPosition, positionToleranceMm);
    }
    if (!candidates.length) return { ok: false, reasonCode: "incomplete-pattern" };
    const nearest = candidates[0];
    const target = nearest.record;
    if (target.component.id !== targetComponentId) return { ok: false, reasonCode: "multiple-target-components" };
    if (nearest.distance > positionToleranceMm + 1e-9) return { ok: false, reasonCode: "excessive-residual" };
    const targetKey = endpointKey(target.endpoint);
    if (usedTargets.has(targetKey)) return { ok: false, reasonCode: "duplicate-target-contact" };
    if (!relativeScalesMatch(componentScale(proposedComponent), componentScale(target.component))) {
      return { ok: false, reasonCode: "relative-scale" };
    }
    if (!terminalsMechanicallyMate(source.terminal, target.terminal)) {
      return { ok: false, reasonCode: "wrong-interface-or-gender" };
    }
    const targetBlock = occupancyBlockReason(occupancy, target.endpoint, target.terminal.attachmentCapacity);
    if (targetBlock) return { ok: false, reasonCode: targetBlock };
    usedTargets.add(targetKey);
    matches.push({ source, target, residualMm: nearest.distance, distance: nearest.distance });
  }
  if (matches.length !== pattern.terminalIds.length) return { ok: false, reasonCode: "incomplete-pattern" };
  const rigidity = rigidityChecks(matches, pattern.rigidity, positionToleranceMm, angularToleranceDeg);
  if (!rigidity.ok) return rigidity;
  const ports = candidatePortChecks(matches, angularToleranceDeg);
  if (!ports.ok) return ports;
  return {
    ok: true,
    matches,
    maximumResidualMm: Math.max(0, ...matches.map((match) => match.residualMm)),
    maximumAngularResidualDeg: Math.max(rigidity.maximumAngularResidual ?? 0, ports.maximumAngularResidual ?? 0)
  };
}

function bestBlockReason(reasons, fallback = "incomplete-pattern") {
  for (const reason of BLOCK_REASON_PRIORITY) {
    if (reasons.has(reason)) return reason;
  }
  return fallback;
}

function blockedOutcome(reasonCode, attempted = true) {
  return {
    state: "blocked",
    attempted,
    mechanicallyResolved: false,
    reasonCode,
    message: MECHANICAL_BLOCK_MESSAGES[reasonCode] ?? "The physical insertion is mechanically impossible.",
    plan: null
  };
}

export function resolveInsertionOutcome(project, componentId, options = {}) {
  const normalized = normalizeProject(project);
  const sourceRecord = componentRecord(normalized, componentId);
  if (!sourceRecord) return blockedOutcome("incomplete-pattern", false);
  const { component, componentDefinition } = sourceRecord;
  const patterns = componentDefinition.insertionPatterns ?? [];
  const removableConnectionIds = options.removableConnectionIds
    ?? directInsertionConnectionsForComponent(normalized, componentId).map((connection) => connection.id);
  if (componentDefinition.custom || component.typeId.startsWith("custom:")) {
    return removableConnectionIds.length ? blockedOutcome("custom-wire-only") : {
      state: "not-applicable",
      attempted: false,
      mechanicallyResolved: false,
      reasonCode: "custom-wire-only",
      message: MECHANICAL_BLOCK_MESSAGES["custom-wire-only"],
      plan: null
    };
  }
  if (!patterns.length) {
    return {
      state: "not-applicable",
      attempted: false,
      mechanicallyResolved: false,
      reasonCode: "no-insertion-pattern",
      message: "This component is wire-connected and has no direct-insertion pattern.",
      plan: null
    };
  }

  const evaluationProject = removeConnectionIds(normalized, removableConnectionIds);
  const allTargets = targetTerminals(evaluationProject, component.id);
  const targetByKey = new Map(allTargets.map((target) => [endpointKey(target.endpoint), target]));
  const requiredTargets = requiredPairMap(options.requiredEndpointPairs);
  const maxDistance = Number.isFinite(Number(options.maxDistance))
    ? Math.max(0, Number(options.maxDistance))
    : DEFAULT_INSERT_DISTANCE_MM;
  const largestTolerance = Math.max(DEFAULT_INSERT_DISTANCE_MM, ...patterns.map((pattern) => Number(pattern.positionToleranceMm) || 0));
  const targetLookup = buildSpatialLookup(allTargets, largestTolerance);
  const occupancy = derivePhysicalOccupancy(evaluationProject);
  const reasons = new Set();
  const candidates = [];
  let attempted = requiredTargets.size > 0;

  for (const pattern of patterns) {
    const sources = sourceTerminals(component, componentDefinition, pattern);
    if (sources.length !== pattern.terminalIds.length) {
      reasons.add("incomplete-pattern");
      continue;
    }
    if (!patternRotationAllowed(component, pattern)) {
      reasons.add("invalid-rotation");
      continue;
    }
    if (!SUPPORTED_RIGIDITY.has(pattern.rigidity)) {
      reasons.add("unsupported-rigidity");
      continue;
    }
    if (requiredTargets.size && sources.some((source) => !requiredTargets.has(endpointKey(source.endpoint)))) {
      reasons.add("incomplete-pattern");
      continue;
    }
    for (const source of sources) {
      const requiredTargetKey = requiredTargets.get(endpointKey(source.endpoint));
      const anchorCandidates = requiredTargetKey
        ? (targetByKey.has(requiredTargetKey) ? [{ record: targetByKey.get(requiredTargetKey), distance: distanceBetween(source.worldPosition, targetByKey.get(requiredTargetKey).worldPosition) }] : [])
        : nearestOnly(targetLookup.query(source.worldPosition, maxDistance));
      if (anchorCandidates.length) attempted = true;
      for (const anchor of anchorCandidates) {
        const target = anchor.record;
        if (!relativeScalesMatch(componentScale(component), componentScale(target.component))) {
          reasons.add("relative-scale");
          continue;
        }
        if (!terminalsMechanicallyMate(source.terminal, target.terminal)) {
          reasons.add("wrong-interface-or-gender");
          continue;
        }
        const sourceBlock = occupancyBlockReason(occupancy, source.endpoint, source.terminal.attachmentCapacity);
        const targetBlock = occupancyBlockReason(occupancy, target.endpoint, target.terminal.attachmentCapacity);
        if (sourceBlock || targetBlock) {
          reasons.add(sourceBlock ?? targetBlock);
          continue;
        }
        const requestedPosition = [
          component.position[0] + target.worldPosition[0] - source.worldPosition[0],
          component.position[1] + target.worldPosition[1] - source.worldPosition[1]
        ];
        const proposedPosition = clampComponentPosition(
          component,
          componentDefinition,
          requestedPosition,
          componentScale(component),
          component.rotation
        );
        if (!samePoint(requestedPosition, proposedPosition, Number(pattern.positionToleranceMm ?? DEFAULT_INSERT_DISTANCE_MM))) {
          reasons.add("clamped-position");
          continue;
        }
        const proposedComponent = { ...component, position: proposedPosition };
        const evaluation = evaluateInsertionConstellation({
          proposedComponent,
          componentDefinition,
          pattern,
          targetComponentId: target.component.id,
          targetLookup,
          targetByKey,
          occupancy,
          requiredTargets
        });
        if (!evaluation.ok) {
          reasons.add(evaluation.reasonCode);
          continue;
        }
        candidates.push({
          componentId: component.id,
          position: proposedPosition,
          matches: evaluation.matches,
          patternId: pattern.id,
          rigidity: pattern.rigidity,
          positionToleranceMm: Number(pattern.positionToleranceMm ?? DEFAULT_INSERT_DISTANCE_MM),
          angularToleranceDeg: Number(pattern.angularToleranceDeg ?? 1),
          maximumResidualMm: evaluation.maximumResidualMm,
          maximumAngularResidualDeg: evaluation.maximumAngularResidualDeg,
          totalMovementMm: distanceBetween(component.position, proposedPosition),
          stableEndpointOrder: stablePairOrder(evaluation.matches),
          removeConnectionIds: [...removableConnectionIds]
        });
      }
    }
  }

  candidates.sort((left, right) => left.maximumResidualMm - right.maximumResidualMm
    || left.totalMovementMm - right.totalMovementMm
    || left.stableEndpointOrder.localeCompare(right.stableEndpointOrder));
  const plan = candidates[0] ?? null;
  if (plan) {
    return {
      state: "resolved",
      attempted: true,
      mechanicallyResolved: true,
      reasonCode: null,
      message: `Resolved ${plan.matches.length} of ${plan.matches.length} physical contacts.`,
      plan
    };
  }
  if (!attempted && !removableConnectionIds.length) {
    return {
      state: "not-applicable",
      attempted: false,
      mechanicallyResolved: false,
      reasonCode: "no-nearby-contact",
      message: MECHANICAL_BLOCK_MESSAGES["no-nearby-contact"],
      plan: null
    };
  }
  return blockedOutcome(bestBlockReason(reasons));
}

export function resolveInsertionPlan(project, componentId, options = {}) {
  return resolveInsertionOutcome(project, componentId, options).plan;
}

export function applyInsertionPlan(project, plan) {
  const normalized = normalizeProject(project);
  if (!plan?.matches?.length) {
    return {
      project: normalized,
      insertedCount: 0,
      detachedCount: 0,
      addedConnectionIds: [],
      removedConnectionIds: [],
      plan: null
    };
  }
  let next = removeConnectionIds(normalized, plan.removeConnectionIds ?? []);
  next = updateComponent(next, plan.componentId, { position: plan.position });
  const addedConnectionIds = [];
  for (const match of plan.matches) {
    const source = terminalRecord(next, match.source.endpoint);
    const target = terminalRecord(next, match.target.endpoint);
    if (!source || !target) throw new Error("Insertion endpoints changed before the transaction could be applied.");
    const requestedId = `insert_${source.endpoint.componentId}_${source.endpoint.terminalId}`;
    next = connectTerminals(next, source.endpoint, target.endpoint, {
      id: requestedId,
      name: insertionName(source.component, source.terminal, target.component, target.terminal),
      color: insertionColor(terminalInsertionRole(source.terminal)),
      kind: "direct-insertion"
    });
    addedConnectionIds.push(next.selectedConnectionId);
  }
  return {
    project: normalizeProject({ ...next, selectedComponentId: plan.componentId, selectedConnectionId: null }),
    insertedCount: plan.matches.length,
    detachedCount: 0,
    addedConnectionIds,
    removedConnectionIds: [...(plan.removeConnectionIds ?? [])],
    plan
  };
}

export function insertComponentIntoNearestTerminals(project, componentId, options = {}) {
  const outcome = resolveInsertionOutcome(project, componentId, options);
  const applied = outcome.plan ? applyInsertionPlan(project, outcome.plan) : {
    project: normalizeProject(project),
    insertedCount: 0,
    detachedCount: 0,
    addedConnectionIds: [],
    removedConnectionIds: [],
    plan: null
  };
  return { ...applied, outcome, mechanicallyResolved: outcome.mechanicallyResolved };
}

export function rematchDirectInsertionConnections(project, componentId) {
  const normalized = normalizeProject(project);
  const existing = directInsertionConnectionsForComponent(normalized, componentId);
  if (!existing.length) {
    return {
      project: normalized,
      hadDirectInsertion: false,
      rematched: true,
      expectedCount: 0,
      insertedCount: 0,
      detachedCount: 0,
      outcome: null
    };
  }
  const outcome = resolveInsertionOutcome(normalized, componentId, {
    removableConnectionIds: existing.map((connection) => connection.id)
  });
  if (!outcome.plan || outcome.plan.matches.length !== existing.length) {
    return {
      project: normalized,
      hadDirectInsertion: true,
      rematched: false,
      expectedCount: existing.length,
      insertedCount: 0,
      detachedCount: 0,
      plan: null,
      outcome
    };
  }
  const applied = applyInsertionPlan(normalized, outcome.plan);
  return {
    ...applied,
    hadDirectInsertion: true,
    rematched: true,
    expectedCount: existing.length,
    outcome
  };
}

export function directInsertionEndpointPairsForComponent(project, componentId) {
  return directInsertionConnectionsForComponent(project, componentId)
    .filter((connection) => connection.endpoints.length === 2)
    .map((connection) => {
      const sourceEndpoint = connection.endpoints.find((endpoint) => endpoint.componentId === componentId);
      const targetEndpoint = connection.endpoints.find((endpoint) => endpoint.componentId !== componentId);
      return sourceEndpoint && targetEndpoint
        ? { connectionId: connection.id, sourceEndpoint, targetEndpoint }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => endpointKey(left.sourceEndpoint).localeCompare(endpointKey(right.sourceEndpoint)));
}

function insertionSourceForConnection(project, connection) {
  const candidates = connection.endpoints.map((endpoint) => {
    const record = terminalRecord(project, endpoint);
    return record && record.componentDefinition.insertionPatterns?.length ? record : null;
  }).filter(Boolean);
  const directional = candidates.filter((candidate) => {
    const targetEndpoint = connection.endpoints.find((endpoint) => endpointKey(endpoint) !== endpointKey(candidate.endpoint));
    const target = targetEndpoint ? terminalRecord(project, targetEndpoint) : null;
    return target && terminalsMechanicallyMate(candidate.terminal, target.terminal);
  });
  return [...(directional.length ? directional : candidates)].sort((left, right) => endpointKey(left.endpoint).localeCompare(endpointKey(right.endpoint)))[0]
    ?? terminalRecord(project, connection.endpoints[0]);
}

export function inspectDirectInsertionState(project) {
  const normalized = normalizeProject(project);
  const groups = new Map();
  for (const connection of normalized.connections.filter((item) => (item.kind ?? "wire") === "direct-insertion")) {
    const source = insertionSourceForConnection(normalized, connection);
    const groupKey = source?.component.id ?? `connection:${connection.id}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { componentId: source?.component.id ?? null, connections: [] });
    groups.get(groupKey).connections.push(connection);
  }
  const states = [];
  for (const group of groups.values()) {
    const connectionIds = group.connections.map((connection) => connection.id).sort();
    const endpointPairs = group.componentId ? directInsertionEndpointPairsForComponent(normalized, group.componentId)
      .filter((pair) => connectionIds.includes(pair.connectionId)) : [];
    let outcome = null;
    let aligned = false;
    if (group.componentId && endpointPairs.length === group.connections.length) {
      outcome = resolveInsertionOutcome(normalized, group.componentId, {
        removableConnectionIds: connectionIds,
        requiredEndpointPairs: endpointPairs,
        maxDistance: DEFAULT_INSERT_DISTANCE_MM
      });
      const component = normalized.components.find((item) => item.id === group.componentId);
      aligned = Boolean(outcome.plan)
        && outcome.plan.matches.length === group.connections.length
        && distanceBetween(component.position, outcome.plan.position) <= EXISTING_ALIGNMENT_TOLERANCE_MM;
    }
    const stale = !aligned;
    const endpoints = group.connections.flatMap((connection) => connection.endpoints);
    states.push({
      componentId: group.componentId,
      connectionIds,
      endpointPairs,
      endpoints,
      status: stale ? "stale" : "valid",
      stale,
      reasonCode: stale ? outcome?.reasonCode ?? "incomplete-pattern" : null,
      message: stale
        ? `Direct insertion ${connectionIds.join(", ")} no longer aligns to a complete mechanical contact pattern.`
        : `Direct insertion ${connectionIds.join(", ")} is mechanically aligned.`
    });
  }
  return states.sort((left, right) => (left.componentId ?? left.connectionIds[0]).localeCompare(right.componentId ?? right.connectionIds[0]));
}

function connectorFamily(record) {
  const connector = record.componentDefinition.engineering?.connectors?.find((item) => item.id === record.terminal.connectorId);
  return connector?.family ?? record.terminal.connectorInterface ?? "unknown";
}

export function manualWireAdapterReview(project, connection) {
  if ((connection?.kind ?? "wire") !== "wire" || connection?.endpoints?.length < 2) return null;
  const records = connection.endpoints.map((endpoint) => terminalRecord(project, endpoint)).filter(Boolean);
  if (records.length < 2) return null;
  const families = [...new Set(records.map(connectorFamily))];
  if (families.length <= 1) return null;
  return {
    connectionId: connection.id,
    endpoints: records.map((record) => record.endpoint),
    families,
    message: `${connection.name} crosses connector families ${families.join(" / ")}; confirm the real adapter or harness.`
  };
}
