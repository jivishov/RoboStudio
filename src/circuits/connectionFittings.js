import { resolveTerminal } from "./connectivity.js";
import { normalizeComponentRotation } from "./geometry.js";
import { normalizeProject } from "./model.js";

function endpointKey(endpoint) {
  return `${endpoint.componentId}:${endpoint.terminalId}`;
}

function fittingType(resolved, connection) {
  const iface = resolved?.terminal?.connectorInterface ?? "";
  if ((connection?.kind ?? "wire") === "direct-insertion") {
    if (iface.includes("breadboard")) return "inserted-breadboard-lead";
    if (iface.includes("controller") || iface.includes("header")) return "inserted-header-pin";
    return "inserted-lead";
  }
  if (iface.includes("breadboard")) return "breadboard-wire";
  if (iface.includes("controller") || iface.includes("header")) return "dupont-header";
  if (iface.includes("screw")) return "ferrule";
  if (iface.includes("servo")) return "servo-plug";
  if (iface.includes("jst")) return "jst-plug";
  if (iface.includes("lug") || iface.includes("tab") || iface.includes("solder")) return "solder-pad";
  if (iface.includes("stepper") || iface.includes("pigtail")) return "pigtail";
  return "dupont-header";
}

function physicalPortFor(resolved) {
  return resolved?.componentDefinition?.physicalPorts?.find((port) => port.terminalIds.includes(resolved.terminal.id)) ?? null;
}

function terminalLevelNormal(resolved) {
  const bounds = resolved?.componentDefinition?.bodyBoundsMm;
  const centerX = Number(bounds?.x ?? 0) + Number(bounds?.width ?? 0) / 2;
  const centerY = Number(bounds?.y ?? 0) + Number(bounds?.height ?? 0) / 2;
  const x = Number(resolved?.terminal?.position?.[0] ?? 0) - centerX;
  const y = Number(resolved?.terminal?.position?.[1] ?? 0) - centerY;
  const magnitude = Math.hypot(x, y);
  return magnitude > 0.000001 ? [x / magnitude, y / magnitude] : [1, 0];
}

function transformedNormal(resolved, port) {
  const [localX, localY] = port?.outwardNormalLocal ?? terminalLevelNormal(resolved);
  const radians = normalizeComponentRotation(resolved?.component?.rotation) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [localX * cos - localY * sin, localX * sin + localY * cos];
}

function directInsertionLeadSide(points) {
  return [...points].sort((left, right) => {
    const score = (point) => {
      const iface = point.terminal.connectorInterface ?? "";
      if (point.terminal.anchorKind === "external-lead") return 0;
      if (iface.includes("component-lead") || iface.includes("male-header")) return 1;
      if (point.terminal.anchorKind === "external-port") return 2;
      if (iface.includes("breadboard") || iface.includes("female-controller")) return 4;
      return 3;
    };
    return score(left) - score(right) || endpointKey(left.endpoint).localeCompare(endpointKey(right.endpoint));
  })[0] ?? null;
}

function descriptor(point, connection, extra = {}) {
  const port = physicalPortFor(point);
  const normal = transformedNormal(point, port);
  return {
    connectionId: connection.id,
    endpointKey: endpointKey(point.endpoint),
    endpoint: point.endpoint,
    type: fittingType(point, connection),
    color: connection.color ?? "#f59e0b",
    position: point.worldPosition,
    angle: Math.atan2(normal[1], normal[0]) * 180 / Math.PI,
    outwardNormalWorld: normal,
    portId: port?.id ?? null,
    kind: connection.kind ?? "wire",
    connectorInterface: point.terminal.connectorInterface ?? "",
    terminalKind: point.terminal.kind,
    ...extra
  };
}

export function connectionFittingDescriptors(project) {
  const normalized = normalizeProject(project);
  const descriptors = [];
  for (const connection of normalized.connections) {
    const points = connection.endpoints
      .map((endpoint) => resolveTerminal(normalized, endpoint))
      .filter((resolved) => resolved.ok);
    if (points.length < 2) continue;
    if ((connection.kind ?? "wire") === "direct-insertion") {
      const leadSide = directInsertionLeadSide(points);
      if (leadSide) {
        descriptors.push(descriptor(leadSide, connection, {
          combined: true,
          mateEndpointKeys: points.filter((point) => point.endpointKey !== leadSide.endpointKey).map((point) => point.endpointKey)
        }));
      }
      continue;
    }
    for (const point of points) {
      descriptors.push(descriptor(point, connection));
    }
  }
  return descriptors;
}
