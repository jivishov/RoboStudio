import jscad from "@jscad/modeling";
import {
  ADVANCED_CAD_RECIPE_KIND,
  ADVANCED_CAD_RECIPE_VERSION,
  DEFAULT_BODY_COLOR,
  DEFAULT_EXTRUDE_DEPTH_MM,
  asFiniteNumber,
  asPositiveNumber,
  cloneJson,
  createDefaultTransform,
  sanitizePartId,
  uniquePartId
} from "./contracts.js";

const { booleans, extrusions, primitives, transforms } = jscad;
const { intersect, subtract, union } = booleans;
const { cuboid, cylinder, roundedRectangle } = primitives;
const { extrudeLinear } = extrusions;
const { transform } = transforms;

export const ADVANCED_CAD_OPERATION_TYPES = Object.freeze([
  "box",
  "cylinder",
  "hole",
  "slot",
  "fillet",
  "chamfer",
  "shell",
  "boolean",
  "pattern",
  "transform",
  "label"
]);

export const ADVANCED_CAD_JSCAD_OPERATION_TYPES = Object.freeze(["box", "cylinder", "hole", "slot"]);

export const ADVANCED_CAD_AXES = Object.freeze(["x", "y", "z"]);
export const ADVANCED_CAD_MODES = Object.freeze(["add", "subtract", "intersect"]);
export const ADVANCED_CAD_BOOLEAN_OPERATIONS = Object.freeze(["union", "subtract", "intersect"]);

const MAX_OPERATIONS = 80;
const MAX_LABEL_LENGTH = 160;
const CURVE_SEGMENTS = 48;
const MIN_ROUNDING_CLEARANCE = 0.001;
const ORIENT_XZ_TO_Y_EXTRUSION = [
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
];

export class AdvancedCadBackendRequiredError extends Error {
  constructor(message = "This advanced CAD recipe requires the local build123d backend.") {
    super(message);
    this.name = "AdvancedCadBackendRequiredError";
    this.code = "advanced-cad-backend-required";
  }
}

function issue(code, message, path, severity = "error") {
  return { code, message, path, severity };
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function positive(value) {
  return finite(value) && Number(value) > 0;
}

function normalizeAxis(value, fallback = "y") {
  return ADVANCED_CAD_AXES.includes(value) ? value : fallback;
}

function normalizeMode(value, fallback = "add") {
  return ADVANCED_CAD_MODES.includes(value) ? value : fallback;
}

function normalizeBooleanOperation(value, fallback = "union") {
  return ADVANCED_CAD_BOOLEAN_OPERATIONS.includes(value) ? value : fallback;
}

function normalizeVector3(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : [];
  return [0, 1, 2].map((index) => asFiniteNumber(source[index], fallback[index] ?? 0));
}

function normalizeOperation(operation = {}, index = 0, existingIds = new Set()) {
  const type = typeof operation.type === "string" ? operation.type : "";
  const fallbackId = sanitizePartId(type || `operation_${index + 1}`, `operation_${index + 1}`);
  const id = uniquePartId(operation.id ?? fallbackId, existingIds, fallbackId);
  existingIds.add(id);
  const isSubtractiveFeature = type === "hole" || type === "slot";

  const normalized = {
    id,
    type,
    mode: isSubtractiveFeature ? "subtract" : normalizeMode(operation.mode, "add"),
    label: typeof operation.label === "string" ? operation.label.trim().slice(0, MAX_LABEL_LENGTH) : "",
    center: normalizeVector3(operation.center, [0, 0, 0]),
    axis: normalizeAxis(operation.axis, "y")
  };

  if (Array.isArray(operation.size)) normalized.size = normalizeVector3(operation.size, [10, 10, 10]);
  if (operation.radius != null) normalized.radius = asPositiveNumber(operation.radius, 1, 0);
  if (operation.diameter != null) normalized.diameter = asPositiveNumber(operation.diameter, 2, 0);
  if (operation.height != null) normalized.height = asPositiveNumber(operation.height, DEFAULT_EXTRUDE_DEPTH_MM, 0);
  if (operation.depth != null) normalized.depth = asPositiveNumber(operation.depth, DEFAULT_EXTRUDE_DEPTH_MM, 0);
  if (operation.length != null) normalized.length = asPositiveNumber(operation.length, 10, 0);
  if (operation.width != null) normalized.width = asPositiveNumber(operation.width, 5, 0);
  if (operation.angleDeg != null) normalized.angleDeg = asFiniteNumber(operation.angleDeg, 0);
  if (operation.thicknessMm != null) normalized.thicknessMm = asPositiveNumber(operation.thicknessMm, 1, 0);
  if (operation.operation != null) normalized.operation = normalizeBooleanOperation(operation.operation);
  if (Array.isArray(operation.targetIds)) {
    normalized.targetIds = operation.targetIds.map((value) => sanitizePartId(value, "target")).filter(Boolean);
  }
  if (Array.isArray(operation.vector)) normalized.vector = normalizeVector3(operation.vector, [0, 0, 0]);
  if (Array.isArray(operation.repeat)) {
    normalized.repeat = operation.repeat.slice(0, 3).map((value) => Math.max(1, Math.floor(asPositiveNumber(value, 1, 0))));
  }
  if (Array.isArray(operation.spacing)) normalized.spacing = normalizeVector3(operation.spacing, [0, 0, 0]);

  return normalized;
}

export function normalizeAdvancedCadRecipe(recipe = {}) {
  const operationIds = new Set();
  const operations = Array.isArray(recipe.operations)
    ? recipe.operations.slice(0, MAX_OPERATIONS).map((operation, index) => normalizeOperation(operation, index, operationIds))
    : [];

  return {
    version: Number(recipe.version) === ADVANCED_CAD_RECIPE_VERSION ? ADVANCED_CAD_RECIPE_VERSION : recipe.version,
    units: recipe.units === "mm" ? "mm" : recipe.units,
    designIntent: typeof recipe.designIntent === "string" ? recipe.designIntent.trim().slice(0, 800) : "",
    operations
  };
}

function operationRadius(operation) {
  if (positive(operation.radius)) return Number(operation.radius);
  if (positive(operation.diameter)) return Number(operation.diameter) / 2;
  return NaN;
}

function validateVector3(value, path, issues, options = {}) {
  if (!Array.isArray(value) || value.length !== 3) {
    issues.push(issue("invalid-advanced-cad-vector", "Advanced CAD vectors must contain exactly three numbers.", path));
    return;
  }
  value.forEach((item, index) => {
    if (!finite(item) || (options.positive && Number(item) <= 0)) {
      issues.push(issue("invalid-advanced-cad-vector", "Advanced CAD vector values must be finite numbers.", `${path}.${index}`));
    }
  });
}

function validateOperation(operation, index, issues, path) {
  const opPath = `${path}.operations.${index}`;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    issues.push(issue("invalid-advanced-cad-operation", "Advanced CAD operations must be objects.", opPath));
    return;
  }
  if (!ADVANCED_CAD_OPERATION_TYPES.includes(operation.type)) {
    issues.push(issue("unsupported-advanced-cad-operation", `Unsupported advanced CAD operation: ${operation.type || "missing"}.`, `${opPath}.type`));
    return;
  }
  if (!operation.id || sanitizePartId(operation.id, "operation") !== operation.id) {
    issues.push(issue("unstable-advanced-cad-operation-id", "Advanced CAD operation IDs must be stable and URL-safe.", `${opPath}.id`));
  }
  if (!ADVANCED_CAD_MODES.includes(operation.mode)) {
    issues.push(issue("invalid-advanced-cad-mode", "Advanced CAD operation mode must be add, subtract, or intersect.", `${opPath}.mode`));
  }
  if (operation.center != null) validateVector3(operation.center, `${opPath}.center`, issues);

  if (operation.type === "box") {
    validateVector3(operation.size, `${opPath}.size`, issues, { positive: true });
  }
  if (operation.type === "cylinder" || operation.type === "hole") {
    if (!positive(operationRadius(operation))) {
      issues.push(issue("invalid-advanced-cad-radius", "Cylinder and hole operations need a positive radius or diameter.", opPath));
    }
    const height = operation.type === "hole" ? operation.depth ?? operation.height : operation.height ?? operation.depth;
    if (!positive(height)) {
      issues.push(issue("invalid-advanced-cad-depth", "Cylinder and hole operations need a positive height or depth.", opPath));
    }
    if (!ADVANCED_CAD_AXES.includes(operation.axis)) {
      issues.push(issue("invalid-advanced-cad-axis", "Advanced CAD operation axis must be x, y, or z.", `${opPath}.axis`));
    }
  }
  if (operation.type === "slot") {
    if (!positive(operation.length) || !positive(operation.width) || !positive(operation.depth ?? operation.height)) {
      issues.push(issue("invalid-advanced-cad-slot", "Slot operations need positive length, width, and depth.", opPath));
    }
    if (positive(operation.length) && positive(operation.width) && Number(operation.length) < Number(operation.width)) {
      issues.push(issue("invalid-advanced-cad-slot", "Slot length must be greater than or equal to width.", opPath));
    }
  }
  if ((operation.type === "fillet" || operation.type === "chamfer") && !positive(operation.radius)) {
    issues.push(issue("invalid-advanced-cad-radius", "Fillet and chamfer operations need a positive radius.", opPath));
  }
  if (operation.type === "shell" && !positive(operation.thicknessMm)) {
    issues.push(issue("invalid-advanced-cad-shell", "Shell operations need a positive wall thickness.", opPath));
  }
  if (operation.type === "boolean" && !ADVANCED_CAD_BOOLEAN_OPERATIONS.includes(operation.operation)) {
    issues.push(issue("invalid-advanced-cad-boolean", "Boolean operations must use union, subtract, or intersect.", `${opPath}.operation`));
  }
  if (operation.type === "pattern") {
    validateVector3(operation.spacing, `${opPath}.spacing`, issues);
    if (!Array.isArray(operation.repeat) || operation.repeat.some((value) => !Number.isInteger(value) || value < 1)) {
      issues.push(issue("invalid-advanced-cad-pattern", "Pattern repeat values must be positive integers.", `${opPath}.repeat`));
    }
  }
}

export function validateAdvancedCadRecipe(recipe, path = "advancedCadRecipe") {
  const issues = [];
  if (recipe?.version !== ADVANCED_CAD_RECIPE_VERSION) {
    issues.push(issue("unsupported-advanced-cad-version", "Advanced CAD recipe version must be 1.", `${path}.version`));
  }
  if (recipe?.units !== "mm") {
    issues.push(issue("unsupported-advanced-cad-units", "Advanced CAD recipes must use millimeters.", `${path}.units`));
  }
  if (!Array.isArray(recipe?.operations)) {
    issues.push(issue("invalid-advanced-cad-operations", "Advanced CAD recipes need an operations array.", `${path}.operations`));
    return issues;
  }
  if (!recipe.operations.length) {
    issues.push(issue("empty-advanced-cad-recipe", "Advanced CAD recipes need at least one operation.", `${path}.operations`));
  }
  if (recipe.operations.length > MAX_OPERATIONS) {
    issues.push(issue("too-many-advanced-cad-operations", `Advanced CAD recipes support at most ${MAX_OPERATIONS} operations.`, `${path}.operations`));
  }

  const ids = new Set();
  let hasAdditiveBase = false;
  for (const [index, operation] of recipe.operations.entries()) {
    validateOperation(operation, index, issues, path);
    if (operation?.id) {
      if (ids.has(operation.id)) {
        issues.push(issue("duplicate-advanced-cad-operation-id", "Advanced CAD operation IDs must be unique.", `${path}.operations.${index}.id`));
      }
      ids.add(operation.id);
    }
    if ((operation?.type === "box" || operation?.type === "cylinder") && operation.mode !== "subtract") {
      hasAdditiveBase = true;
    }
  }
  if (!hasAdditiveBase && recipe.operations.length) {
    issues.push(issue("missing-advanced-cad-base", "Advanced CAD recipes need at least one additive box or cylinder base.", `${path}.operations`));
  }
  return issues;
}

export function advancedCadRecipeNeedsBackend(recipe) {
  const normalized = normalizeAdvancedCadRecipe(recipe);
  if (validateAdvancedCadRecipe(normalized).length) return false;
  return normalized.operations.some((operation) => !ADVANCED_CAD_JSCAD_OPERATION_TYPES.includes(operation.type));
}

function operationHeight(operation) {
  return Number(operation.height ?? operation.depth ?? DEFAULT_EXTRUDE_DEPTH_MM);
}

function cylinderEndpoints(center, axis, height) {
  const start = [...center];
  const end = [...center];
  const axisIndex = axis === "x" ? 0 : axis === "z" ? 2 : 1;
  start[axisIndex] -= height / 2;
  end[axisIndex] += height / 2;
  return { start, end };
}

function operationToSolid(operation) {
  if (operation.type === "box") {
    return cuboid({
      center: operation.center,
      size: operation.size
    });
  }
  if (operation.type === "cylinder" || operation.type === "hole") {
    const { start, end } = cylinderEndpoints(operation.center, operation.axis, operationHeight(operation));
    return cylinder({
      start,
      end,
      radius: operationRadius(operation),
      segments: CURVE_SEGMENTS
    });
  }
  if (operation.type === "slot") {
    const width = Number(operation.width);
    const length = Number(operation.length);
    const depth = operationHeight(operation);
    const center = operation.center ?? [0, 0, 0];
    const profile = roundedRectangle({
      center: [center[0], center[2]],
      size: [length, width],
      roundRadius: Math.max(0, width / 2 - MIN_ROUNDING_CLEARANCE),
      segments: CURVE_SEGMENTS
    });
    let solid = extrudeLinear({ height: depth }, profile);
    solid = transform(ORIENT_XZ_TO_Y_EXTRUSION, solid);
    return transforms.translate([0, center[1] - depth / 2, 0], solid);
  }
  throw new AdvancedCadBackendRequiredError();
}

function combineSolids(current, solid, mode) {
  if (!current) {
    if (mode === "subtract") {
      throw new Error("The first advanced CAD operation must add base geometry before subtractive features.");
    }
    return solid;
  }
  if (mode === "subtract") return subtract(current, solid);
  if (mode === "intersect") return intersect(current, solid);
  return union(current, solid);
}

export function compileAdvancedCadRecipeToSolid(body) {
  const recipe = normalizeAdvancedCadRecipe(body?.advancedCadRecipe);
  const issues = validateAdvancedCadRecipe(recipe);
  if (issues.length) {
    const error = new Error(issues[0].message);
    error.issues = issues;
    throw error;
  }
  if (advancedCadRecipeNeedsBackend(recipe)) throw new AdvancedCadBackendRequiredError();

  let solid = null;
  for (const operation of recipe.operations) {
    const mode = operation.type === "hole" || operation.type === "slot" ? "subtract" : operation.mode;
    solid = combineSolids(solid, operationToSolid(operation), mode);
  }
  if (!solid) throw new Error("Advanced CAD recipe did not produce a solid.");
  return solid;
}

function colorFromArgs(args = {}, fallback = DEFAULT_BODY_COLOR) {
  return typeof args.color === "string" && /^#[0-9a-f]{6}$/i.test(args.color) ? args.color : fallback;
}

function designIntentFromRecipe(recipe) {
  return typeof recipe?.designIntent === "string" ? recipe.designIntent.trim().slice(0, 800) : "";
}

function advancedCadResult(body, initialIssues = []) {
  const validationIssues = [...initialIssues, ...validateAdvancedCadRecipe(body.advancedCadRecipe, "advancedCadRecipe")];
  if (!body.id || sanitizePartId(body.id, "body") !== body.id) {
    validationIssues.push(issue("unstable-id", "IDs must be lowercase, stable, and URL-safe.", "id"));
  }
  if (!body.name || !String(body.name).trim()) {
    validationIssues.push(issue("missing-body-name", "Body name is required.", "name"));
  }
  return {
    accepted: validationIssues.length === 0,
    body,
    validationIssues,
    designIntent: body.advancedCadRecipe?.designIntent ?? ""
  };
}

export function createAdvancedCadRecipeBodyFromArgs(args = {}, options = {}) {
  const existingIds = options.existingBodyIds ?? new Set();
  const id = uniquePartId(args.id ?? args.name ?? "advanced_cad_body", existingIds, "advanced_cad_body");
  const recipe = normalizeAdvancedCadRecipe({
    version: ADVANCED_CAD_RECIPE_VERSION,
    units: "mm",
    ...cloneJson(args.advancedCadRecipe ?? args.recipe ?? {}),
    designIntent: args.designIntent ?? args.advancedCadRecipe?.designIntent ?? args.recipe?.designIntent
  });
  const body = {
    id,
    name: String(args.name ?? id).trim() || id,
    color: colorFromArgs(args),
    transform: createDefaultTransform(args.transform),
    source: { kind: ADVANCED_CAD_RECIPE_KIND },
    sketch: { outerProfile: null, cutProfiles: [] },
    extrudeDepthMm: asPositiveNumber(args.extrudeDepthMm, DEFAULT_EXTRUDE_DEPTH_MM),
    advancedCadRecipe: recipe
  };
  return advancedCadResult(body);
}

export function replaceAdvancedCadRecipeBodyFromArgs(currentBody, args = {}) {
  const recipe = normalizeAdvancedCadRecipe({
    version: ADVANCED_CAD_RECIPE_VERSION,
    units: "mm",
    ...cloneJson(args.advancedCadRecipe ?? args.recipe ?? {}),
    designIntent: args.designIntent ?? args.advancedCadRecipe?.designIntent ?? args.recipe?.designIntent
  });
  const body = {
    ...cloneJson(currentBody),
    name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : currentBody.name,
    color: colorFromArgs(args, currentBody.color),
    transform: createDefaultTransform(args.transform ?? currentBody.transform),
    source: { kind: ADVANCED_CAD_RECIPE_KIND },
    sketch: { outerProfile: null, cutProfiles: [] },
    advancedCadRecipe: recipe
  };
  return advancedCadResult(body);
}
