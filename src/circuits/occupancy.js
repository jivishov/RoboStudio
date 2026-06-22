import { catalog, terminalById } from "./catalog.js";

function endpointKey(endpoint) {
  return `${endpoint.componentId}:${endpoint.terminalId}`;
}

function resolveEndpoint(project, endpoint) {
  const component = project.components?.find((item) => item.id === endpoint?.componentId);
  const definition = component ? catalog.getComponent(component.typeId) : null;
  const terminal = terminalById(definition, endpoint?.terminalId);
  if (!component || !definition || !terminal) return null;
  return { component, definition, terminal, endpoint: { componentId: component.id, terminalId: terminal.id }, endpointKey: `${component.id}:${terminal.id}` };
}

export function derivePhysicalOccupancy(project) {
  const occupancyByEndpoint = new Map();
  const conflicts = [];
  for (const connection of project?.connections ?? []) {
    for (const endpointInput of connection.endpoints ?? []) {
      const resolved = resolveEndpoint(project, endpointInput);
      if (!resolved) continue;
      const record = {
        connectionId: connection.id,
        kind: connection.kind ?? "wire",
        endpoint: resolved.endpoint,
        componentId: resolved.component.id,
        terminalId: resolved.terminal.id
      };
      if (!occupancyByEndpoint.has(resolved.endpointKey)) occupancyByEndpoint.set(resolved.endpointKey, []);
      occupancyByEndpoint.get(resolved.endpointKey).push(record);
    }
  }
  for (const [key, records] of occupancyByEndpoint) {
    const resolved = resolveEndpoint(project, records[0].endpoint);
    const capacity = resolved?.terminal?.attachmentCapacity ?? 1;
    if (records.length > capacity) {
      conflicts.push({
        endpointKey: key,
        endpoint: resolved.endpoint,
        capacity,
        attachments: records
      });
    }
  }
  return { occupancyByEndpoint, conflicts };
}

export function assertEndpointsHaveCapacity(project, endpoints, options = {}) {
  const nextConnectionId = options.nextConnectionId ?? "__new_connection__";
  const nextKind = options.kind ?? "wire";
  const simulated = {
    ...project,
    connections: [
      ...(project?.connections ?? []),
      {
        id: nextConnectionId,
        kind: nextKind,
        endpoints
      }
    ]
  };
  const occupancy = derivePhysicalOccupancy(simulated);
  const endpointKeys = new Set(endpoints.map(endpointKey));
  const conflict = occupancy.conflicts.find((item) => endpointKeys.has(item.endpointKey));
  if (conflict) {
    throw new Error(`Terminal ${conflict.endpoint.componentId}.${conflict.endpoint.terminalId} already has its physical attachment capacity filled.`);
  }
  return true;
}

export function directInsertionConnectionsForComponent(project, componentId) {
  return (project?.connections ?? []).filter((connection) => (
    (connection.kind ?? "wire") === "direct-insertion"
    && connection.endpoints.some((endpoint) => endpoint.componentId === componentId)
  ));
}

export function removeDirectInsertionConnectionsForComponent(project, componentId) {
  const connections = (project?.connections ?? []).filter((connection) => !(
    (connection.kind ?? "wire") === "direct-insertion"
    && connection.endpoints.some((endpoint) => endpoint.componentId === componentId)
  ));
  return { ...project, connections };
}
