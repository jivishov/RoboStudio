/**
 * DXF R12 ASCII export from the exact 2D sketch region.
 *
 * ## The entity decision, which is the whole point of this file
 *
 * Every other consumer of a sketch body goes through `compileSketchToGeom2`,
 * which tessellates arcs to a 0.02 mm chord tolerance
 * (`tessellation.js`). Emitting the resulting outline as a `POLYLINE` would be
 * easy and would be wrong: a laser cutter handed a 32-segment polyline for an M3
 * clearance hole cuts a 32-sided hole, and the machine has no way to know that a
 * circle was meant. The tolerance that is invisible on screen becomes a facet in
 * steel.
 *
 * So DXF is generated from the **profiles**, not from the tessellated region, and
 * every profile is emitted as the analytic entity it actually is:
 *
 * | Profile | Entities |
 * |---|---|
 * | `circle` | one `CIRCLE` |
 * | `roundedSlot`, length > width | two `LINE` plus two 180-degree `ARC` |
 * | `roundedSlot`, length == width | one `CIRCLE` |
 * | `rectangle`, `cornerRadius` 0 | one closed `POLYLINE` of four vertices |
 * | `rectangle`, `cornerRadius` > 0 | four `LINE` plus four 90-degree `ARC` |
 * | `polyline` | one closed `POLYLINE` |
 *
 * `CIRCLE` and `ARC` are R12 entities, so this needs no later DXF revision.
 * `LWPOLYLINE` and `ELLIPSE` are R13+ and are deliberately not used.
 *
 * That makes the DXF *more* exact than the preview mesh rather than merely
 * different from it. Two known divergences, both in the DXF's favour and both
 * below any kerf:
 *
 * - Arcs here are true arcs; the compiled solid's are inscribed polygons within
 *   0.02 mm.
 * - JSCAD's `roundedRectangle` and `roundedSlot` need a 0.001 mm degeneracy
 *   clearance on their round radius. DXF uses the nominal radius, clamped only
 *   where geometry demands it, so its extents equal the sketch exactly.
 *
 * ## Standards holes, and what a counterbore looks like in 2D
 *
 * A cut profile carrying a `hole` needs no special handling here, and that is the
 * decision rather than an omission. The profile's radius **is** the standard's
 * pilot radius - `createCircleProfile` derives it - so an M3 clearance hole already
 * emits as a `CIRCLE` of diameter 3.4 mm with no code in this file aware that a
 * standard was involved.
 *
 * A counterbore, countersink or nut trap is a different matter: it is a blind
 * pocket at a depth from one face, cut after extrusion, and it has **no 2D
 * contour**. There is no closed path a cutter could follow that produces it. So
 * this exporter emits the pilot circle and nothing else, which is the feature a
 * cutter can actually make, and it says so: `pocketedHoleIds` records which
 * profiles carry a pocket and a warning states that the pocket is a milling
 * operation the DXF does not describe. Emitting the counterbore diameter as a
 * second concentric circle would be worse than silence - a laser cutter would cut
 * it right through.
 *
 * ## Coordinates, units and scale
 *
 * The sketch plane is X/Z with Y as thickness (`AGENTS.md`), so DXF X is sketch X
 * and DXF Y is sketch Z. Units are millimetres, declared through `$INSUNITS` 4
 * and `$MEASUREMENT` 1.
 *
 * `compileBodyToStlSolid` bakes `transform.scale` into the mesh exports, so this
 * one applies the sketch-plane part of the same scale. A scale that is not
 * uniform within the plane turns a hole into an ellipse, which R12 cannot state,
 * so this **refuses** rather than shipping a silent nominal-size file.
 *
 * Nothing here applies kerf or any process compensation: DXF exports
 * uncompensated, and compensation is a later cycle's concern.
 *
 * ## Overlapping cuts, which this file used to report and no longer does
 *
 * One contour per profile is only sound while the profiles are disjoint: two
 * overlapping holes merge into one opening in the solid while this exporter emits
 * two intersecting paths. That detection lived here because this is where the
 * consequence was first felt, but it is a statement about the design rather than
 * about this file, so it is now `dfm.js`'s `detectOverlappingCutProfiles` and it
 * lives in exactly one place. The Manufacturability panel states it whether or not
 * anybody exports, which is strictly earlier than a warning attached to a download.
 *

 * The module is DOM-free: it runs in the CAD worker and under `node:test`.
 */

import { SKETCH_EXTRUDE_KIND, sanitizePartId } from "../contracts.js";
import { bodyExportAvailability, EXPORT_FORMAT_DXF, sketchPlaneScale } from "../exportFormats.js";
import { sketchHolePockets } from "../holes.js";
import { createIssue } from "../issues.js";
import { profileBounds } from "../sketch.js";
import { validateBody } from "../validation.js";

export const OUTER_LAYER = "OUTER";
export const CUT_LAYER = "CUTS";
export const POCKET_NOT_IN_DXF_CODE = "hole-pocket-not-in-dxf";

export class PartDxfExportError extends Error {
  constructor(message, code = "dxf-export-unavailable") {
    super(message);
    this.name = "PartDxfExportError";
    this.code = code;
  }
}

export function dxfFileNameForBody(body) {
  return `${sanitizePartId(body?.name ?? body?.id ?? "robotic_part", "robotic_part")}.dxf`;
}

/** DXF is a group-code stream: an integer code line, then its value line. */
function pair(code, value) {
  return [String(code), String(value)];
}

function coordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0.0";
  // Six decimals is a nanometre at millimetre scale, well inside any machine's
  // resolution, and keeps the file free of float noise like 3.1999999999999997.
  const fixed = number.toFixed(6);
  return fixed === "-0.000000" ? "0.000000" : fixed;
}

function angle(degrees) {
  const number = Number(degrees);
  const wrapped = ((number % 360) + 360) % 360;
  return wrapped.toFixed(6);
}

function circleEntity(layer, centerX, centerY, radius) {
  return [
    pair(0, "CIRCLE"),
    pair(8, layer),
    pair(10, coordinate(centerX)),
    pair(20, coordinate(centerY)),
    pair(30, "0.0"),
    pair(40, coordinate(radius))
  ];
}

function lineEntity(layer, fromX, fromY, toX, toY) {
  return [
    pair(0, "LINE"),
    pair(8, layer),
    pair(10, coordinate(fromX)),
    pair(20, coordinate(fromY)),
    pair(30, "0.0"),
    pair(11, coordinate(toX)),
    pair(21, coordinate(toY)),
    pair(31, "0.0")
  ];
}

/** R12 `ARC` sweeps counter-clockwise from `startDeg` to `endDeg`. */
function arcEntity(layer, centerX, centerY, radius, startDeg, endDeg) {
  return [
    pair(0, "ARC"),
    pair(8, layer),
    pair(10, coordinate(centerX)),
    pair(20, coordinate(centerY)),
    pair(30, "0.0"),
    pair(40, coordinate(radius)),
    pair(50, angle(startDeg)),
    pair(51, angle(endDeg))
  ];
}

/**
 * R12 has no `LWPOLYLINE`, so a closed polygon is a `POLYLINE` header, one
 * `VERTEX` per point and a `SEQEND`. Group 70 bit 1 closes it, so the closing
 * segment is implicit and the first point is never repeated.
 */
function polylineEntity(layer, points) {
  const lines = [
    pair(0, "POLYLINE"),
    pair(8, layer),
    pair(66, "1"),
    pair(70, "1"),
    pair(10, "0.0"),
    pair(20, "0.0"),
    pair(30, "0.0")
  ];
  for (const point of points) {
    lines.push(
      pair(0, "VERTEX"),
      pair(8, layer),
      pair(10, coordinate(point[0])),
      pair(20, coordinate(point[1])),
      pair(30, "0.0")
    );
  }
  lines.push(pair(0, "SEQEND"), pair(8, layer));
  return lines;
}

/**
 * Corner radius clamped by geometry alone.
 *
 * `cadCompile.js` subtracts a 0.001 mm clearance because JSCAD's
 * `roundedRectangle` degenerates at exactly half the short side. A true arc has
 * no such problem, so DXF keeps the nominal radius and only refuses to exceed
 * half the short side.
 */
function rectangleCornerRadius(profile) {
  const width = Math.abs(Number(profile.width));
  const height = Math.abs(Number(profile.height));
  const requested = Math.max(0, Number(profile.cornerRadius ?? 0));
  return Math.min(requested, Math.min(width, height) / 2);
}

function rectangleEntities(layer, profile) {
  const centerX = Number(profile.x);
  const centerY = Number(profile.z);
  const halfWidth = Math.abs(Number(profile.width)) / 2;
  const halfHeight = Math.abs(Number(profile.height)) / 2;
  const radius = rectangleCornerRadius(profile);

  if (!(radius > 0)) {
    return polylineEntity(layer, [
      [centerX - halfWidth, centerY - halfHeight],
      [centerX + halfWidth, centerY - halfHeight],
      [centerX + halfWidth, centerY + halfHeight],
      [centerX - halfWidth, centerY + halfHeight]
    ]);
  }

  const insetX = halfWidth - radius;
  const insetY = halfHeight - radius;
  const entities = [];

  if (insetX > 0) {
    entities.push(
      ...lineEntity(layer, centerX - insetX, centerY - halfHeight, centerX + insetX, centerY - halfHeight),
      ...lineEntity(layer, centerX + insetX, centerY + halfHeight, centerX - insetX, centerY + halfHeight)
    );
  }
  if (insetY > 0) {
    entities.push(
      ...lineEntity(layer, centerX + halfWidth, centerY - insetY, centerX + halfWidth, centerY + insetY),
      ...lineEntity(layer, centerX - halfWidth, centerY + insetY, centerX - halfWidth, centerY - insetY)
    );
  }

  entities.push(
    ...arcEntity(layer, centerX + insetX, centerY - insetY, radius, 270, 360),
    ...arcEntity(layer, centerX + insetX, centerY + insetY, radius, 0, 90),
    ...arcEntity(layer, centerX - insetX, centerY + insetY, radius, 90, 180),
    ...arcEntity(layer, centerX - insetX, centerY - insetY, radius, 180, 270)
  );
  return entities;
}

function roundedSlotEntities(layer, profile) {
  const centerX = Number(profile.x);
  const centerY = Number(profile.z);
  const radius = Math.abs(Number(profile.width)) / 2;
  const halfStraight = Math.abs(Number(profile.length)) / 2 - radius;

  if (!(halfStraight > 0)) return circleEntity(layer, centerX, centerY, radius);

  return [
    ...lineEntity(layer, centerX - halfStraight, centerY - radius, centerX + halfStraight, centerY - radius),
    ...arcEntity(layer, centerX + halfStraight, centerY, radius, 270, 90),
    ...lineEntity(layer, centerX + halfStraight, centerY + radius, centerX - halfStraight, centerY + radius),
    ...arcEntity(layer, centerX - halfStraight, centerY, radius, 90, 270)
  ];
}

function profileEntities(layer, profile) {
  if (profile.type === "circle") {
    return circleEntity(layer, Number(profile.x), Number(profile.z), Math.abs(Number(profile.radius)));
  }
  if (profile.type === "roundedSlot") return roundedSlotEntities(layer, profile);
  if (profile.type === "polyline") {
    const points = (profile.points ?? []).map((point) => [Number(point[0]), Number(point[1])]);
    const first = points[0];
    const last = points[points.length - 1];
    // A duplicated closing point would emit a zero-length segment on a closed
    // polyline, which some readers flag.
    if (first && last && first[0] === last[0] && first[1] === last[1] && points.length > 3) points.pop();
    return polylineEntity(layer, points);
  }
  return rectangleEntities(layer, profile);
}

function scaleProfile(profile, factor) {
  if (Math.abs(factor - 1) <= 1e-12) return profile;
  const scaled = { ...profile };
  for (const key of ["x", "z", "radius", "length", "width", "height", "cornerRadius"]) {
    if (scaled[key] != null) scaled[key] = Number(scaled[key]) * factor;
  }
  if (Array.isArray(profile.points)) {
    scaled.points = profile.points.map((point) => [Number(point[0]) * factor, Number(point[1]) * factor]);
  }
  return scaled;
}

function sketchExtents(profiles) {
  const bounds = profiles.map(profileBounds).filter(Boolean);
  if (!bounds.length) return { min: [0, 0], max: [0, 0] };
  return {
    min: [Math.min(...bounds.map((item) => item.minX)), Math.min(...bounds.map((item) => item.minZ))],
    max: [Math.max(...bounds.map((item) => item.maxX)), Math.max(...bounds.map((item) => item.maxZ))]
  };
}

/**
 * Hole pockets, as a report that the DXF describes the pilot and not the pocket.
 *
 * Stated rather than silent, because the difference matters to whoever reads the
 * file: a plate whose M3 holes are counterbored arrives at the laser cutter as
 * four 3.4 mm circles, and the counterbores have to be milled afterwards. A shop
 * that does not know that will ship a part with no counterbores and be right to.
 */
export function detectHolePocketsMissingFromDxf(sketch, options = {}) {
  const pockets = sketchHolePockets(sketch);
  if (!pockets.length) return null;

  const named = pockets
    .slice(0, 3)
    .map(({ profile, pocket }) => `${profile.id} (${pocket.style})`)
    .join(", ");
  return createIssue(
    POCKET_NOT_IN_DXF_CODE,
    `${pockets.length} hole${pockets.length === 1 ? "" : "s"} carr${pockets.length === 1 ? "ies" : "y"} a pocket with no 2D contour, so this DXF emits only the through pilot: ${named}. The pocket is a milling operation and must be cut separately.`,
    options.path ?? "sketch.cutProfiles",
    "warning",
    { pocketCount: pockets.length, profileIds: pockets.map(({ profile }) => profile.id) }
  );
}

/**
 * Build the DXF plan for a body: entities, extents, applied scale, warnings.
 *
 * Separated from serialization so tests and the UI can assert on what will be
 * emitted without parsing text back out.
 */
export function bodyDxfPlan(body) {
  // No `valid` in the context, deliberately. The availability table only refuses on
  // `valid === false`, so an omitted flag is the same answer a hardcoded `true`
  // gave - and a hardcoded `true` is precisely the shape of the defect this cycle
  // removed from the worker message. Validity is established below, by running the
  // gate rather than by asserting its result.
  const availability = bodyExportAvailability(body, EXPORT_FORMAT_DXF, {});
  if (!availability.available) throw new PartDxfExportError(availability.reason, "dxf-export-unavailable");
  if (body?.source?.kind && body.source.kind !== SKETCH_EXTRUDE_KIND) {
    throw new PartDxfExportError("DXF export needs a sketch-extrude body.", "dxf-export-unavailable");
  }

  // DXF is the one export that never calls `compilePartBodyToSolid`, so it is the
  // one export that does not get `validateBody` for free. It has to run the gate
  // itself: emitting one contour per profile is only sound because validation
  // guarantees every cut lies inside the outer profile, and a body that has not
  // been validated has no such guarantee.
  const issues = validateBody(body);
  if (issues.length) {
    throw new PartDxfExportError(
      `${body?.name ?? body?.id ?? "This body"} failed validation: ${issues[0].message}`,
      "dxf-export-invalid-body"
    );
  }

  const [scaleX, scaleZ] = sketchPlaneScale(body);
  // Availability already refused a non-uniform in-plane scale; this keeps the
  // invariant local rather than trusting a caller that skipped the check.
  if (Math.abs(scaleX - scaleZ) > 1e-9) {
    throw new PartDxfExportError("DXF cannot apply a non-uniform sketch-plane scale.", "dxf-export-unavailable");
  }

  const outerProfile = scaleProfile(body.sketch.outerProfile, scaleX);
  const cutProfiles = (body.sketch.cutProfiles ?? []).map((profile) => scaleProfile(profile, scaleX));
  const thicknessScale = Number(body?.transform?.scale?.[1]);

  const warnings = [];
  // Cut-against-cut overlap is deliberately **not** reported here. It used to be,
  // because intersecting contours are where the consequence was first felt, but it
  // is a manufacturability finding about the design rather than about this file,
  // and cycle 06 moved it to `dfm.js` so it exists in exactly one place and is
  // stated in the panel before an export is ever asked for.
  // Reported off the unscaled sketch: a pocket's presence is a property of the
  // hole spec, not of the placement scale applied to the contours.
  const pocketed = sketchHolePockets(body.sketch);
  const pocketWarning = detectHolePocketsMissingFromDxf(body.sketch);
  if (pocketWarning) warnings.push(pocketWarning);

  return {
    entities: [
      ...profileEntities(OUTER_LAYER, outerProfile),
      ...cutProfiles.flatMap((profile) => profileEntities(CUT_LAYER, profile))
    ],
    contourCount: 1 + cutProfiles.length,
    pocketedHoleIds: pocketed.map(({ profile }) => profile.id),
    extents: sketchExtents([outerProfile, ...cutProfiles]),
    placementScale: scaleX,
    // Stated, never applied: DXF is a 2D cut path and the thickness is the stock.
    materialThicknessMm: Number(body.extrudeDepthMm) * (Number.isFinite(thicknessScale) && thicknessScale > 0 ? thicknessScale : 1),
    warnings
  };
}

function headerSection(extents) {
  return [
    pair(0, "SECTION"),
    pair(2, "HEADER"),
    pair(9, "$ACADVER"),
    pair(1, "AC1009"),
    // 4 is millimetres, 1 is metric. Together they stop a reader defaulting to
    // inches and scaling a 120 mm plate to 3 metres.
    pair(9, "$INSUNITS"),
    pair(70, "4"),
    pair(9, "$MEASUREMENT"),
    pair(70, "1"),
    pair(9, "$LUNITS"),
    pair(70, "2"),
    pair(9, "$EXTMIN"),
    pair(10, coordinate(extents.min[0])),
    pair(20, coordinate(extents.min[1])),
    pair(30, "0.0"),
    pair(9, "$EXTMAX"),
    pair(10, coordinate(extents.max[0])),
    pair(20, coordinate(extents.max[1])),
    pair(30, "0.0"),
    pair(0, "ENDSEC")
  ];
}

function layerRecord(name, colorNumber) {
  return [
    pair(0, "LAYER"),
    pair(2, name),
    pair(70, "0"),
    pair(62, String(colorNumber)),
    pair(6, "CONTINUOUS")
  ];
}

/**
 * R12 readers reject an entity on a layer the `LAYER` table does not declare, so
 * the table is required rather than decorative. Layer `0` is always present.
 */
function tablesSection() {
  return [
    pair(0, "SECTION"),
    pair(2, "TABLES"),
    pair(0, "TABLE"),
    pair(2, "LAYER"),
    pair(70, "3"),
    ...layerRecord("0", 7),
    ...layerRecord(OUTER_LAYER, 7),
    ...layerRecord(CUT_LAYER, 1),
    pair(0, "ENDTAB"),
    pair(0, "ENDSEC")
  ];
}

/** DXF R12 ASCII text for a plan from `bodyDxfPlan`. */
export function serializeDxfPlan(plan) {
  const lines = [
    ...headerSection(plan.extents),
    ...tablesSection(),
    pair(0, "SECTION"),
    pair(2, "ENTITIES"),
    ...plan.entities,
    pair(0, "ENDSEC"),
    pair(0, "EOF")
  ];
  // DXF is line-oriented and CRLF is what the format was written for; readers
  // accept LF, but CRLF is what every reference file uses.
  return `${lines.flat().join("\r\n")}\r\n`;
}

/**
 * DXF R12 ASCII for one sketch body, with the plan that produced it.
 *
 * Throws `PartDxfExportError` when the body cannot be honestly exported.
 */
export function bodyDxfDocument(body) {
  const plan = bodyDxfPlan(body);
  return { dxf: serializeDxfPlan(plan), plan };
}

/** DXF R12 ASCII for one sketch body. Throws `PartDxfExportError` if refused. */
export function serializeBodyToDxf(body) {
  return bodyDxfDocument(body).dxf;
}
