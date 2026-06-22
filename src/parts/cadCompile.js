import jscad from "@jscad/modeling";
import { ADVANCED_CAD_RECIPE_KIND, BOOLEAN_OPERATION_KIND, REVOLVE_KIND, SKETCH_EXTRUDE_KIND, SPUR_GEAR_KIND } from "./contracts.js";
import { compileAdvancedCadRecipeToSolid } from "./advancedCadRecipe.js";
import { applyBooleanOperation, compileRevolveBodyToSolid } from "./featureOps.js";
import { compileSpurGearBodyToSolid } from "./gears.js";
import { validateBody } from "./validation.js";

const { booleans, extrusions, primitives, transforms } = jscad;
const { circle, polygon, rectangle, roundedRectangle } = primitives;
const { subtract } = booleans;
const { extrudeLinear } = extrusions;
const { transform } = transforms;

const CURVE_SEGMENTS = 48;
const MIN_ROUNDING_CLEARANCE = 0.001;

export class PartCadCompileError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "PartCadCompileError";
    this.bodyId = options.bodyId ?? null;
    this.issues = options.issues ?? [];
    this.cause = options.cause;
  }
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function polylinePoints(profile) {
  const points = (profile.points ?? []).map((point) => [Number(point[0]), Number(point[1])]);
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return points;
}

function rectangleGeometry(profile) {
  const width = Number(profile.width);
  const height = Number(profile.height);
  const cornerRadius = Math.max(0, Number(profile.cornerRadius ?? 0));
  const maxRadius = Math.max(0, Math.min(width, height) / 2 - MIN_ROUNDING_CLEARANCE);

  if (cornerRadius <= 0 || maxRadius <= 0) {
    return rectangle({ center: [Number(profile.x), Number(profile.z)], size: [width, height] });
  }

  return roundedRectangle({
    center: [Number(profile.x), Number(profile.z)],
    size: [width, height],
    roundRadius: Math.min(cornerRadius, maxRadius),
    segments: CURVE_SEGMENTS
  });
}

function roundedSlotGeometry(profile) {
  const length = Number(profile.length);
  const width = Number(profile.width);

  if (length <= width + MIN_ROUNDING_CLEARANCE) {
    return circle({
      center: [Number(profile.x), Number(profile.z)],
      radius: width / 2,
      segments: CURVE_SEGMENTS
    });
  }

  return roundedRectangle({
    center: [Number(profile.x), Number(profile.z)],
    size: [length, width],
    roundRadius: Math.max(0, width / 2 - MIN_ROUNDING_CLEARANCE),
    segments: CURVE_SEGMENTS
  });
}

export function profileToGeom2(profile) {
  if (profile.type === "circle") {
    return circle({
      center: [Number(profile.x), Number(profile.z)],
      radius: Number(profile.radius),
      segments: CURVE_SEGMENTS
    });
  }

  if (profile.type === "roundedSlot") {
    return roundedSlotGeometry(profile);
  }

  if (profile.type === "polyline") {
    const points = polylinePoints(profile);
    const area = signedArea(points);
    if (!Number.isFinite(area) || Math.abs(area) < Number.EPSILON) {
      throw new PartCadCompileError("Polyline profile area is too small to compile.", {
        issues: [{ code: "degenerate-polyline", message: "Polyline profile area is too small to compile." }]
      });
    }
    return polygon({
      points,
      orientation: area < 0 ? "clockwise" : "counterclockwise"
    });
  }

  if (profile.type === "rectangle") {
    return rectangleGeometry(profile);
  }

  throw new PartCadCompileError(`Unsupported profile type: ${profile.type}.`, {
    issues: [{ code: "unsupported-profile", message: `Unsupported profile type: ${profile.type}.` }]
  });
}

export function compileSketchToGeom2(sketch) {
  const outer = profileToGeom2(sketch.outerProfile);
  const cuts = (sketch.cutProfiles ?? []).map(profileToGeom2);
  return cuts.length ? subtract(outer, ...cuts) : outer;
}

export function orientSolidToPartPlane(solid, depthMm) {
  const depth = Number(depthMm);
  const matrix = [
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, -depth / 2, 0, 1
  ];

  return transform(matrix, solid);
}

function bodyMapFromOptions(options) {
  if (options.bodyMap instanceof Map) return options.bodyMap;
  return new Map((options.bodies ?? []).map((item) => [item.id, item]));
}

function compileBooleanBodyToSolid(body, options) {
  const bodyMap = bodyMapFromOptions(options);
  const visited = new Set(options.visited ?? []);
  if (visited.has(body.id)) {
    throw new PartCadCompileError(`Boolean operation has a circular body reference at ${body.id}.`, {
      bodyId: body.id,
      issues: [{ code: "boolean-cycle", message: "Boolean operation references itself through another body." }]
    });
  }
  visited.add(body.id);

  const operandSolids = (body.boolean?.operandBodyIds ?? []).map((bodyId) => {
    const operand = bodyMap.get(bodyId);
    if (!operand) {
      throw new PartCadCompileError(`Boolean operand is missing: ${bodyId}.`, {
        bodyId: body.id,
        issues: [{ code: "missing-boolean-operand", message: `Boolean operand is missing: ${bodyId}.` }]
      });
    }
    return compilePartBodyToSolid(operand, { ...options, bodyMap, visited });
  });

  return applyBooleanOperation(body.boolean.operation, operandSolids);
}

export function compilePartBodyToSolid(body, options = {}) {
  const bodyMap = bodyMapFromOptions(options);
  const issues = validateBody(body, { bodyIds: options.bodyIds ?? new Set(bodyMap.keys()) });
  if (issues.length) {
    throw new PartCadCompileError(`${body?.name ?? body?.id ?? "Body"} failed validation.`, {
      bodyId: body?.id ?? null,
      issues
    });
  }

  try {
    const sourceKind = body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
    if (sourceKind === REVOLVE_KIND) return compileRevolveBodyToSolid(body);
    if (sourceKind === SPUR_GEAR_KIND) return compileSpurGearBodyToSolid(body);
    if (sourceKind === BOOLEAN_OPERATION_KIND) return compileBooleanBodyToSolid(body, options);
    if (sourceKind === ADVANCED_CAD_RECIPE_KIND) return compileAdvancedCadRecipeToSolid(body);

    const sketchGeometry = compileSketchToGeom2(body.sketch);
    const solid = extrudeLinear({ height: Number(body.extrudeDepthMm), repair: true }, sketchGeometry);
    return orientSolidToPartPlane(solid, body.extrudeDepthMm);
  } catch (error) {
    if (error instanceof PartCadCompileError) {
      error.bodyId = error.bodyId ?? body?.id ?? null;
      throw error;
    }

    throw new PartCadCompileError(`CAD compile failed for ${body?.name ?? body?.id ?? "body"}: ${error.message}`, {
      bodyId: body?.id ?? null,
      cause: error
    });
  }
}
