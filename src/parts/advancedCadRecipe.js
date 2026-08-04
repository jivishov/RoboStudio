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
  isFiniteNumber as finite,
  isPositiveNumber as positive,
  sanitizePartId,
  uniquePartId
} from "./contracts.js";
import { createIssue as issue } from "./issues.js";
import { circleSegmentsForRadius } from "./tessellation.js";
import { threadSolid } from "./threads.js";
import { THREAD_KINDS, THREAD_SERIES, listThreadSizes, threadUnavailableReason } from "./standards/threads.js";

const { booleans, extrusions, primitives, transforms } = jscad;
const { intersect, subtract, union } = booleans;
const { cuboid, cylinder, roundedRectangle } = primitives;
const { extrudeLinear } = extrusions;
const { rotateX, rotateY, rotateZ, transform, translate } = transforms;

/**
 * Which kernel builds which operation.
 *
 * ## Why there are exactly two lists and they partition the whole
 *
 * Before cycle 10 there were three states rather than two: seven operations the
 * browser or the backend could build, and four - `boolean`, `pattern`, `transform`,
 * `label` - that were *registered, validated and persisted* and then refused by both
 * kernels, each with its own sentence. The browser refused them with "this recipe
 * requires the local build123d backend", and installing that backend produced
 * "reserved but not implemented by the build123d bridge yet". The page named a remedy
 * that would refuse, and the assistant could author one of those recipes today,
 * because `actionCatalog.js` accepted all eleven types.
 *
 * Cycle 10's rule was: implement or un-reserve, but stop straddling. So:
 *
 * - `boolean`, `pattern` and `transform` are **implemented here**, in the browser.
 *   They always were browser-feasible - `featureOps.js` has applied boolean operations
 *   since cycle 03 and `orientSolidToPartPlane` has transformed solids for as long -
 *   and implementing them in Python instead would have put tier-two capability behind
 *   a tier-three gate, which is the opposite of what the tier is for.
 * - `thread` is **new and browser-side**, for the reason `threads.js` records.
 * - `label` is **un-reserved**: embossed text is the one operation that plausibly needs
 *   OCCT, no kernel here implements it, and a type nothing can build is not a type. It
 *   is gone from the list, so asking for it is now an ordinary unsupported-operation
 *   refusal that says what is true.
 *
 * The invariant a test holds is that these two lists **partition**
 * `ADVANCED_CAD_OPERATION_TYPES` with no overlap and nothing left over. That is what
 * makes `AdvancedCadBackendRequiredError` honest: every operation it refuses is one
 * the backend really implements.
 */
export const ADVANCED_CAD_JSCAD_OPERATION_TYPES = Object.freeze([
  "box",
  "cylinder",
  "hole",
  "slot",
  "thread",
  "boolean",
  "pattern",
  "transform"
]);

/** Operations only the local build123d bridge can build. Fillets need real edges. */
export const ADVANCED_CAD_BACKEND_OPERATION_TYPES = Object.freeze(["fillet", "chamfer", "shell"]);

export const ADVANCED_CAD_OPERATION_TYPES = Object.freeze([
  ...ADVANCED_CAD_JSCAD_OPERATION_TYPES,
  ...ADVANCED_CAD_BACKEND_OPERATION_TYPES
]);

export const ADVANCED_CAD_AXES = Object.freeze(["x", "y", "z"]);
export const ADVANCED_CAD_MODES = Object.freeze(["add", "subtract", "intersect"]);
export const ADVANCED_CAD_BOOLEAN_OPERATIONS = Object.freeze(["union", "subtract", "intersect"]);
export const ADVANCED_CAD_THREAD_SERIES = THREAD_SERIES;
export const ADVANCED_CAD_THREAD_KINDS = THREAD_KINDS;
export const ADVANCED_CAD_THREAD_SIZES = Object.freeze(listThreadSizes());

/**
 * How a fillet or chamfer is aimed.
 *
 * Before cycle 10 the bridge filleted `builder.edges()` - every edge of the part, at
 * one radius. That is a demo rather than a feature, and it is invisible in a faceted
 * preview, so nothing said so. A selector is declarative on purpose: `AGENTS.md`
 * forbids persisting arbitrary Python from the assistant, and a selector that is
 * really a code string is that rule defeated by naming it something else.
 */
export const ADVANCED_CAD_EDGE_SELECTOR_KINDS = Object.freeze(["all", "axis", "face"]);

/**
 * Named faces, in this page's axis convention: **Y is thickness and X/Z are the sketch
 * plane**, so `top` is `+Y`, `right` is `+X` and `back` is `+Z`.
 *
 * The bridge's `FACE_AXES` table says the same thing, and the two have to agree by being
 * read rather than by a test - which face a fillet landed on is not observable from a
 * volume, so a parity assertion on measurements would pass with the pair swapped.
 */
export const ADVANCED_CAD_EDGE_FACES = Object.freeze(["top", "bottom", "left", "right", "front", "back"]);

const MAX_OPERATIONS = 80;
const MAX_LABEL_LENGTH = 160;
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

/**
 * The edge-selector whitelist.
 *
 * Registered here as well as in `validateOperation` and in `actionCatalog.js`, which
 * is landmine two: a field absent from this literal is silently dropped on the next
 * commit, so the round-trip test that renames a body and reads the selector back is
 * shipped in the same change as the field itself.
 */
function normalizeEdgeSelector(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = ADVANCED_CAD_EDGE_SELECTOR_KINDS.includes(value.kind) ? value.kind : "all";
  const selector = { kind };
  if (kind === "axis") selector.axis = normalizeAxis(value.axis, "z");
  if (kind === "face") selector.face = ADVANCED_CAD_EDGE_FACES.includes(value.face) ? value.face : "top";
  if (value.minLengthMm != null) selector.minLengthMm = asPositiveNumber(value.minLengthMm, 1, 0);
  if (value.maxLengthMm != null) selector.maxLengthMm = asPositiveNumber(value.maxLengthMm, 1, 0);
  return selector;
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
  if (operation.edgeSelector != null) {
    const selector = normalizeEdgeSelector(operation.edgeSelector);
    if (selector) normalized.edgeSelector = selector;
  }
  if (type === "thread") {
    // A thread's size is a designation - "M8" - and never the box's XYZ vector, so it
    // gets its own field rather than overloading `size`. `standards/threads.js` owns
    // every number these four strings resolve to; nothing here defaults a dimension.
    normalized.threadSize = typeof operation.threadSize === "string" ? operation.threadSize.trim() : "";
    normalized.series = ADVANCED_CAD_THREAD_SERIES.includes(operation.series) ? operation.series : "coarse";
    normalized.threadKind = ADVANCED_CAD_THREAD_KINDS.includes(operation.threadKind) ? operation.threadKind : "external";
    if (typeof operation.toleranceClass === "string" && operation.toleranceClass.trim()) {
      normalized.toleranceClass = operation.toleranceClass.trim();
    }
    // An internal thread is a void and an external one is material. Leaving the mode to
    // the author would let a recipe say "internal" and "add", which is not a shape.
    normalized.mode = normalized.threadKind === "internal" ? "subtract" : "add";
  }

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
  if (operation.type === "thread") {
    if (!ADVANCED_CAD_THREAD_SIZES.includes(operation.threadSize)) {
      issues.push(issue(
        "unsupported-thread-size",
        `Thread size ${operation.threadSize || "missing"} is not published in the ISO metric table. `
          + `Published sizes are ${ADVANCED_CAD_THREAD_SIZES.join(", ")}.`,
        `${opPath}.threadSize`
      ));
    }
    if (!ADVANCED_CAD_THREAD_SERIES.includes(operation.series)) {
      issues.push(issue("unsupported-thread-series", `Thread series must be one of ${ADVANCED_CAD_THREAD_SERIES.join(", ")}.`, `${opPath}.series`));
    }
    if (!ADVANCED_CAD_THREAD_KINDS.includes(operation.threadKind)) {
      issues.push(issue("unsupported-thread-kind", `Thread kind must be one of ${ADVANCED_CAD_THREAD_KINDS.join(", ")}.`, `${opPath}.threadKind`));
    }
    if (!positive(operation.length)) {
      issues.push(issue("invalid-advanced-cad-thread-length", "Thread operations need a positive threaded length.", `${opPath}.length`));
    }
    if (!ADVANCED_CAD_AXES.includes(operation.axis)) {
      issues.push(issue("invalid-advanced-cad-axis", "Advanced CAD operation axis must be x, y, or z.", `${opPath}.axis`));
    }
    // The standards table is the authority on whether the combination exists at all, so
    // the refusal is read from it rather than re-derived here. A pitch series a size
    // does not have refuses by name, exactly as `holes.js` refuses an unpublished fit.
    const reason = threadUnavailableReason({
      size: operation.threadSize,
      series: operation.series,
      kind: operation.threadKind,
      toleranceClass: operation.toleranceClass
    });
    if (reason && ADVANCED_CAD_THREAD_SIZES.includes(operation.threadSize)) {
      issues.push(issue("unsupported-thread-combination", reason, opPath));
    }
  }
  if ((operation.type === "fillet" || operation.type === "chamfer") && !positive(operation.radius)) {
    issues.push(issue("invalid-advanced-cad-radius", "Fillet and chamfer operations need a positive radius.", opPath));
  }
  if (operation.edgeSelector != null) validateEdgeSelector(operation.edgeSelector, `${opPath}.edgeSelector`, issues);
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
  if (operation.type === "transform" && !Array.isArray(operation.vector) && !finite(operation.angleDeg)) {
    issues.push(issue(
      "empty-advanced-cad-transform",
      "Transform operations need a translation vector, a rotation angle, or both.",
      opPath
    ));
  }
  if (OPERATIONS_NEEDING_TARGETS.includes(operation.type) && !(operation.targetIds ?? []).length) {
    issues.push(issue(
      "missing-advanced-cad-targets",
      `${operation.type} operations must name at least one earlier operation in targetIds.`,
      `${opPath}.targetIds`
    ));
  }
}

/** `transform` may take the whole accumulation, so it is deliberately not here. */
const OPERATIONS_NEEDING_TARGETS = Object.freeze(["boolean", "pattern"]);

function validateEdgeSelector(selector, path, issues) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    issues.push(issue("invalid-advanced-cad-edge-selector", "An edge selector must be an object.", path));
    return;
  }
  if (!ADVANCED_CAD_EDGE_SELECTOR_KINDS.includes(selector.kind)) {
    issues.push(issue(
      "invalid-advanced-cad-edge-selector",
      `Edge selector kind must be one of ${ADVANCED_CAD_EDGE_SELECTOR_KINDS.join(", ")}.`,
      `${path}.kind`
    ));
    return;
  }
  if (selector.kind === "axis" && !ADVANCED_CAD_AXES.includes(selector.axis)) {
    issues.push(issue("invalid-advanced-cad-edge-selector", "An axis edge selector needs an x, y, or z axis.", `${path}.axis`));
  }
  if (selector.kind === "face" && !ADVANCED_CAD_EDGE_FACES.includes(selector.face)) {
    issues.push(issue(
      "invalid-advanced-cad-edge-selector",
      `A face edge selector needs one of ${ADVANCED_CAD_EDGE_FACES.join(", ")}.`,
      `${path}.face`
    ));
  }
  if (selector.minLengthMm != null && selector.maxLengthMm != null
    && Number(selector.minLengthMm) > Number(selector.maxLengthMm)) {
    issues.push(issue(
      "invalid-advanced-cad-edge-selector",
      "An edge selector's minimum length must not exceed its maximum length.",
      path
    ));
  }
}

/** Operation types that can start a recipe by putting material somewhere. */
const ADDITIVE_BASE_TYPES = Object.freeze(["box", "cylinder", "thread"]);

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
    if (ADDITIVE_BASE_TYPES.includes(operation?.type) && operation.mode !== "subtract") {
      hasAdditiveBase = true;
    }
    // A target must name an operation that has already produced a solid. Checked here
    // rather than in `validateOperation` because only this loop knows the order, and
    // order is the whole point: a pattern of a shape that does not exist yet is not a
    // forward reference to resolve, it is a mistake to report.
    for (const targetId of operation?.targetIds ?? []) {
      if (targetId === operation.id || !ids.has(targetId)) {
        issues.push(issue(
          "unknown-advanced-cad-target",
          `Operation "${operation.id}" targets "${targetId}", which is not an earlier operation in this recipe.`,
          `${path}.operations.${index}.targetIds`
        ));
      }
    }
  }
  if (!hasAdditiveBase && recipe.operations.length) {
    issues.push(issue(
      "missing-advanced-cad-base",
      `Advanced CAD recipes need at least one additive ${ADDITIVE_BASE_TYPES.join(", ")} base.`,
      `${path}.operations`
    ));
  }
  return issues;
}

/**
 * Whether this recipe needs the local build123d bridge.
 *
 * ⚠ It answers `false` for an **invalid** recipe, which reads wrong and is not. Both
 * callers - `compileAdvancedCadRecipeToSolid` here and `validateBody` through
 * `compilePartBodyToSolid` - validate first, so the `false` is never acted on; and it
 * is arguably the right answer anyway, because an invalid recipe does not need the
 * backend, it needs fixing. `advancedCadRecipe.test.js` pins this deliberately.
 *
 * Do not "fix" it without a caller that needs a third answer. If one appears, the
 * function wants three values - the browser can build this, the backend can build
 * this, nobody can because it is invalid - and two of those are one value today.
 * Cycle 10's capability probe was checked against this and does not need it: it asks
 * whether a backend exists, which is a different question from what a recipe needs.
 */
export function advancedCadRecipeNeedsBackend(recipe) {
  const normalized = normalizeAdvancedCadRecipe(recipe);
  if (validateAdvancedCadRecipe(normalized).length) return false;
  return normalized.operations.some((operation) => !ADVANCED_CAD_JSCAD_OPERATION_TYPES.includes(operation.type));
}

function operationHeight(operation) {
  return Number(operation.height ?? operation.depth ?? DEFAULT_EXTRUDE_DEPTH_MM);
}

/**
 * Send a Z-axis solid onto the operation's axis.
 *
 * JSCAD builds a cylinder along Z; the recipe names an axis and defaults to Y, which
 * is the extrusion axis of every other body kind in this page. The rotations match
 * `cylinder_rotation` in the build123d bridge, which is what makes the two kernels
 * agree about which way a hole points.
 */
function orientZSolidToAxis(solid, axis) {
  if (axis === "x") return rotateY(Math.PI / 2, solid);
  if (axis === "z") return solid;
  return rotateX(-Math.PI / 2, solid);
}

function operationToSolid(operation) {
  if (operation.type === "box") {
    return cuboid({
      center: operation.center,
      size: operation.size
    });
  }
  if (operation.type === "cylinder" || operation.type === "hole") {
    // ⚠ This used to pass `{ start, end }`. `@jscad/modeling` 2.13.0's `cylinder`
    // accepts `center`, `height`, `radius` and `segments` and **silently ignores**
    // anything else, so every browser-compiled cylinder and hole was a 2 mm stub - the
    // primitive's default height - sitting at the origin, whatever the recipe asked
    // for. It produced a solid, it never threw, and no test looked at the dimensions.
    // Found by measuring a patterned hole against its own arithmetic while
    // implementing cycle 10's parity work, which is the argument for that work.
    const radius = operationRadius(operation);
    const solid = cylinder({
      height: operationHeight(operation),
      radius,
      segments: circleSegmentsForRadius(radius)
    });
    return translate(operation.center ?? [0, 0, 0], orientZSolidToAxis(solid, operation.axis));
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
      segments: circleSegmentsForRadius(Math.max(0, width / 2 - MIN_ROUNDING_CLEARANCE))
    });
    let solid = extrudeLinear({ height: depth }, profile);
    solid = transform(ORIENT_XZ_TO_Y_EXTRUSION, solid);
    return translate([0, center[1] - depth / 2, 0], solid);
  }
  if (operation.type === "thread") {
    // Every dimension comes from `standards/threads.js`; this passes the designation
    // through and authors nothing.
    return threadSolid({
      size: operation.threadSize,
      series: operation.series,
      kind: operation.threadKind,
      toleranceClass: operation.toleranceClass,
      lengthMm: Number(operation.length),
      axis: operation.axis,
      center: operation.center
    });
  }
  // ⚠ Unreachable, and deliberately kept.
  //
  // For a recipe that has passed `validateAdvancedCadRecipe`,
  // `advancedCadRecipeNeedsBackend` is *exactly* the predicate "some operation is
  // outside `ADVANCED_CAD_JSCAD_OPERATION_TYPES`", which is the same condition under
  // which this line would be reached. `compileAdvancedCadRecipeToSolid` therefore
  // always throws before the dispatch loop starts, and the only operations that reach
  // here are ones the branches above handle.
  //
  // It stays for the same reason `holes.js` keeps its unreachable refusal: the
  // alternative to a refusal here is a `null` solid flowing into a boolean. And it is
  // labelled because cycle 10 is exactly the kind of change - operations moving between
  // the two lists - that could make it reachable, and a future author would otherwise
  // either delete it as dead code or "fix" it into a reachable path with a message that
  // is no longer true.
  throw new AdvancedCadBackendRequiredError();
}

/**
 * `transform`'s matrix: a rotation about one axis through `center`, then a translation.
 *
 * Composed from JSCAD's own rotate helpers rather than a hand-written matrix, because a
 * hand-written one is a second place for the axis convention to be wrong.
 */
function applyOperationTransform(solid, operation) {
  const center = operation.center ?? [0, 0, 0];
  const angleRad = (Number(operation.angleDeg ?? 0) * Math.PI) / 180;
  let result = solid;
  if (angleRad) {
    const back = translate([-center[0], -center[1], -center[2]], result);
    const rotate = operation.axis === "x" ? rotateX : operation.axis === "z" ? rotateZ : rotateY;
    result = translate(center, rotate(angleRad, back));
  }
  const vector = operation.vector ?? [0, 0, 0];
  if (vector.some((value) => value !== 0)) result = translate(vector, result);
  return result;
}

/**
 * The solids a `pattern` contributes: its targets repeated on a rectangular grid.
 *
 * Index `[0,0,0]` is included rather than skipped. The original is usually already in
 * the accumulation, so unioning it again changes nothing; but a pattern whose targets
 * were never applied - a hole array built from one unapplied cutter - would otherwise
 * be short by one, and that is the harder mistake to see.
 */
function patternedSolids(operation, targetSolids) {
  const repeat = operation.repeat ?? [1, 1, 1];
  const spacing = operation.spacing ?? [0, 0, 0];
  const counts = [0, 1, 2].map((axis) => Math.max(1, Math.floor(Number(repeat[axis] ?? 1))));
  const copies = [];
  for (let ix = 0; ix < counts[0]; ix += 1) {
    for (let iy = 0; iy < counts[1]; iy += 1) {
      for (let iz = 0; iz < counts[2]; iz += 1) {
        const offset = [ix * Number(spacing[0] ?? 0), iy * Number(spacing[1] ?? 0), iz * Number(spacing[2] ?? 0)];
        for (const target of targetSolids) copies.push(translate(offset, target));
      }
    }
  }
  return copies;
}

function reduceWithOperation(solids, operation) {
  if (operation === "subtract") return solids.length > 1 ? subtract(solids[0], ...solids.slice(1)) : solids[0];
  if (operation === "intersect") return solids.length > 1 ? intersect(...solids) : solids[0];
  return solids.length > 1 ? union(...solids) : solids[0];
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

  // Each shape-producing operation's own solid is kept so `boolean`, `pattern` and
  // `transform` can name it. That is the whole mechanism those three needed, and it is
  // why they were browser-feasible all along.
  const solidsById = new Map();
  const targetSolids = (operation) => (operation.targetIds ?? []).map((id) => solidsById.get(id)).filter(Boolean);

  let solid = null;
  for (const operation of recipe.operations) {
    if (operation.type === "boolean") {
      const combined = reduceWithOperation(targetSolids(operation), operation.operation);
      solidsById.set(operation.id, combined);
      solid = combineSolids(solid, combined, operation.mode);
      continue;
    }
    if (operation.type === "pattern") {
      const copies = patternedSolids(operation, targetSolids(operation));
      const combined = reduceWithOperation(copies, "union");
      solidsById.set(operation.id, combined);
      solid = combineSolids(solid, combined, operation.mode);
      continue;
    }
    if (operation.type === "transform") {
      const targets = targetSolids(operation);
      if (!targets.length) {
        // No targets means the accumulation itself moves - the common case, and the
        // reason `transform` is not on the targets-required list.
        if (!solid) throw new Error("A transform operation needs geometry to move.");
        solid = applyOperationTransform(solid, operation);
        continue;
      }
      const moved = reduceWithOperation(targets.map((target) => applyOperationTransform(target, operation)), "union");
      solidsById.set(operation.id, moved);
      solid = combineSolids(solid, moved, operation.mode);
      continue;
    }

    const operationSolid = operationToSolid(operation);
    solidsById.set(operation.id, operationSolid);
    const mode = operation.type === "hole" || operation.type === "slot" ? "subtract" : operation.mode;
    solid = combineSolids(solid, operationSolid, mode);
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
