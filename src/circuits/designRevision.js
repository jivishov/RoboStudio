import { normalizeProject } from "./model.js";

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const FNV_MASK_64 = 0xffffffffffffffffn;

function normalizedNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (Object.is(numeric, -0)) return 0;
  return Number(numeric.toFixed(9));
}

function stableJsonValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return normalizedNumber(value);
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return null;
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    const child = stableJsonValue(value[key]);
    if (child !== undefined) normalized[key] = child;
  }
  return normalized;
}

function canonicalEndpoint(endpoint) {
  return {
    componentId: String(endpoint.componentId),
    terminalId: String(endpoint.terminalId)
  };
}

function endpointKey(endpoint) {
  return `${endpoint.componentId}:${endpoint.terminalId}`;
}

export function canonicalCircuitDesignSnapshot(project) {
  const normalized = normalizeProject(project);
  return {
    controllerId: normalized.controllerId ?? null,
    components: normalized.components
      .map((component) => ({
        id: component.id,
        typeId: component.typeId,
        position: component.position.map(normalizedNumber),
        rotation: normalizedNumber(component.rotation),
        props: stableJsonValue(component.props ?? {})
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    connections: normalized.connections
      .map((connection) => ({
        id: connection.id,
        kind: connection.kind ?? "wire",
        endpoints: connection.endpoints
          .map(canonicalEndpoint)
          .sort((left, right) => endpointKey(left).localeCompare(endpointKey(right)))
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function stableCircuitDesignJson(project) {
  return JSON.stringify(canonicalCircuitDesignSnapshot(project));
}

export function fnv1a64Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  let hash = FNV_OFFSET_BASIS_64;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & FNV_MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

export function circuitDesignRevision(project) {
  return `clp1-${fnv1a64Hex(stableCircuitDesignJson(project))}`;
}

export function isCircuitDesignRevision(value) {
  return /^clp1-[0-9a-f]{16}$/.test(String(value ?? ""));
}
