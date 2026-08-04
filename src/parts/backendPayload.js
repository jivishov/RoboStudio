/**
 * The exact-body payload the local build123d bridge is asked to build.
 *
 * ## What this module exists to fix
 *
 * Before cycle 10 the bridge read `body.advancedCadRecipe` and **nothing else**
 * (`robostudio_build123d_backend.py`'s `main`), so `exportSelectedStep` refused every
 * other body kind and `bodyExportAvailability` said so in the menu: *"Exact STEP for
 * the other body kinds arrives with the build123d tier."* This is that tier, and the
 * remaining work turned out to be a **payload** problem rather than a format one - the
 * STEP the bridge already produced was real OCCT BREP from `export_step`, not a faceted
 * impression of one, and the STEP request never touched the ASCII STL at all.
 *
 * ## Two shapes were defensible and one is wrong
 *
 * Either teach the Python a second payload per body kind, or lower each kind into a
 * recipe the existing `box`/`cylinder`/`hole`/`slot` dispatch already understands. The
 * second is cheaper and worse: a spur gear lowered into boxes and cylinders is not a
 * gear, and an approximation routed through a tier whose whole claim is exactness is
 * worse than no STEP at all, because the export names a tier that promises otherwise.
 *
 * So this is the first shape: one declarative payload per kind, each carrying the
 * **source** geometry rather than a mesh of it.
 *
 * ## Fidelity is declared, not assumed
 *
 * Three of the four kinds are exactly representable in OCCT: a sketch profile is
 * circles, rounded rectangles, slots and polylines, all analytic; a revolve is a
 * polygon swept about an axis; a boolean is booleans over exact operands. A **spur gear
 * is not**, because its flanks are involutes and this page's generator emits them as a
 * point list sampled to the chord tolerance in `tessellation.js`.
 *
 * That is not a defect and it is not lowering into primitives either - it is the same
 * curve the browser draws, at the same tolerance, and it is the curve cycle 07 shipped.
 * But it is *sampled*, so every payload carries `fidelity`, the caller shows it, and
 * nothing claims an exactness it does not have. The alternative - re-deriving involutes
 * in Python - would be a second source of truth for the tooth form, which is the defect
 * `AGENTS.md` closes by making `spurGearGeometry` the single source of every derived
 * gear radius.
 *
 * ## The boolean closure
 *
 * `AGENTS.md` requires a boolean body to compile with the whole body list so its
 * operands resolve regardless of JSON order, and the saved-library path already carries
 * the dependency closure for the same reason. A boolean payload therefore embeds its
 * operands' **payloads**, recursively, rather than their ids: the bridge has no project
 * to look them up in.
 */

import {
  ADVANCED_CAD_RECIPE_KIND,
  BOOLEAN_OPERATION_KIND,
  REVOLVE_KIND,
  SKETCH_EXTRUDE_KIND,
  SPUR_GEAR_KIND
} from "./contracts.js";
import { normalizeRevolveFeature } from "./featureOps.js";
import { createSpurGearProfilePoints, spurGearGeometry } from "./gears.js";
import { sketchHolePockets } from "./holes.js";
import { DEFAULT_CHORD_TOLERANCE_MM } from "./tessellation.js";
import { threadSummary } from "./threads.js";

export const BACKEND_PAYLOAD_VERSION = 1;

/** Every geometry in a payload is exactly what was drawn. */
export const FIDELITY_EXACT = "exact";
/** A curve in this payload is a point list sampled to the chord tolerance. */
export const FIDELITY_SAMPLED = "sampled";

export class BackendPayloadError extends Error {
  constructor(message, code = "backend-payload-unsupported") {
    super(message);
    this.name = "BackendPayloadError";
    this.code = code;
  }
}

function bodyKind(body) {
  return body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
}

function scaleVector(body) {
  const source = Array.isArray(body?.transform?.scale) ? body.transform.scale : [1, 1, 1];
  return [0, 1, 2].map((axis) => {
    const value = Number(source[axis]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
}

/**
 * A cut profile, reduced to the fields the bridge builds from.
 *
 * The `hole` is deliberately **not** sent. A resolved hole already owns its profile's
 * radius (`createCircleProfile`), so the radius here is the standard's number; sending
 * the designation as well would give the bridge a second way to derive the same
 * dimension, which is the two-numbers-that-must-match defect in a new place. What the
 * hole does contribute - a counterbore, a nut trap - arrives as a resolved pocket
 * instead, already reduced to shapes and depths by `holes.js`.
 */
function profilePayload(profile) {
  if (profile?.type === "circle") {
    return { type: "circle", x: Number(profile.x), z: Number(profile.z), radiusMm: Number(profile.radius) };
  }
  if (profile?.type === "roundedSlot") {
    return {
      type: "roundedSlot",
      x: Number(profile.x),
      z: Number(profile.z),
      lengthMm: Number(profile.length),
      widthMm: Number(profile.width)
    };
  }
  if (profile?.type === "rectangle") {
    return {
      type: "rectangle",
      x: Number(profile.x),
      z: Number(profile.z),
      widthMm: Number(profile.width),
      heightMm: Number(profile.height),
      cornerRadiusMm: Math.max(0, Number(profile.cornerRadius ?? 0))
    };
  }
  if (profile?.type === "polyline") {
    return {
      type: "polyline",
      points: (profile.points ?? []).map((point) => [Number(point[0]), Number(point[1])])
    };
  }
  throw new BackendPayloadError(`No exact payload exists for profile type ${profile?.type ?? "missing"}.`);
}

function sketchPayload(body) {
  const outerProfile = body?.sketch?.outerProfile;
  if (!outerProfile) {
    throw new BackendPayloadError("This body has no outer profile, so there is no exact solid to write.");
  }
  return {
    kind: SKETCH_EXTRUDE_KIND,
    fidelity: FIDELITY_EXACT,
    extrudeDepthMm: Number(body.extrudeDepthMm),
    outerProfile: profilePayload(outerProfile),
    cutProfiles: (body.sketch.cutProfiles ?? []).map(profilePayload),
    // Blind features have no 2D contour, which is exactly why `cadCompile.js` cuts them
    // after the extrude. They are resolved here for the same reason: the bridge is given
    // shapes and depths, never a fastener designation to re-resolve.
    pockets: sketchHolePockets(body.sketch).map(({ profile, pocket }) => ({
      x: Number(profile.x),
      z: Number(profile.z),
      ...pocket
    }))
  };
}

function revolvePayload(body) {
  const revolve = normalizeRevolveFeature(body.revolve);
  return {
    kind: REVOLVE_KIND,
    // A polygon swept about an axis is an exact surface of revolution in OCCT: the
    // browser's `segments` count is a tessellation choice and the bridge needs none.
    fidelity: FIDELITY_EXACT,
    angleDeg: Number(revolve.angleDeg),
    profilePoints: revolve.profilePoints.map((point) => [Number(point[0]), Number(point[1])])
  };
}

function spurGearPayload(body) {
  const geometry = spurGearGeometry(body.gear);
  return {
    kind: SPUR_GEAR_KIND,
    // ⚠ Sampled, and said so. See the module comment: the flanks are involutes emitted
    // as a point list at `tessellation.js`'s chord tolerance, which is the curve this
    // page draws. Re-deriving them in Python would be a second source of truth for the
    // tooth form.
    fidelity: FIDELITY_SAMPLED,
    fidelityNote:
      `Involute flanks are sampled to a ${geometry.toleranceMm} mm chord tolerance, the same `
      + "curve the browser preview and every other export use.",
    thicknessMm: Number(geometry.thicknessMm),
    boreDiameterMm: Number(geometry.boreDiameterMm),
    twistAngleRad: Number(geometry.twistAngleRad),
    // A helical gear is the transverse profile swept by a twist, and OCCT has no twist
    // extrude. The bridge lofts the same sections the browser's `twistSteps` produces,
    // so the two kernels approximate the helix identically rather than each choosing a
    // step count. A spur gear has `twistAngleRad === 0` and needs none of this.
    twistSteps: Number(geometry.twistSteps),
    profilePoints: createSpurGearProfilePoints(geometry.gear, { geometry }).map((point) => [
      Number(point[0]),
      Number(point[1])
    ])
  };
}

/**
 * A recipe with every `thread` operation's dimensions resolved beside its designation.
 *
 * The recipe persists `M8`, `coarse`, `external` and nothing else, which is right - a
 * designation is what a designer authored and every number behind it belongs to
 * `standards/threads.js`. But the bridge has no standards table, and giving it one would
 * be a second source of truth for a thread's minor diameter: build123d ships `IsoThread`
 * and it would answer from its own tables, so an M8 could come out of Python a few
 * microns different from the same M8 in the preview and nothing would say why.
 *
 * So the designation travels **with** the numbers it resolved to, and the bridge builds
 * from the numbers. `resolvedThread` is derived output on a request payload and is never
 * persisted - `normalizeAdvancedCadRecipe` does not know the field, so a round trip drops
 * it, which is the intended asymmetry rather than an oversight.
 */
function recipeWithResolvedThreads(recipe) {
  const operations = (recipe?.operations ?? []).map((operation) => {
    if (operation?.type !== "thread") return operation;
    const summary = threadSummary({
      size: operation.threadSize,
      series: operation.series,
      kind: operation.threadKind,
      toleranceClass: operation.toleranceClass,
      lengthMm: operation.length
    });
    if (!summary) {
      // Validation refuses this combination before a compile, so reaching here means a
      // caller built a payload from an unvalidated recipe. Refusing beats posting an
      // operation the bridge would have to guess at.
      throw new BackendPayloadError(
        `Thread operation "${operation.id}" names a combination the ISO metric table does not hold.`,
        "backend-payload-unresolved-thread"
      );
    }
    return { ...operation, resolvedThread: summary };
  });
  return { ...recipe, operations };
}

function booleanPayload(body, options) {
  const bodyMap = options.bodyMap;
  const visited = new Set(options.visited ?? []);
  if (visited.has(body.id)) {
    throw new BackendPayloadError(
      `Boolean operation has a circular body reference at ${body.id}.`,
      "backend-payload-boolean-cycle"
    );
  }
  visited.add(body.id);

  const operandBodyIds = body.boolean?.operandBodyIds ?? [];
  if (!operandBodyIds.length) {
    throw new BackendPayloadError("A boolean body needs at least one operand to export.");
  }

  const operands = operandBodyIds.map((bodyId) => {
    const operand = bodyMap.get(bodyId);
    if (!operand) {
      // The whole point of the closure. A payload that quietly dropped an operand would
      // export a solid that is not the body the user selected.
      throw new BackendPayloadError(
        `Boolean operand is missing: ${bodyId}. STEP export needs the whole body list.`,
        "backend-payload-missing-operand"
      );
    }
    return exactBodyPayload(operand, { ...options, visited });
  });

  return {
    kind: BOOLEAN_OPERATION_KIND,
    fidelity: operands.some((operand) => operand.fidelity === FIDELITY_SAMPLED) ? FIDELITY_SAMPLED : FIDELITY_EXACT,
    operation: body.boolean.operation,
    operands
  };
}

/**
 * The declarative payload for one body, whatever its kind.
 *
 * `options.bodies` (or `options.bodyMap`) is required for a boolean body and ignored
 * for every other kind, which mirrors `compilePartBodyToSolid` exactly - one call
 * signature for every kind, and the closure supplied whether or not it is needed.
 */
export function exactBodyPayload(body, options = {}) {
  const bodyMap = options.bodyMap instanceof Map
    ? options.bodyMap
    : new Map((options.bodies ?? []).map((item) => [item.id, item]));
  const kind = bodyKind(body);

  const shape = kind === ADVANCED_CAD_RECIPE_KIND
    ? { kind: ADVANCED_CAD_RECIPE_KIND, fidelity: FIDELITY_EXACT, advancedCadRecipe: recipeWithResolvedThreads(body.advancedCadRecipe) }
    : kind === REVOLVE_KIND
      ? revolvePayload(body)
      : kind === SPUR_GEAR_KIND
        ? spurGearPayload(body)
        : kind === BOOLEAN_OPERATION_KIND
          ? booleanPayload(body, { ...options, bodyMap })
          : sketchPayload(body);

  return {
    id: body.id,
    name: body.name,
    // Baked here rather than in the bridge for the same reason `compileBodyToStlSolid`
    // bakes it: a body the user has scaled must not export at nominal size silently.
    scale: scaleVector(body),
    ...shape
  };
}

/**
 * The whole request body for a STEP export.
 *
 * `toleranceMm` travels with the request so the two kernels facet against **one**
 * number. Before cycle 10 the bridge called `export_stl` with no tolerance at all, so a
 * mesh previewed from Python was faceted by build123d's default while the same body
 * previewed from the browser was faceted by `DEFAULT_CHORD_TOLERANCE_MM` - two
 * unrelated faceting rules on one preview surface, which is also why a parity tolerance
 * between them could never have been float precision.
 */
export function exactBodyCompileRequest(body, options = {}) {
  return {
    payloadVersion: BACKEND_PAYLOAD_VERSION,
    units: "mm",
    toleranceMm: options.toleranceMm ?? DEFAULT_CHORD_TOLERANCE_MM,
    exactBody: exactBodyPayload(body, options),
    includeStep: options.includeStep ?? true,
    includeStl: options.includeStl ?? false,
    includeMesh: options.includeMesh ?? false
  };
}

/** Why this body has no exact payload, as a sentence, or `null` if it has one. */
export function exactBodyUnavailableReason(body, options = {}) {
  try {
    exactBodyPayload(body, options);
    return null;
  } catch (error) {
    return error instanceof BackendPayloadError ? error.message : `No exact payload: ${error.message}`;
  }
}
