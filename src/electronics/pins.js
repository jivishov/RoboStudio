import {
  boardPinById,
  catalog,
  componentPinById,
  gpioNumber,
  isGroundPin,
  isPowerPin
} from "./catalog.js";
import { endpointKey, normalizeCircuitDesign, normalizeEndpoint } from "./schema.js";

export function selectedBoard(design) {
  const normalized = normalizeCircuitDesign(design);
  return catalog.getBoard(normalized.board.id);
}

export function componentInstance(design, instanceId) {
  const normalized = normalizeCircuitDesign(design);
  return normalized.components.find((component) => component.id === instanceId) ?? null;
}

export function componentDefinitionForInstance(design, instanceId) {
  const instance = componentInstance(design, instanceId);
  return instance ? catalog.getComponent(instance.componentId) : null;
}

export function resolvePin(design, endpointInput) {
  const normalized = normalizeCircuitDesign(design);
  const endpoint = normalizeEndpoint(endpointInput);
  if (!endpoint) return { ok: false, error: "Invalid endpoint.", endpoint: null };
  if (endpoint.type === "board") {
    const board = catalog.getBoard(normalized.board.id);
    const pin = boardPinById(board, endpoint.pinId);
    if (!board || !pin) {
      return { ok: false, error: `Unknown board pin: ${endpoint.pinId}`, endpoint };
    }
    return {
      ok: true,
      ownerType: "board",
      ownerId: normalized.board.id,
      pinId: pin.id,
      endpoint: { type: "board", pinId: pin.id },
      endpointKey: `board:${pin.id}`,
      label: `${pin.label ?? pin.id}`,
      definition: pin,
      worldPosition: [
        (normalized.board.position?.[0] ?? 0) + pin.position[0],
        (normalized.board.position?.[1] ?? 0) + pin.position[1],
        (normalized.board.position?.[2] ?? 0) + pin.position[2]
      ]
    };
  }
  const instance = normalized.components.find((component) => component.id === endpoint.instanceId);
  const componentDef = instance ? catalog.getComponent(instance.componentId) : null;
  const pin = componentPinById(componentDef, endpoint.pinId);
  if (!instance || !componentDef || !pin) {
    return { ok: false, error: `Unknown component pin: ${endpoint.instanceId}.${endpoint.pinId}`, endpoint };
  }
  return {
    ok: true,
    ownerType: "component",
    ownerId: instance.id,
    componentId: instance.componentId,
    pinId: pin.id,
    endpoint: { type: "component", instanceId: instance.id, pinId: pin.id },
    endpointKey: `component:${instance.id}:${pin.id}`,
    label: `${instance.name}.${pin.label ?? pin.id}`,
    definition: pin,
    component: instance,
    componentDefinition: componentDef,
    worldPosition: [
      instance.position[0] + pin.position[0],
      instance.position[1] + pin.position[1],
      instance.position[2] + pin.position[2]
    ]
  };
}

export function netForEndpoint(design, endpointInput) {
  const normalized = normalizeCircuitDesign(design);
  const endpoint = normalizeEndpoint(endpointInput);
  const key = endpointKey(endpoint);
  if (!key) return null;
  return normalized.nets.find((net) => net.endpoints.some((item) => endpointKey(item) === key)) ?? null;
}

export function endpointLabel(design, endpointInput) {
  const resolved = resolvePin(design, endpointInput);
  if (resolved.ok) return resolved.label;
  const endpoint = normalizeEndpoint(endpointInput);
  if (endpoint?.type === "board") return endpoint.pinId;
  if (endpoint?.type === "component") return `${endpoint.instanceId}.${endpoint.pinId}`;
  return "Unknown endpoint";
}

function keyForEndpoint(endpoint) {
  if (endpoint.type === "board") return `board:${endpoint.pinId}`;
  return `component:${endpoint.instanceId}:${endpoint.pinId}`;
}

function endpointFromKey(key) {
  const parts = String(key).split(":");
  if (parts[0] === "board") return { type: "board", pinId: parts[1] };
  if (parts[0] === "component") return { type: "component", instanceId: parts[1], pinId: parts[2] };
  return null;
}

function addEdge(graph, left, right, edge) {
  if (!graph.has(left)) graph.set(left, []);
  if (!graph.has(right)) graph.set(right, []);
  graph.get(left).push({ to: right, ...edge });
  graph.get(right).push({ to: left, ...edge });
}

export function buildCircuitGraph(design) {
  const normalized = normalizeCircuitDesign(design);
  const graph = new Map();
  for (const net of normalized.nets) {
    const keys = net.endpoints.map(keyForEndpoint);
    for (const key of keys) {
      if (!graph.has(key)) graph.set(key, []);
    }
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        addEdge(graph, keys[i], keys[j], { type: "net", netId: net.id });
      }
    }
  }
  for (const instance of normalized.components) {
    const componentDef = catalog.getComponent(instance.componentId);
    const bridgePins = componentDef?.sim?.bridgePins;
    if (!Array.isArray(bridgePins) || bridgePins.length < 2) continue;
    for (let i = 0; i < bridgePins.length; i += 1) {
      for (let j = i + 1; j < bridgePins.length; j += 1) {
        addEdge(
          graph,
          keyForEndpoint({ type: "component", instanceId: instance.id, pinId: bridgePins[i] }),
          keyForEndpoint({ type: "component", instanceId: instance.id, pinId: bridgePins[j] }),
          { type: "passive", componentId: instance.id, role: componentDef.sim.role }
        );
      }
    }
  }
  return graph;
}

export function findConnectedBoardPins(design, endpointInput, options = {}) {
  const start = normalizeEndpoint(endpointInput);
  if (!start) return [];
  const graph = buildCircuitGraph(design);
  const startKey = keyForEndpoint(start);
  const queue = [{ key: startKey, path: [] }];
  const visited = new Set([startKey]);
  const matches = [];
  while (queue.length) {
    const current = queue.shift();
    const endpoint = endpointFromKey(current.key);
    if (endpoint?.type === "board") {
      const resolved = resolvePin(design, endpoint);
      if (resolved.ok) matches.push({ ...resolved, path: current.path });
    }
    for (const edge of graph.get(current.key) ?? []) {
      if (visited.has(edge.to)) continue;
      if (edge.type === "passive" && options.allowPassive === false) continue;
      visited.add(edge.to);
      queue.push({ key: edge.to, path: [...current.path, edge] });
    }
  }
  return matches;
}

export function firstUsableGpioForComponentPin(design, instanceId, pinId) {
  return findConnectedBoardPins(design, { type: "component", instanceId, pinId })
    .find((pin) => pin.definition.type === "gpio" && Number.isFinite(gpioNumber(pin.pinId))) ?? null;
}

export function connectedGroundForComponentPin(design, instanceId, pinId) {
  return findConnectedBoardPins(design, { type: "component", instanceId, pinId })
    .find((pin) => isGroundPin(pin.definition)) ?? null;
}

export function connectedPowerForComponentPin(design, instanceId, pinId) {
  return findConnectedBoardPins(design, { type: "component", instanceId, pinId })
    .find((pin) => isPowerPin(pin.definition)) ?? null;
}

export function boardPinsInUse(design) {
  const normalized = normalizeCircuitDesign(design);
  const used = new Set();
  for (const net of normalized.nets) {
    for (const endpoint of net.endpoints) {
      if (endpoint.type === "board") used.add(endpoint.pinId);
    }
  }
  return used;
}

export function componentsBySimRole(design, role) {
  const normalized = normalizeCircuitDesign(design);
  return normalized.components.filter((instance) => catalog.getComponent(instance.componentId)?.sim?.role === role);
}

export function componentResolvedPins(design, instanceId) {
  const componentDef = componentDefinitionForInstance(design, instanceId);
  if (!componentDef) return [];
  return componentDef.pins.map((pin) => resolvePin(design, {
    type: "component",
    instanceId,
    pinId: pin.id
  }));
}
