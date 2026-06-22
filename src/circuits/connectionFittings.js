import { resolveTerminal } from "./connectivity.js";
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

function angleBetween(start, end) {
  return Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
}

function nearestOtherPoint(point, points) {
  let best = null;
  for (const candidate of points) {
    if (candidate.endpointKey === point.endpointKey) continue;
    const distance = Math.hypot(
      point.worldPosition[0] - candidate.worldPosition[0],
      point.worldPosition[1] - candidate.worldPosition[1]
    );
    if (!best || distance < best.distance) best = { point: candidate, distance };
  }
  return best?.point ?? null;
}

export function connectionFittingDescriptors(project) {
  const normalized = normalizeProject(project);
  const descriptors = [];
  for (const connection of normalized.connections) {
    const points = connection.endpoints
      .map((endpoint) => resolveTerminal(normalized, endpoint))
      .filter((resolved) => resolved.ok);
    if (points.length < 2) continue;
    for (const point of points) {
      const other = nearestOtherPoint(point, points);
      const angle = other ? angleBetween(point.worldPosition, other.worldPosition) : 0;
      descriptors.push({
        connectionId: connection.id,
        endpointKey: endpointKey(point.endpoint),
        endpoint: point.endpoint,
        type: fittingType(point, connection),
        color: connection.color ?? "#f59e0b",
        position: point.worldPosition,
        angle,
        kind: connection.kind ?? "wire",
        connectorInterface: point.terminal.connectorInterface ?? "",
        terminalKind: point.terminal.kind
      });
    }
  }
  return descriptors;
}
