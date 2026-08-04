import jscad from "@jscad/modeling";
import { ADVANCED_CAD_RECIPE_KIND, BOOLEAN_OPERATION_KIND, REVOLVE_KIND, SKETCH_EXTRUDE_KIND, SPUR_GEAR_KIND } from "./contracts.js";
import { compileAdvancedCadRecipeToSolid } from "./advancedCadRecipe.js";
import { applyBooleanOperation, compileRevolveBodyToSolid } from "./featureOps.js";
import { compileSpurGearBodyToSolid } from "./gears.js";
import { sketchHolePockets } from "./holes.js";
import {
  describeProcessCompensation,
  normalizeProcessId,
  processCompensationMm,
  resolveProcessProfile
} from "./process.js";
import { circleSegmentsForRadius } from "./tessellation.js";
import { validateBody } from "./validation.js";

const { booleans, expansions, extrusions, geometries, primitives, transforms } = jscad;
const { geom2 } = geometries;
const { circle, cylinder, cylinderElliptic, polygon, rectangle, roundedRectangle } = primitives;
const { subtract } = booleans;
const { offset } = expansions;
const { extrudeLinear } = extrusions;
const { rotateX, transform, translate } = transforms;

const MIN_ROUNDING_CLEARANCE = 0.001;

/**
 * How far a pocket cutter protrudes past the face it is cut from.
 *
 * Purely a boolean hygiene measure: coplanar faces are where CSG kernels produce
 * zero-area artefacts, and lifting the cutter's own end cap clear of the solid's
 * face avoids the question entirely. It removes no extra material, because the
 * protruding part is outside the solid, so the pocket depth stays exactly what the
 * standard says.
 */
const POCKET_OVERCUT_MM = 0.01;
const HEX_SIDES = 6;

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

/**
 * A rectangle's region from its dimensions rather than from a profile object.
 *
 * Takes loose numbers so the compensation path can pass adjusted ones without
 * constructing anything profile-shaped. That is deliberate: a `{ ...profile, width }`
 * spread carrying an as-made width is one careless assignment away from reaching a
 * normalizer, and this cycle's whole contract is that no compensated number ever
 * exists in a shape a normalizer would accept.
 */
function rectangleGeometry(x, z, width, height, cornerRadiusMm) {
  const cornerRadius = Math.max(0, Number(cornerRadiusMm ?? 0));
  const maxRadius = Math.max(0, Math.min(width, height) / 2 - MIN_ROUNDING_CLEARANCE);

  if (cornerRadius <= 0 || maxRadius <= 0) {
    return rectangle({ center: [x, z], size: [width, height] });
  }

  const roundRadius = Math.min(cornerRadius, maxRadius);
  return roundedRectangle({
    center: [x, z],
    size: [width, height],
    roundRadius,
    segments: circleSegmentsForRadius(roundRadius)
  });
}

/** A rounded slot's region from its dimensions. Loose numbers, for the same reason. */
function roundedSlotGeometry(x, z, length, width) {
  if (length <= width + MIN_ROUNDING_CLEARANCE) {
    return circle({
      center: [x, z],
      radius: width / 2,
      segments: circleSegmentsForRadius(width / 2)
    });
  }

  const roundRadius = Math.max(0, width / 2 - MIN_ROUNDING_CLEARANCE);
  return roundedRectangle({
    center: [x, z],
    size: [length, width],
    roundRadius,
    segments: circleSegmentsForRadius(roundRadius)
  });
}

export function profileToGeom2(profile) {
  if (profile.type === "circle") {
    return circle({
      center: [Number(profile.x), Number(profile.z)],
      radius: Number(profile.radius),
      segments: circleSegmentsForRadius(profile.radius)
    });
  }

  if (profile.type === "roundedSlot") {
    return roundedSlotGeometry(Number(profile.x), Number(profile.z), Number(profile.length), Number(profile.width));
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
    return rectangleGeometry(
      Number(profile.x),
      Number(profile.z),
      Number(profile.width),
      Number(profile.height),
      profile.cornerRadius
    );
  }

  throw new PartCadCompileError(`Unsupported profile type: ${profile.type}.`, {
    issues: [{ code: "unsupported-profile", message: `Unsupported profile type: ${profile.type}.` }]
  });
}

/* ============================================ printer and kerf compensation */

/**
 * The one place in this page where drawn geometry becomes as-made geometry.
 *
 * ## The contract
 *
 * The sketch is the source of truth and stays nominal. Nothing below writes a
 * compensated number into a profile object, or into anything shaped like one: each
 * branch constructs a `geom2` directly from the profile's numbers plus the delta, so
 * there is no compensated profile for a later normalizer to persist. That is the
 * failure this guards against and it is one a test would not otherwise see - the
 * geometry would be right and the saved file would slowly stop being nominal.
 *
 * `delta` is the signed distance the material boundary moves outward. An outer profile
 * takes `+delta` and a cut takes `-delta`, because material growing means a void
 * shrinking; one sign convention, applied twice, is why a kerf widens holes and
 * narrows the part from a single number.
 *
 * ## Why per profile rather than on the composite region
 *
 * Cycle 09's plan asks for the offset on the derived `geom2` and cycle 06's plan
 * recorded `expansions.offset` failing on a composite one. Both were re-measured
 * against `@jscad/modeling` 2.13.0 before this was written, and the composite route is
 * unusable for a reason that matters here rather than in general:
 *
 * - **Dilated cuts pass through one another instead of merging.** A plate with two
 *   r5 holes 12 mm apart offset by -1.5 keeps three outlines, and its area comes out
 *   identical to the same plate with the holes 30 mm apart (delta -18.2233 in both
 *   cases, to four decimals). The holes are grown independently and never interact,
 *   so the 2 mm web between them survives a cut that should have consumed it. Two
 *   adjacent holes opening into one slot is exactly what a kerf does, and it is what
 *   `dfm-overlapping-cut-profiles` is about, so a compensation that cannot express it
 *   is compensating for the wrong thing.
 * - **A region thinner than the offset depth returns negative area.** A 20 x 1 strip
 *   at -0.6 measures -3.7600 and at -2 measures -48.0000. Reproduced exactly as cycle
 *   06 recorded it.
 *
 * Offsetting each profile *before* the boolean has neither problem, because the
 * boolean is then doing the merging: the same two-hole plate at -1.5 comes out with
 * **two** outlines and the web gone, which is the right answer. And for three of the
 * four profile types the per-profile offset is analytic and exact - a circle's radius,
 * a rectangle's size, a slot's width - so it introduces no morphological error at all.
 *
 * `expansions.offset` is used for polylines only, which is the single-simple-outline
 * case cycle 09's R5 predicted might be unaffected. It was measured too: a triangle
 * offset by -0.075 gives 2680.6722 against an analytic 2680.6375, and a concave L
 * gives 688.0225 against 688.0000 - about 0.03%, which is the tessellation of the
 * rounded convex corners the offset introduces and is well inside the chord tolerance
 * the rest of the page works to.
 */
function compensatedProfileGeom2(profile, delta) {
  if (delta === 0) return profileToGeom2(profile);

  if (profile.type === "circle") {
    const radius = Number(profile.radius) + delta;
    assertFeatureSurvives(radius, profile, delta);
    return circle({
      center: [Number(profile.x), Number(profile.z)],
      radius,
      // Segments from the **nominal** radius, not the compensated one. A tenth of a
      // millimetre must not change a hole's tessellation density, or the as-made figure
      // would differ from the drawn one partly because the two were faceted differently
      // - a difference that has nothing to do with the machine and would be impossible
      // to tell apart from one that did.
      segments: circleSegmentsForRadius(Number(profile.radius))
    });
  }

  if (profile.type === "rectangle") {
    const width = Number(profile.width) + 2 * delta;
    const height = Number(profile.height) + 2 * delta;
    assertFeatureSurvives(Math.min(width, height) / 2, profile, delta);
    return rectangleGeometry(
      Number(profile.x),
      Number(profile.z),
      width,
      height,
      // A fillet grows and shrinks with the edges it is tangent to, which is what
      // keeps the compensated corner tangent rather than kinked.
      Math.max(0, Number(profile.cornerRadius ?? 0) + delta)
    );
  }

  if (profile.type === "roundedSlot") {
    const length = Number(profile.length) + 2 * delta;
    const width = Number(profile.width) + 2 * delta;
    assertFeatureSurvives(Math.min(length, width) / 2, profile, delta);
    return roundedSlotGeometry(Number(profile.x), Number(profile.z), length, width);
  }

  if (profile.type === "polyline") {
    // The one branch with no closed form. A single simple outline, which is the case
    // measured accurate above - never a composite region.
    //
    // The segment count is taken from `|delta|` rather than from the profile's size
    // because the arcs an offset introduces are the rounded convex corners, and their
    // radius *is* `|delta|`. Asking `circleSegmentsForRadius` about the part would
    // facet a 0.08 mm corner as finely as a 40 mm edge for no gain.
    return offset({ delta, corners: "edge", segments: circleSegmentsForRadius(Math.abs(delta)) }, profileToGeom2(profile));
  }

  return profileToGeom2(profile);
}

/**
 * A feature that compensation closes up entirely stops the compile, loudly.
 *
 * The alternative is worse in both directions: dropping the profile would remove a
 * hole the user drew without saying so, and letting a non-positive radius through
 * produces a `geom2` JSCAD will subtract in unpredictable ways. A feature this small
 * is already a `dfm-min-feature` finding, so the manufacturability report has said the
 * same thing in gentler words before the compile is ever attempted.
 */
function assertFeatureSurvives(halfSizeMm, profile, delta) {
  if (halfSizeMm > 0) return;
  throw new PartCadCompileError(
    `Profile "${profile.id}" closes up under ${Math.abs(delta).toFixed(3)} mm of process compensation, so there is `
      + "nothing left of it to cut. Draw it larger or choose a process that can make it.",
    {
      issues: [{
        code: "compensation-closes-feature",
        message: `Profile "${profile.id}" is smaller than this process's compensation.`
      }]
    }
  );
}

/**
 * The sketch's region, at nominal or as-made.
 *
 * `options.compensationMm` defaults to `0`, so every caller that wants the drawing -
 * `compilePartBodyToSolid`, `massProperties.js`, every exporter, every existing test -
 * gets byte-identical geometry to before this cycle, without passing anything.
 */
export function compileSketchToGeom2(sketch, options = {}) {
  // Absent means nominal; a non-finite number means a caller computed something wrong
  // and must hear about it. Falling back to `0` for a `NaN` would silently disable
  // compensation, which is this cycle's own defect class committed inside the function
  // that exists to prevent it - and it would look exactly like a process with no kerf.
  const compensationMm = options.compensationMm == null ? 0 : Number(options.compensationMm);
  if (!Number.isFinite(compensationMm)) {
    throw new PartCadCompileError(
      `Process compensation must be a finite number of millimetres, not ${JSON.stringify(options.compensationMm)}.`,
      { issues: [{ code: "invalid-compensation", message: "Process compensation is not a number." }] }
    );
  }

  const outer = compensatedProfileGeom2(sketch.outerProfile, compensationMm);
  const cuts = (sketch.cutProfiles ?? []).map((profile) => compensatedProfileGeom2(profile, -compensationMm));
  return cuts.length ? subtract(outer, ...cuts) : outer;
}

/**
 * What this process will make of this drawing: a derived report, never a persisted one.
 *
 * ## Why compensation is a report and not the compiled solid
 *
 * Cycle 09's plan offered two defensible outcomes and said plainly that shipping half
 * of either was the one indefensible state. Compensation could be **geometry** - in
 * which case the compiled solid becomes the as-made part and `processId` must enter
 * `COMPILE_SIGNATURE_FIELDS`, because otherwise switching process serves a stale solid
 * from the cache and no test fails. Or it could be a **derived report** - in which case
 * the solid stays nominal and the compensated figure is stated beside it.
 *
 * It is the report, and one fact decided it rather than a preference: **STL and 3MF
 * export from the cached compile mesh.** A compensated cache would hand a slicer a
 * mesh that had already been shrunk for a nozzle, and the slicer would compensate it
 * again - which is why cycle 09's own do-not-solve list says an export goes out
 * uncompensated. Keeping the solid nominal makes that true by construction rather than
 * by a second uncompensated compile per body.
 *
 * So `processId` stays out of the compile signature, cycle 06's line in `AGENTS.md`
 * stands, and the pair is "changes neither" - one of the two states the plan named as
 * green. `cadCompile.test.js` asserts both halves.
 *
 * ## Both numbers, and never one of them
 *
 * Every dimensional figure here comes in a `nominalMm`/`asMadeMm` pair, and
 * `compensationMm` is `null` rather than `0` where a process declares no compensation,
 * so a UI cannot render an absence as a zero (audit A2). The two numbers are never
 * merged into one field and the as-made side is never present without the nominal side
 * beside it: a reader who sees one number in this report is looking at a labelled pair.
 */
export function bodyCompensationReport(body, options = {}) {
  const processId = normalizeProcessId(options.process ?? body?.processId ?? null);
  const processProfile = resolveProcessProfile(options.process ?? body?.processId ?? null, options.processOverrides ?? null);
  const compensationMm = processCompensationMm(processProfile);
  const description = describeProcessCompensation(processProfile);
  const sketch = body?.sketch ?? null;

  const report = {
    processId,
    processLabel: processProfile?.label ?? null,
    // Null, not zero. A process that has not been measured and a process measured at
    // zero are different claims, and only one of them may render as "0.000 mm".
    compensationMm,
    kerfWidthMm: description?.kerfWidthMm ?? null,
    depositionOversizeMm: description?.depositionOversizeMm ?? null,
    compensationText: description?.text ?? null,
    holes: [],
    nominal: null,
    asMade: null,
    // Absent-with-a-reason rather than absent, following `massProperties.js`'s
    // `volumeUnavailableReason`. See the catch below for what fills it.
    asMadeUnavailableReason: null
  };
  // An advanced body - a gear, a revolve, a boolean - normalizes to a null outer
  // profile, so there is no drawing here to compare a part against. Reported as absent
  // rather than as an area of zero.
  if (!sketch?.outerProfile) return report;

  // Per-circle diameters, which is where the difference is felt: a cut's void moves
  // opposite to the material, so a kerf widens a hole and a nozzle narrows it. The
  // arithmetic is the same `-compensationMm` the geometry path applies to a cut, and
  // it is stated here in diameters because that is what the inspector shows.
  report.holes = (sketch.cutProfiles ?? [])
    .filter((profile) => profile?.type === "circle")
    .map((profile) => {
      const nominalDiameterMm = Number(profile.radius) * 2;
      const asMadeDiameterMm = compensationMm === null ? null : nominalDiameterMm - 2 * compensationMm;
      return {
        id: profile.id,
        nominalDiameterMm,
        // A hole the compensation closes up entirely has no as-made diameter, and a
        // negative one would be a fabricated number in the same cell that exists to
        // state a real one. The drawn figure stays, so the reader still sees what was
        // asked for and can see that the process cannot deliver it.
        asMadeDiameterMm: asMadeDiameterMm !== null && asMadeDiameterMm > 0 ? asMadeDiameterMm : null
      };
    });

  const nominalRegion = geom2Outlines(compileSketchToGeom2(sketch));
  report.nominal = { areaMm2: nominalRegion.areaMm2, perimeterMm: nominalRegion.perimeterMm };
  if (compensationMm === null) return report;

  // Caught, and this is not defensive padding. `compensatedProfileGeom2` throws when a
  // feature is smaller than the compensation - a 0.05 mm slot on a laser closes up - and
  // that throw is right for a compile, which must not build a solid it cannot describe.
  // It is wrong for a report: this one is read on every render of the Manufacturability
  // card, so an uncaught throw here would take the whole inspector down over a feature
  // `dfm-min-feature` has already reported in gentler words. The as-made figures go
  // absent with the reason instead, which is the only honest answer - there is no part
  // to measure - and the nominal side above survives, so the card still states the
  // drawing.
  try {
    const asMadeRegion = geom2Outlines(compileSketchToGeom2(sketch, { compensationMm }));
    report.asMade = { areaMm2: asMadeRegion.areaMm2, perimeterMm: asMadeRegion.perimeterMm };
  } catch (error) {
    report.asMadeUnavailableReason = error instanceof PartCadCompileError
      ? error.message
      : `This process's compensation cannot be applied to this sketch: ${error.message}`;
  }
  return report;
}

/**
 * Area and perimeter of a region, by the shoelace formula.
 *
 * Not borrowed from `massProperties.js`, which imports this module: taking the import
 * the other way would be a cycle, and that module's `outlinesMassProperties` returns a
 * centroid, bounds and a signed area this report has no use for. Six lines against a
 * circular dependency is the right trade.
 */
function geom2Outlines(region) {
  let doubleArea = 0;
  let perimeterMm = 0;
  for (const outline of geom2.toOutlines(region)) {
    for (let index = 0; index < outline.length; index += 1) {
      const [x0, y0] = outline[index];
      const [x1, y1] = outline[(index + 1) % outline.length];
      doubleArea += x0 * y1 - x1 * y0;
      perimeterMm += Math.hypot(x1 - x0, y1 - y0);
    }
  }
  return { areaMm2: Math.abs(doubleArea / 2), perimeterMm };
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

/**
 * A pocket cutter in its canonical frame: axis along local Z, mouth at Z = 0,
 * material removed for Z in `[-depth, +overcut]`.
 *
 * Building every shape in one frame keeps the placement arithmetic in exactly one
 * place, which is where a sign error would otherwise hide.
 */
function pocketCutterCanonical(pocket) {
  const depth = Math.abs(Number(pocket.depthMm));
  const height = depth + POCKET_OVERCUT_MM;
  const center = [0, 0, (POCKET_OVERCUT_MM - depth) / 2];

  if (pocket.shape === "cone") {
    const topRadius = Math.abs(Number(pocket.topDiameterMm)) / 2;
    const bottomRadius = Math.abs(Number(pocket.bottomDiameterMm)) / 2;
    // The overcut follows the same taper, so the cone's radius *at the face* is
    // still exactly the head diameter rather than the head diameter plus a slope.
    const taper = (topRadius - bottomRadius) / depth;
    return cylinderElliptic({
      height,
      center,
      startRadius: [bottomRadius, bottomRadius],
      endRadius: [
        topRadius + POCKET_OVERCUT_MM * taper,
        topRadius + POCKET_OVERCUT_MM * taper
      ],
      segments: circleSegmentsForRadius(topRadius)
    });
  }

  if (pocket.shape === "hexPrism") {
    // A JSCAD 6-segment cylinder is a hexagon inscribed in its radius, so the
    // radius is half the across-corners distance and the flats fall out exactly.
    const radius = Math.abs(Number(pocket.acrossCornersMm)) / 2;
    return cylinder({ height, center, radius, segments: HEX_SIDES });
  }

  const radius = Math.abs(Number(pocket.diameterMm)) / 2;
  return cylinder({ height, center, radius, segments: circleSegmentsForRadius(radius) });
}

/**
 * Place a canonical cutter against one face of an oriented sketch body.
 *
 * `orientSolidToPartPlane` leaves the solid spanning Y in `[-depth/2, +depth/2]`
 * with the sketch plane on X/Z, so `top` is the `+Y` face and `bottom` is `-Y`.
 * `rotateX(-90)` sends local `+Z` to world `+Y` and `rotateX(+90)` sends it to
 * world `-Y`, which is the whole difference between the two faces.
 *
 * A side effect worth stating: the rotation also maps the cutter's local Y onto
 * world Z, so a nut trap's across-corners axis lies along sketch X.
 */
function placePocketCutter(pocket, profile, extrudeDepthMm) {
  const half = Math.abs(Number(extrudeDepthMm)) / 2;
  const fromTop = pocket.fromFace !== "bottom";
  const oriented = rotateX(fromTop ? -Math.PI / 2 : Math.PI / 2, pocketCutterCanonical(pocket));
  return translate([Number(profile.x), fromTop ? half : -half, Number(profile.z)], oriented);
}

/**
 * The post-extrude cutter stage: counterbores, countersinks, nut traps and
 * insert bores.
 *
 * This is the first thing in this page to modify a solid **after** extrusion. It
 * has to be, because a counterbore is a blind feature at a depth from one face and
 * a 2D profile cannot say "part way through". Everything a pocket needs already
 * lives on the cut profile's `hole`, so the compile signature covers it without
 * change: `sketch` and `extrudeDepthMm` are both already signature fields, and a
 * pocket is a function of exactly those two.
 *
 * A body with no resolvable pocket is returned untouched, so nothing that
 * compiled before this stage existed compiles differently now.
 */
export function applyHolePocketsToSolid(solid, body) {
  const pockets = sketchHolePockets(body?.sketch);
  if (!pockets.length) return solid;
  const cutters = pockets.map(({ pocket, profile }) => placePocketCutter(pocket, profile, body.extrudeDepthMm));
  return subtract(solid, ...cutters);
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

    // Nominal, and deliberately. See `bodyCompensationReport` for the decision and
    // the two things that forced it: an export reads this solid, and cycle 09's own
    // plan says an export goes out uncompensated.
    const sketchGeometry = compileSketchToGeom2(body.sketch);
    const solid = extrudeLinear({ height: Number(body.extrudeDepthMm), repair: true }, sketchGeometry);
    return applyHolePocketsToSolid(orientSolidToPartPlane(solid, body.extrudeDepthMm), body);
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
