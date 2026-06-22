import { TERMINAL_KINDS, catalog } from "./catalog.js";
import { clampComponentPosition, componentScale, terminalWorldPosition } from "./geometry.js";
import { connectTerminals, endpointKey, normalizeProject, updateComponent } from "./model.js";
import { assertEndpointsHaveCapacity, directInsertionConnectionsForComponent, removeDirectInsertionConnectionsForComponent } from "./occupancy.js";
import { directConnectorInterfacesCompatible, relativeScalesMatch } from "./physicalCatalog.js";

const DEFAULT_INSERT_DISTANCE_MM = 1.27;
const POSITIVE_NAMES = new Set(["pos", "positive", "plus", "anode", "vplus", "vcc", "vdd", "vin", "5v", "3v3", "33v", "vmotor", "vmot"]);
const NEGATIVE_NAMES = new Set(["neg", "negative", "minus", "cathode", "gnd", "ground", "return", "common", "com"]);

function terminalToken(terminal) {
  return `${terminal?.id ?? ""} ${terminal?.label ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function endpointPairKey(left, right) {
  return [endpointKey(left), endpointKey(right)].sort().join("|");
}

function samePoint(left, right) {
  return Math.abs(left[0] - right[0]) < 0.0001 && Math.abs(left[1] - right[1]) < 0.0001;
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
  const token = terminalToken(terminal);
  if (terminal.kind === TERMINAL_KINDS.POWER) return "positive";
  if (terminal.kind === TERMINAL_KINDS.GROUND) return "negative";
  if ([...POSITIVE_NAMES].some((name) => token === name || token.includes(name))) return "positive";
  if ([...NEGATIVE_NAMES].some((name) => token === name || token.includes(name))) return "negative";
  if (terminal.kind === TERMINAL_KINDS.SIGNAL) return "signal";
  if (terminal.kind === TERMINAL_KINDS.LOAD) return "load";
  return "passive";
}

export function terminalsCanInsert(sourceTerminal, targetTerminal) {
  if (!directConnectorInterfacesCompatible(sourceTerminal?.connectorInterface, targetTerminal?.connectorInterface)) return false;
  const sourceRole = terminalInsertionRole(sourceTerminal);
  const targetRole = terminalInsertionRole(targetTerminal);
  if (sourceRole === "positive" && targetRole === "negative") return false;
  if (sourceRole === "negative" && targetRole === "positive") return false;
  if (sourceRole === "signal" && targetRole === "load") return false;
  if (sourceRole === "load" && targetRole === "signal") return false;
  return true;
}

function targetTerminals(project, sourceComponentId) {
  const targets = [];
  for (const component of project.components) {
    if (component.id === sourceComponentId) continue;
    const componentDefinition = catalog.getComponent(component.typeId);
    if (!componentDefinition) continue;
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

function sourceTerminals(component, componentDefinition) {
  return componentDefinition.terminals.map((terminal) => ({
    component,
    componentDefinition,
    terminal,
    endpoint: { componentId: component.id, terminalId: terminal.id },
    worldPosition: terminalWorldPosition(component, terminal)
  }));
}

function shouldResolveInsertion(componentDefinition, options = {}) {
  if (options.allowAllComponents) return true;
  return Boolean(componentDefinition?.insertionPatterns?.length);
}

function nearestPatternMatches(proposedComponent, componentDefinition, pattern, targets) {
  const usedTargets = new Set();
  const matches = [];
  const maxDistance = Number(pattern.positionToleranceMm ?? DEFAULT_INSERT_DISTANCE_MM);
  const sources = sourceTerminals(proposedComponent, componentDefinition)
    .filter((source) => pattern.terminalIds.includes(source.terminal.id));
  for (const source of sources) {
    let best = null;
    for (const target of targets) {
      const targetKey = endpointKey(target.endpoint);
      if (usedTargets.has(targetKey)) continue;
      if (!terminalsCanInsert(source.terminal, target.terminal)) continue;
      const distance = Math.hypot(
        source.worldPosition[0] - target.worldPosition[0],
        source.worldPosition[1] - target.worldPosition[1]
      );
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { source, target, distance };
      }
    }
    if (best) {
      usedTargets.add(endpointKey(best.target.endpoint));
      matches.push(best);
    }
  }
  return matches;
}

function matchesUseOneTargetComponent(matches) {
  const targetComponentIds = new Set(matches.map((match) => match.target.endpoint.componentId));
  return targetComponentIds.size <= 1;
}

function scoreMatches(matches, componentDefinition) {
  const distance = matches.reduce((total, match) => total + match.distance, 0);
  const roleScore = matches.reduce((total, match) => {
    const sourceRole = terminalInsertionRole(match.source.terminal);
    const targetRole = terminalInsertionRole(match.target.terminal);
    const exactRole = sourceRole !== "passive" && sourceRole === targetRole ? 8 : 0;
    const breadboardBonus = match.target.componentDefinition.sim.role === "breadboard" ? 3 : 0;
    return total + exactRole + breadboardBonus;
  }, 0);
  return matches.length * 1000 + roleScore * 10 - distance - componentDefinition.terminals.length;
}

function defaultInsertionPatterns(componentDefinition) {
  if (componentDefinition.insertionPatterns?.length) return componentDefinition.insertionPatterns;
  const terminalIds = componentDefinition.terminals.map((terminal) => terminal.id);
  return terminalIds.length
    ? [{
        id: `${componentDefinition.id}-complete-pattern`,
        terminalIds,
        rigidity: terminalIds.length > 2 ? "rigid" : "fixed-lead-span",
        allowedRotationsDeg: [0, 90, 180, 270],
        positionToleranceMm: DEFAULT_INSERT_DISTANCE_MM,
        angularToleranceDeg: 1
      }]
    : [];
}

function rotationAllowed(component, pattern) {
  const allowed = pattern.allowedRotationsDeg ?? [0, 90, 180, 270];
  const rotation = ((Math.round(Number(component.rotation) || 0) % 360) + 360) % 360;
  return allowed.includes(rotation);
}

function targetsWithCapacity(project, targets, sourceEndpoints) {
  return targets.filter((target) => {
    try {
      assertEndpointsHaveCapacity(project, [sourceEndpoints[0], target.endpoint], { kind: "direct-insertion", nextConnectionId: "__insertion_probe__" });
      return true;
    } catch {
      return false;
    }
  });
}

export function resolveInsertionPlan(project, componentId, options = {}) {
  const normalized = normalizeProject(project);
  const component = normalized.components.find((item) => item.id === componentId);
  const componentDefinition = component ? catalog.getComponent(component.typeId) : null;
  if (!component || !componentDefinition || componentDefinition.terminals.length < 1) return null;
  if (!shouldResolveInsertion(componentDefinition, options)) return null;

  const allTargets = targetTerminals(normalized, component.id);
  const patterns = defaultInsertionPatterns(componentDefinition);
  const sourceScale = componentScale(component);
  const targets = allTargets.filter((target) => relativeScalesMatch(sourceScale, componentScale(target.component)));
  if (!targets.length) return null;

  const maxDistance = Number.isFinite(Number(options.maxDistance))
    ? Math.min(DEFAULT_INSERT_DISTANCE_MM, Math.max(0, Number(options.maxDistance)))
    : DEFAULT_INSERT_DISTANCE_MM;
  let bestPlan = null;

  for (const pattern of patterns) {
    if (!rotationAllowed(component, pattern)) continue;
    const patternSources = sourceTerminals(component, componentDefinition)
      .filter((source) => pattern.terminalIds.includes(source.terminal.id));
    if (patternSources.length !== pattern.terminalIds.length) continue;
    for (const source of patternSources) {
      for (const target of targetsWithCapacity(normalized, targets, [source.endpoint])) {
        if (!terminalsCanInsert(source.terminal, target.terminal)) continue;
        const anchorDistance = Math.hypot(
          source.worldPosition[0] - target.worldPosition[0],
          source.worldPosition[1] - target.worldPosition[1]
        );
        if (anchorDistance > maxDistance) continue;
        const offset = [
          target.worldPosition[0] - source.worldPosition[0],
          target.worldPosition[1] - source.worldPosition[1]
        ];
        const requestedPosition = [
          component.position[0] + offset[0],
          component.position[1] + offset[1]
        ];
        const proposedPosition = clampComponentPosition(component, componentDefinition, requestedPosition, componentScale(component), component.rotation);
        const proposedComponent = { ...component, position: proposedPosition };
        if (!samePoint(requestedPosition, proposedPosition) && Math.hypot(requestedPosition[0] - proposedPosition[0], requestedPosition[1] - proposedPosition[1]) > maxDistance) {
          continue;
        }
        const matches = nearestPatternMatches(proposedComponent, componentDefinition, pattern, targets);
        if (matches.length !== pattern.terminalIds.length) continue;
        if (!matchesUseOneTargetComponent(matches)) continue;
        try {
          for (const match of matches) {
            assertEndpointsHaveCapacity(normalized, [match.source.endpoint, match.target.endpoint], { kind: "direct-insertion", nextConnectionId: `insert_${component.id}_${match.source.terminal.id}` });
          }
        } catch {
          continue;
        }
        const score = scoreMatches(matches, componentDefinition) - anchorDistance;
        if (!bestPlan || score > bestPlan.score) {
          bestPlan = {
            componentId: component.id,
            position: proposedPosition,
            matches,
            patternId: pattern.id,
            snapDistance: anchorDistance,
            score
          };
        }
      }
    }
  }

  return bestPlan;
}

function pruneMatchedSourceConnections(project, matches, componentId) {
  const matchedSourceKeys = new Set(matches.map((match) => endpointKey(match.source.endpoint)));
  const connections = project.connections
    .map((connection) => {
      if (!connection.endpoints.some((endpoint) => matchedSourceKeys.has(endpointKey(endpoint)))) return connection;
      const endpoints = connection.endpoints.filter((endpoint) => !matchedSourceKeys.has(endpointKey(endpoint)));
      return endpoints.length > 1 ? { ...connection, endpoints } : null;
    })
    .filter(Boolean);
  return normalizeProject({
    ...project,
    connections,
    selectedComponentId: componentId,
    selectedConnectionId: null
  });
}

export function applyInsertionPlan(project, plan, options = {}) {
  if (!plan?.matches?.length) {
    const normalized = normalizeProject(project);
    const componentId = plan?.componentId ?? options.componentId;
    const detachedCount = componentId
      ? normalized.connections.filter((connection) => (connection.kind ?? "wire") === "direct-insertion" && connection.endpoints.some((endpoint) => endpoint.componentId === componentId)).length
      : 0;
    return {
      project: normalizeProject(componentId ? removeDirectInsertionConnectionsForComponent(normalized, componentId) : normalized),
      insertedCount: 0,
      detachedCount,
      plan: null
    };
  }
  let next = updateComponent(project, plan.componentId, { position: plan.position });
  next = pruneMatchedSourceConnections(next, plan.matches, plan.componentId);
  const existingPairs = new Set(
    next.connections.flatMap((connection) => {
      const pairs = [];
      for (let index = 1; index < connection.endpoints.length; index += 1) {
        pairs.push(endpointPairKey(connection.endpoints[0], connection.endpoints[index]));
      }
      return pairs;
    })
  );
  let insertedCount = 0;
  for (const match of plan.matches) {
    const pairKey = endpointPairKey(match.source.endpoint, match.target.endpoint);
    if (existingPairs.has(pairKey)) continue;
    const role = terminalInsertionRole(match.source.terminal);
    next = connectTerminals(next, match.source.endpoint, match.target.endpoint, {
      id: `insert_${match.source.endpoint.componentId}_${match.source.endpoint.terminalId}`,
      name: insertionName(match.source.component, match.source.terminal, match.target.component, match.target.terminal),
      color: insertionColor(role),
      kind: "direct-insertion"
    });
    existingPairs.add(pairKey);
    insertedCount += 1;
  }
  return {
    project: normalizeProject({ ...next, selectedComponentId: plan.componentId, selectedConnectionId: null }),
    insertedCount,
    plan
  };
}

export function insertComponentIntoNearestTerminals(project, componentId, options = {}) {
  const plan = resolveInsertionPlan(project, componentId, options);
  return applyInsertionPlan(project, plan, { componentId });
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
      detachedCount: 0
    };
  }

  const detached = normalizeProject(removeDirectInsertionConnectionsForComponent(normalized, componentId));
  const insertion = insertComponentIntoNearestTerminals(detached, componentId);
  const rematched = insertion.insertedCount === existing.length;
  return {
    project: rematched ? insertion.project : detached,
    hadDirectInsertion: true,
    rematched,
    expectedCount: existing.length,
    insertedCount: rematched ? insertion.insertedCount : 0,
    detachedCount: rematched ? 0 : existing.length,
    plan: rematched ? insertion.plan : null
  };
}
