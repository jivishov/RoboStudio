import jscad from "@jscad/modeling";
import {
  BOOLEAN_OPERATION_KIND,
  DEFAULT_BODY_COLOR,
  REVOLVE_KIND,
  asFiniteNumber,
  asPositiveNumber,
  cloneJson,
  createDefaultTransform,
  sanitizePartId,
  uniquePartId
} from "./contracts.js";
import { normalizeProfile } from "./sketch.js";

const { booleans, extrusions, primitives, transforms } = jscad;
const { intersect, subtract, union } = booleans;
const { extrudeRotate } = extrusions;
const { polygon } = primitives;
const { transform } = transforms;

const TAU = Math.PI * 2;
const MIN_REVOLVE_SEGMENTS = 16;
const REVOLVE_ORIENTATION_MATRIX = [
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
];

export const BOOLEAN_OPERATIONS = Object.freeze(["union", "subtract", "intersect"]);

const REVOLVE_PRESET_DATA = Object.freeze({
  shaft: {
    label: "Shaft",
    color: "#64748b",
    points: [
      [0, -35],
      [4, -35],
      [4, 35],
      [0, 35]
    ]
  },
  pulley: {
    label: "Pulley",
    color: "#0f9f6e",
    points: [
      [3, -12],
      [14, -12],
      [16, -8],
      [12, 0],
      [16, 8],
      [14, 12],
      [3, 12]
    ]
  },
  bushing: {
    label: "Bushing",
    color: "#0891b2",
    points: [
      [3, -16],
      [9, -16],
      [11, -12],
      [11, 12],
      [9, 16],
      [3, 16]
    ]
  },
  wheel: {
    label: "Wheel",
    color: "#7c3aed",
    points: [
      [3, -10],
      [18, -10],
      [21, -7],
      [21, 7],
      [18, 10],
      [3, 10]
    ]
  },
  collar: {
    label: "Collar",
    color: "#b45309",
    points: [
      [4, -8],
      [13, -8],
      [13, 8],
      [4, 8]
    ]
  },
  knob: {
    label: "Knob",
    color: "#c026d3",
    points: [
      [0, -10],
      [9, -10],
      [17, -4],
      [17, 4],
      [9, 10],
      [0, 10]
    ]
  },
  spacer: {
    label: "Spacer",
    color: "#475569",
    points: [
      [3.2, -12],
      [11, -12],
      [11, 12],
      [3.2, 12]
    ]
  }
});

function issue(code, message, path, severity = "error") {
  return { code, message, path, severity };
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function positive(value) {
  return finite(value) && Number(value) > 0;
}

function normalizedProfileCopy(profile, index, existingIds, idPrefix) {
  const fallbackId = `${idPrefix}_${index + 1}`;
  return normalizeProfile(
    {
      ...cloneJson(profile),
      id: uniquePartId(profile?.id ?? fallbackId, existingIds, fallbackId)
    },
    { fallbackId, fallbackType: profile?.type ?? "circle", existingIds }
  );
}

function moveProfileTo(profile, x, z) {
  const copy = cloneJson(profile);
  if (copy.type === "polyline") {
    const points = copy.points ?? [];
    const xs = points.map((point) => Number(point[0])).filter(Number.isFinite);
    const zs = points.map((point) => Number(point[1])).filter(Number.isFinite);
    const centerX = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const centerZ = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
    const dx = x - centerX;
    const dz = z - centerZ;
    copy.points = points.map((point) => [asFiniteNumber(point[0], 0) + dx, asFiniteNumber(point[1], 0) + dz]);
    return copy;
  }

  copy.x = x;
  copy.z = z;
  return copy;
}

export function createLinearPatternProfiles(profile, options = {}) {
  const count = Math.max(1, Math.floor(asPositiveNumber(options.count, 4, 0)));
  const spacingX = asFiniteNumber(options.spacingX, 12);
  const spacingZ = asFiniteNumber(options.spacingZ, 0);
  const originX = asFiniteNumber(options.originX, profile?.x ?? 0);
  const originZ = asFiniteNumber(options.originZ, profile?.z ?? 0);
  const idPrefix = sanitizePartId(options.idPrefix ?? profile?.id ?? "pattern", "pattern");
  const existingIds = new Set(options.existingIds ?? []);
  const offset = (count - 1) / 2;
  const profiles = [];

  for (let index = 0; index < count; index += 1) {
    const x = originX + (index - offset) * spacingX;
    const z = originZ + (index - offset) * spacingZ;
    const patterned = moveProfileTo(profile, x, z);
    patterned.id = uniquePartId(`${idPrefix}_${index + 1}`, existingIds, idPrefix);
    const normalized = normalizedProfileCopy(patterned, index, existingIds, idPrefix);
    existingIds.add(normalized.id);
    profiles.push(normalized);
  }

  return profiles;
}

export function createCircularPatternProfiles(profile, options = {}) {
  const count = Math.max(1, Math.floor(asPositiveNumber(options.count, 6, 0)));
  const radius = asPositiveNumber(options.radius, 24);
  const centerX = asFiniteNumber(options.centerX, 0);
  const centerZ = asFiniteNumber(options.centerZ, 0);
  const startAngleDeg = asFiniteNumber(options.startAngleDeg, 0);
  const idPrefix = sanitizePartId(options.idPrefix ?? profile?.id ?? "bolt", "bolt");
  const existingIds = new Set(options.existingIds ?? []);
  const profiles = [];

  for (let index = 0; index < count; index += 1) {
    const angle = ((startAngleDeg + (360 * index) / count) * Math.PI) / 180;
    const patterned = moveProfileTo(
      profile,
      centerX + Math.cos(angle) * radius,
      centerZ + Math.sin(angle) * radius
    );
    patterned.id = uniquePartId(`${idPrefix}_${index + 1}`, existingIds, idPrefix);
    const normalized = normalizedProfileCopy(patterned, index, existingIds, idPrefix);
    existingIds.add(normalized.id);
    profiles.push(normalized);
  }

  return profiles;
}

export function normalizeBooleanOperation(value) {
  return BOOLEAN_OPERATIONS.includes(value) ? value : "union";
}

export function normalizeBooleanFeature(value = {}) {
  const operandBodyIds = Array.isArray(value.operandBodyIds)
    ? value.operandBodyIds.map((id) => sanitizePartId(id, "body")).filter(Boolean)
    : [];

  return {
    operation: normalizeBooleanOperation(value.operation),
    operandBodyIds: [...new Set(operandBodyIds)].slice(0, 8)
  };
}

export function createBooleanOperationBody(operation, operandBodies, options = {}, existingIds = new Set()) {
  const operandBodyIds = operandBodies.map((body) => body?.id).filter(Boolean);
  const normalizedOperation = normalizeBooleanOperation(operation);
  const id = uniquePartId(options.id ?? `${normalizedOperation}_body`, existingIds, "boolean_body");

  return {
    id,
    name: String(options.name ?? `${normalizedOperation} result`),
    color: options.color ?? DEFAULT_BODY_COLOR,
    transform: createDefaultTransform(options.transform),
    source: { kind: BOOLEAN_OPERATION_KIND },
    sketch: { outerProfile: null, cutProfiles: [] },
    extrudeDepthMm: 1,
    boolean: {
      operation: normalizedOperation,
      operandBodyIds
    }
  };
}

export function validateBooleanFeature(feature, path = "boolean", bodyIds = null, currentBodyId = null) {
  const issues = [];
  if (!BOOLEAN_OPERATIONS.includes(feature?.operation)) {
    issues.push(issue("invalid-boolean-operation", "Boolean operation must be union, subtract, or intersect.", `${path}.operation`));
  }

  const ids = Array.isArray(feature?.operandBodyIds) ? feature.operandBodyIds : [];
  if (ids.length < 2) {
    issues.push(issue("invalid-boolean-operands", "Boolean operations need at least two operand bodies.", `${path}.operandBodyIds`));
  }

  for (const [index, id] of ids.entries()) {
    if (!id || sanitizePartId(id, "body") !== id) {
      issues.push(issue("invalid-boolean-operand", "Boolean operand IDs must be stable body IDs.", `${path}.operandBodyIds.${index}`));
    }
    if (currentBodyId && id === currentBodyId) {
      issues.push(issue("boolean-self-reference", "Boolean operations cannot reference their own result body.", `${path}.operandBodyIds.${index}`));
    }
    if (bodyIds && !bodyIds.has(id)) {
      issues.push(issue("missing-boolean-operand", `Boolean operand body does not exist: ${id}.`, `${path}.operandBodyIds.${index}`));
    }
  }

  return issues;
}

export function applyBooleanOperation(operation, solids) {
  const [first, ...rest] = solids;
  if (!first || rest.length === 0) {
    throw new Error("Boolean operation needs at least two compiled solids.");
  }
  if (operation === "subtract") return subtract(first, ...rest);
  if (operation === "intersect") return intersect(first, ...rest);
  return union(first, ...rest);
}

export function listRevolvePresets() {
  return Object.entries(REVOLVE_PRESET_DATA).map(([id, preset]) => ({
    id,
    label: preset.label
  }));
}

export function normalizeRevolveFeature(value = {}) {
  const presetId = REVOLVE_PRESET_DATA[value.presetId] ? value.presetId : "spacer";
  const preset = REVOLVE_PRESET_DATA[presetId];
  const sourcePoints = Array.isArray(value.profilePoints) && value.profilePoints.length
    ? value.profilePoints
    : preset.points;

  return {
    presetId,
    profilePoints: sourcePoints.map((point) => [
      Math.max(0, asFiniteNumber(point?.[0], 0)),
      asFiniteNumber(point?.[1], 0)
    ]),
    segments: Math.max(MIN_REVOLVE_SEGMENTS, Math.floor(asPositiveNumber(value.segments, 64, 3)))
  };
}

export function revolveLengthMm(revolve) {
  const ys = (revolve?.profilePoints ?? []).map((point) => Number(point[1])).filter(Number.isFinite);
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 1;
}

export function createRevolveBodyFromPreset(presetId, options = {}, existingIds = new Set()) {
  const preset = REVOLVE_PRESET_DATA[presetId] ?? REVOLVE_PRESET_DATA.spacer;
  const id = uniquePartId(options.id ?? preset.label, existingIds, "revolve_body");
  const revolve = normalizeRevolveFeature({
    presetId: REVOLVE_PRESET_DATA[presetId] ? presetId : "spacer",
    profilePoints: options.profilePoints ?? preset.points,
    segments: options.segments
  });

  return {
    id,
    name: String(options.name ?? preset.label),
    color: options.color ?? preset.color ?? DEFAULT_BODY_COLOR,
    transform: createDefaultTransform(options.transform),
    source: { kind: REVOLVE_KIND },
    sketch: { outerProfile: null, cutProfiles: [] },
    extrudeDepthMm: revolveLengthMm(revolve),
    revolve
  };
}

export function validateRevolveFeature(revolve, path = "revolve") {
  const issues = [];
  const points = Array.isArray(revolve?.profilePoints) ? revolve.profilePoints : [];
  if (points.length < 3) {
    issues.push(issue("invalid-revolve-profile", "Revolve profiles need at least three radius/axis points.", `${path}.profilePoints`));
  }

  let hasPositiveRadius = false;
  for (const [index, point] of points.entries()) {
    if (!finite(point?.[0]) || Number(point[0]) < 0 || !finite(point?.[1])) {
      issues.push(issue("invalid-revolve-profile", "Revolve profile points need finite non-negative radius and finite axis values.", `${path}.profilePoints.${index}`));
    }
    if (Number(point?.[0]) > 0) hasPositiveRadius = true;
  }
  if (!hasPositiveRadius) {
    issues.push(issue("invalid-revolve-profile", "Revolve profiles need at least one positive radius point.", `${path}.profilePoints`));
  }
  if (!positive(revolve?.segments) || Number(revolve.segments) < MIN_REVOLVE_SEGMENTS) {
    issues.push(issue("invalid-revolve-segments", `Revolve segments must be at least ${MIN_REVOLVE_SEGMENTS}.`, `${path}.segments`));
  }

  return issues;
}

export function compileRevolveBodyToSolid(body) {
  const revolve = normalizeRevolveFeature(body.revolve);
  const profile2d = polygon({ points: revolve.profilePoints });
  return transform(
    REVOLVE_ORIENTATION_MATRIX,
    extrudeRotate({ segments: revolve.segments, angle: TAU }, profile2d)
  );
}
