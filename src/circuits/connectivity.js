import { TERMINAL_KINDS, catalog, terminalById } from "./catalog.js";
import { deriveActiveContactBuses } from "./controlModel.js";
import { terminalWorldPosition } from "./geometry.js";
import { endpointKey, normalizeEndpoint, normalizeProject } from "./model.js";

function key(componentId, terminalId) {
  return `${componentId}:${terminalId}`;
}

function endpointFromKey(value) {
  const [componentId, terminalId] = String(value).split(":");
  if (!componentId || !terminalId) return null;
  return { componentId, terminalId };
}

function addEdge(graph, left, right, edge) {
  if (!graph.has(left)) graph.set(left, []);
  if (!graph.has(right)) graph.set(right, []);
  graph.get(left).push({ to: right, ...edge });
  graph.get(right).push({ to: left, ...edge });
}

export function componentById(project, componentId) {
  const normalized = normalizeProject(project);
  return normalized.components.find((component) => component.id === componentId) ?? null;
}

export function componentDefinition(project, componentId) {
  const instance = componentById(project, componentId);
  return instance ? catalog.getComponent(instance.typeId) : null;
}

export function resolveTerminal(project, endpointInput) {
  const normalized = normalizeProject(project);
  const endpoint = normalizeEndpoint(endpointInput);
  if (!endpoint) return { ok: false, error: "Invalid Circuit Lab endpoint.", endpoint: null };
  const instance = normalized.components.find((component) => component.id === endpoint.componentId);
  const definition = instance ? catalog.getComponent(instance.typeId) : null;
  const terminal = terminalById(definition, endpoint.terminalId);
  if (!instance || !definition || !terminal) {
    return {
      ok: false,
      error: `Unknown terminal: ${endpoint.componentId}.${endpoint.terminalId}`,
      endpoint
    };
  }
  return {
    ok: true,
    endpoint: { componentId: instance.id, terminalId: terminal.id },
    endpointKey: key(instance.id, terminal.id),
    component: instance,
    componentDefinition: definition,
    terminal,
    label: `${instance.name}.${terminal.label ?? terminal.id}`,
    worldPosition: terminalWorldPosition(instance, terminal)
  };
}

export function endpointLabel(project, endpointInput) {
  const resolved = resolveTerminal(project, endpointInput);
  if (resolved.ok) return resolved.label;
  const endpoint = normalizeEndpoint(endpointInput);
  return endpoint ? `${endpoint.componentId}.${endpoint.terminalId}` : "Unknown terminal";
}

export function buildCircuitGraph(project, options = {}) {
  const normalized = normalizeProject(project);
  const graph = new Map();
  const includePassive = options.includePassive !== false;
  for (const component of normalized.components) {
    const definition = catalog.getComponent(component.typeId);
    for (const terminal of definition?.terminals ?? []) {
      const terminalKey = key(component.id, terminal.id);
      if (!graph.has(terminalKey)) graph.set(terminalKey, []);
    }
    const dynamicBuses = deriveActiveContactBuses(component, definition, options.sessionState);
    for (const bus of [...(definition?.internalBuses ?? []), ...dynamicBuses]) {
      if (bus.passive && !includePassive) continue;
      const terminals = (bus.terminalIds ?? []).map((terminalId) => key(component.id, terminalId));
      for (let i = 0; i < terminals.length; i += 1) {
        for (let j = i + 1; j < terminals.length; j += 1) {
          addEdge(graph, terminals[i], terminals[j], {
            type: bus.passive ? "passive" : "internal",
            componentId: component.id,
            busId: bus.id,
            resistanceOhm: bus.resistanceOhm ?? null
          });
        }
      }
    }
  }
  for (const connection of normalized.connections) {
    const terminals = connection.endpoints.map((endpoint) => endpointKey(endpoint)).filter(Boolean);
    for (const terminalKey of terminals) {
      if (!graph.has(terminalKey)) graph.set(terminalKey, []);
    }
    for (let i = 0; i < terminals.length; i += 1) {
      for (let j = i + 1; j < terminals.length; j += 1) {
        addEdge(graph, terminals[i], terminals[j], {
          type: "wire",
          connectionId: connection.id
        });
      }
    }
  }
  return graph;
}

export function findConnectedTerminals(project, endpointInput, options = {}) {
  const start = normalizeEndpoint(endpointInput);
  if (!start) return [];
  const graph = buildCircuitGraph(project, {
    includePassive: options.includePassive !== false,
    sessionState: options.sessionState
  });
  const startKey = endpointKey(start);
  const queue = [{ terminalKey: startKey, path: [] }];
  const visited = new Set([startKey]);
  const matches = [];
  while (queue.length) {
    const current = queue.shift();
    const endpoint = endpointFromKey(current.terminalKey);
    if (endpoint) {
      const resolved = resolveTerminal(project, endpoint);
      if (resolved.ok) matches.push({ ...resolved, path: current.path });
    }
    for (const edge of graph.get(current.terminalKey) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push({ terminalKey: edge.to, path: [...current.path, edge] });
    }
  }
  return matches;
}

export function connectedGroups(project, options = {}) {
  const graph = buildCircuitGraph(project, {
    includePassive: options.includePassive !== false,
    sessionState: options.sessionState
  });
  const groups = [];
  const visited = new Set();
  for (const terminalKey of graph.keys()) {
    if (visited.has(terminalKey)) continue;
    const queue = [terminalKey];
    const keys = [];
    visited.add(terminalKey);
    while (queue.length) {
      const current = queue.shift();
      keys.push(current);
      for (const edge of graph.get(current) ?? []) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
    const terminals = keys
      .map((item) => endpointFromKey(item))
      .map((endpoint) => resolveTerminal(project, endpoint))
      .filter((resolved) => resolved.ok);
    groups.push({ keys, terminals });
  }
  return groups;
}

export function terminalsInUse(project) {
  const normalized = normalizeProject(project);
  const used = new Set();
  for (const connection of normalized.connections) {
    for (const endpoint of connection.endpoints) used.add(endpointKey(endpoint));
  }
  return used;
}

export function firstControllerTerminalFor(project, endpointInput, predicate, options = {}) {
  return findConnectedTerminals(project, endpointInput, options)
    .find((resolved) => resolved.componentDefinition.sim.role === "controller" && predicate(resolved.terminal, resolved));
}

export function connectedGround(project, endpointInput, options = {}) {
  return findConnectedTerminals(project, endpointInput, options)
    .find((resolved) => resolved.terminal.kind === TERMINAL_KINDS.GROUND);
}

export function connectedPower(project, endpointInput, options = {}) {
  return findConnectedTerminals(project, endpointInput, options)
    .find((resolved) => resolved.terminal.kind === TERMINAL_KINDS.POWER && Number.isFinite(Number(resolved.terminal.voltage)));
}

export function projectController(project) {
  const normalized = normalizeProject(project);
  const instance = normalized.components.find((component) => component.id === normalized.controllerId)
    ?? normalized.components.find((component) => catalog.getComponent(component.typeId)?.sim.role === "controller")
    ?? null;
  return instance ? { instance, definition: catalog.getComponent(instance.typeId) } : null;
}
