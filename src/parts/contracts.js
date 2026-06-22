export const PART_PROJECT_VERSION = 1;
export const PART_UNITS = "mm";
export const PART_STUDIO_SOURCE = "part-studio";
export const SKETCH_EXTRUDE_KIND = "sketchExtrude";
export const REVOLVE_KIND = "revolve";
export const SPUR_GEAR_KIND = "spurGear";
export const BOOLEAN_OPERATION_KIND = "booleanOperation";
export const ADVANCED_CAD_RECIPE_KIND = "advancedCadRecipe";
export const ADVANCED_CAD_RECIPE_VERSION = 1;
export const DEFAULT_BODY_COLOR = "#2563eb";
export const DEFAULT_EXTRUDE_DEPTH_MM = 6;
export const ID_MAX_LENGTH = 56;
export const PART_BODY_SOURCE_KINDS = Object.freeze([
  SKETCH_EXTRUDE_KIND,
  REVOLVE_KIND,
  SPUR_GEAR_KIND,
  BOOLEAN_OPERATION_KIND,
  ADVANCED_CAD_RECIPE_KIND
]);

export function timestampNow() {
  return new Date().toISOString();
}

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function sanitizePartId(value, fallback = "body") {
  const base = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, ID_MAX_LENGTH);

  return base || fallback;
}

export function uniquePartId(value, existingIds = new Set(), fallback = "body") {
  const cleanBase = sanitizePartId(value, fallback);
  let id = cleanBase;
  let index = 2;

  while (existingIds.has(id)) {
    const suffix = `_${index}`;
    id = `${cleanBase.slice(0, ID_MAX_LENGTH - suffix.length)}${suffix}`;
    index += 1;
  }

  return id;
}

export function asFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function asPositiveNumber(value, fallback = 1, minimum = Number.EPSILON) {
  const number = Number(value);
  return Number.isFinite(number) && number > minimum ? number : fallback;
}

export function normalizeVector(value, fallback, length = fallback.length) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_item, index) => asFiniteNumber(source[index], fallback[index] ?? 0));
}

export function createDefaultTransform(overrides = {}) {
  return {
    position: normalizeVector(overrides.position, [0, 0, 0]),
    quaternion: normalizeVector(overrides.quaternion, [0, 0, 0, 1]),
    scale: normalizeVector(overrides.scale, [1, 1, 1]).map((value) => (value > 0 ? value : 1))
  };
}

export function createPartProject(options = {}) {
  return {
    version: PART_PROJECT_VERSION,
    units: PART_UNITS,
    bodies: cloneJson(options.bodies ?? []),
    selectedBodyId: options.selectedBodyId ?? null,
    updatedAt: options.updatedAt ?? timestampNow()
  };
}

export function createSketchExtrudeBody(options = {}, existingIds = new Set()) {
  const id = uniquePartId(options.id ?? options.name ?? "body", existingIds, "body");
  return {
    id,
    name: String(options.name ?? id).trim() || id,
    color: options.color ?? DEFAULT_BODY_COLOR,
    transform: createDefaultTransform(options.transform),
    source: { kind: SKETCH_EXTRUDE_KIND },
    sketch: {
      outerProfile: cloneJson(options.sketch?.outerProfile ?? null),
      cutProfiles: cloneJson(options.sketch?.cutProfiles ?? [])
    },
    extrudeDepthMm: asPositiveNumber(options.extrudeDepthMm, DEFAULT_EXTRUDE_DEPTH_MM)
  };
}

export function normalizeBodySource(source = {}) {
  const kind = typeof source.kind === "string" && source.kind ? source.kind : SKETCH_EXTRUDE_KIND;
  return { kind };
}

export function createGeneratedBodyMetadata(body) {
  const id = sanitizePartId(body?.id, "body");
  return {
    id,
    label: String(body?.name ?? body?.label ?? id),
    type: "generated",
    file: null,
    source: PART_STUDIO_SOURCE
  };
}
