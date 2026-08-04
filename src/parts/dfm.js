/**
 * Manufacturability: which features a chosen process cannot make.
 *
 * ## The boundary this module exists to hold
 *
 * `src/parts/validation.js` is schema checking - finite numbers, closed loops,
 * cuts inside the outline - and `validateBody` is a **hard compile gate**:
 * `cadCompile.js` refuses to compile a body whose issue list is non-empty at any
 * severity, and four call sites in `src/parts.js` read an empty list as permission
 * to compile, export and hand off. A 0.4 mm wall passes that gate, because a
 * 0.4 mm wall is perfectly valid JSON describing perfectly valid geometry. It is
 * simply not a thing a 0.4 mm nozzle can print.
 *
 * So `validateManufacturability` shares `createIssue`'s shape with `validateBody`
 * and **never shares its array**. Nothing here can block a compile, an export or a
 * handoff, and `tests/parts/sketchValidation.test.js` stands as the regression
 * that says so. `severity` on a finding ranks it for the reader; it gates nothing.
 *
 * ## Where it runs, and why not in the worker
 *
 * Every rule below is closed-form over the exact 2D sketch, the resolved hole
 * specs, and two scalars - `extrudeDepthMm` and the material. **Not one of them
 * needs the compiled solid**, which is why this runs on the main thread beside the
 * inspector rather than in the CAD worker beside the disconnected-solid and
 * watertight reports. A warning about a wall should not cost a compile, and a body
 * that fails to compile should still be able to say why it was unmakeable.
 *
 * Each entry in `DFM_RULES` declares its `substrate`, and `dfm.test.js` asserts
 * that none of them claims to need a solid. If a future rule does, that assertion
 * is the place the decision gets re-made.
 *
 * ## How a wall is measured
 *
 * The obvious route is morphological: erode the region by half the minimum wall,
 * dilate it back, and compare areas. `expansions.offset` is present and the meta
 * plan suggests it. It was tried and rejected on evidence: JSCAD's `offset` does
 * not resolve self-intersections on a composite `geom2`, so a plate with two holes
 * 0.4 mm apart round-trips through an open with **zero** area loss - the two
 * dilated holes pass through one another instead of merging - and a region thinner
 * than the erosion depth comes back with a negative area. An opening also answers
 * only "yes or no", where the acceptance criteria ask every finding to state the
 * measured value.
 *
 * So walls are measured as distances between profile boundaries, and every profile
 * this page has is exactly a **core swept by a disc**: a circle is a point with a
 * radius, a rounded slot is a segment with a radius, a rounded rectangle is an
 * inset rectangle with a radius, and a polyline is itself with a radius of zero.
 * The gap between two cut profiles is therefore the distance between their cores
 * minus both radii, which is exact - no tessellation, no sampling.
 *
 * The one exception is the outer profile, whose boundary is taken from
 * `profileToGeom2` and `geom2.toOutlines`, so a wall against a rounded corner is
 * measured against the same tessellation the compiler builds and the preview
 * shows. That costs at most the 0.02 mm chord tolerance from `tessellation.js`,
 * and it errs toward reporting: an inscribed arc sits inside the true one, so the
 * measured wall is the smaller of the two.
 *
 * ## Print orientation
 *
 * Two rules need to know which way up the part is printed. The assumption is the
 * one `orientSolidToPartPlane` already produces and the one a plate is printed in:
 * the sketch plane lies on the bed and +Y is up, so the `bottom` face is down.
 * It is a profile parameter (`bedFace`) rather than a constant, so a user who
 * prints the part on edge can clear it and the two rules fall silent.
 *
 * The module is DOM-free and runs under `node:test`.
 */

import jscad from "@jscad/modeling";
import { profileToGeom2 } from "./cadCompile.js";
import { SKETCH_EXTRUDE_KIND, SPUR_GEAR_KIND } from "./contracts.js";
import { spurGearGeometry } from "./gears.js";
import { profileHoleResolution, sketchHolePockets } from "./holes.js";
import { createIssue } from "./issues.js";
import { getMaterial, normalizeMaterialId } from "./materials.js";
import {
  effectiveMinFeatureMm,
  effectiveMinWallMm,
  normalizeProcessId,
  resolveProcessProfile
} from "./process.js";
import { minEdgeDistanceMm } from "./standards/fasteners.js";

const { intersect } = jscad.booleans;
const { measureArea } = jscad.measurements;
const { geom2 } = jscad.geometries;

export const DFM_MIN_WALL = "dfm-min-wall";
export const DFM_MIN_FEATURE = "dfm-min-feature";
export const DFM_HOLE_EDGE_DISTANCE = "dfm-hole-edge-distance";
export const DFM_UNSUPPORTED_OVERHANG = "dfm-unsupported-overhang";
export const DFM_BRIDGE_SPAN = "dfm-bridge-span";
export const DFM_THIN_WEB_UNDER_POCKET = "dfm-thin-web-under-pocket";
export const DFM_POCKET_UNSUPPORTED = "dfm-pocket-unsupported-by-process";
export const DFM_OVERLAPPING_CUTS = "dfm-overlapping-cut-profiles";
export const DFM_DEEP_HOLE = "dfm-deep-hole";
export const DFM_INTERNAL_CORNER_RADIUS = "dfm-internal-corner-radius";
export const DFM_THREAD_ENGAGEMENT = "dfm-thread-engagement";
export const DFM_STOCK_THICKNESS = "dfm-stock-thickness";
export const DFM_STOCK_NOT_STOCKED = "dfm-stock-thickness-not-stocked";
export const DFM_MATERIAL_PROCESS = "dfm-material-not-made-by-process";
export const DFM_LASER_UNSAFE_MATERIAL = "dfm-laser-unsafe-material";
export const DFM_UNVERIFIED_DIMENSION = "dfm-unverified-dimension";
export const DFM_GEAR_UNDERCUT = "dfm-gear-undercut";
export const DFM_GEAR_DEGENERATE_TOOTH = "dfm-gear-degenerate-tooth";
export const DFM_SOURCE_KIND_UNCHECKED = "dfm-source-kind-unchecked";

/** Smallest overlap area, in mm2, worth reporting between two cut profiles. */
const OVERLAP_AREA_EPSILON_MM2 = 1e-6;
/** Below this, a measured gap and its threshold are the same number. */
const MEASUREMENT_EPSILON_MM = 1e-9;
/** How many offending features a finding names before it stops listing them. */
const NAMED_LIMIT = 3;

function mm(value, digits = 2) {
  return Number(value).toFixed(digits).replace(/\.?0+$/u, "") || "0";
}

/**
 * A number, or `null`.
 *
 * The `== null` guard is load-bearing rather than defensive: a profile states "no
 * such limit" as `null`, and `Number(null)` is `0`, so a bare `Number.isFinite`
 * would turn every absent maximum into a maximum of zero and report every body.
 *
 * No shared equivalent: `isFiniteNumber` (`contracts.js`) answers yes/no and
 * `asFiniteNumber` substitutes a fallback, and this needs the third answer - the number,
 * or nothing. Distinct too from `massProperties.js`'s `finiteOrNull`, which refuses to
 * coerce at all; here a profile field arriving as a string is still a limit.
 *
 * The name is a known trap and is kept anyway: `validation.js` imports `isFiniteNumber`
 * **as** `finite`, so the same name returns a boolean there and a value here. Renaming
 * costs eleven call-site rewrites in the manufacturability engine, which is the one thing
 * cycle 01's invariant 3 says buys nothing - rewritten call sites give up the cheap proof
 * that a refactor changed nothing. Worth doing in a cycle that is allowed a diff here;
 * not worth doing for a name.
 */
function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/* ------------------------------------------------------------------ geometry */

function pointSegmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function segmentsCross(a, b) {
  const [ax, az, bx, bz] = a;
  const [cx, cz, dx, dz] = b;
  const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(denominator) < 1e-15) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Minimum distance between two segments, zero when they cross. */
function segmentDistance(a, b) {
  if (segmentsCross(a, b)) return 0;
  return Math.min(
    pointSegmentDistance(a[0], a[1], b[0], b[1], b[2], b[3]),
    pointSegmentDistance(a[2], a[3], b[0], b[1], b[2], b[3]),
    pointSegmentDistance(b[0], b[1], a[0], a[1], a[2], a[3]),
    pointSegmentDistance(b[2], b[3], a[0], a[1], a[2], a[3])
  );
}

function polygonSegments(points) {
  const segments = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    segments.push([Number(current[0]), Number(current[1]), Number(next[0]), Number(next[1])]);
  }
  return segments;
}

function polylinePoints(profile) {
  const points = (profile?.points ?? []).map((point) => [Number(point[0]), Number(point[1])]);
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1] && points.length > 1) points.pop();
  return points;
}

/**
 * A profile as a core swept by a disc, which is exact for every profile type.
 *
 * | Profile | Core | Radius |
 * |---|---|---|
 * | `circle` | its centre | its radius |
 * | `roundedSlot` | the straight segment between the two arc centres | half the width |
 * | `rectangle` | the rectangle inset by the corner radius | the corner radius |
 * | `polyline` | itself | zero |
 *
 * The distance between two disjoint profiles' boundaries is then the distance
 * between their cores minus both radii, with no tessellation anywhere.
 */
export function profileCore(profile) {
  if (!profile) return null;

  if (profile.type === "circle") {
    const x = Number(profile.x);
    const z = Number(profile.z);
    return { segments: [[x, z, x, z]], radiusMm: Math.abs(Number(profile.radius)) };
  }

  if (profile.type === "roundedSlot") {
    const x = Number(profile.x);
    const z = Number(profile.z);
    const radiusMm = Math.abs(Number(profile.width)) / 2;
    const half = Math.max(0, Math.abs(Number(profile.length)) / 2 - radiusMm);
    return { segments: [[x - half, z, x + half, z]], radiusMm };
  }

  if (profile.type === "polyline") {
    const points = polylinePoints(profile);
    if (points.length < 3) return null;
    return { segments: polygonSegments(points), radiusMm: 0 };
  }

  const x = Number(profile.x);
  const z = Number(profile.z);
  const width = Math.abs(Number(profile.width));
  const height = Math.abs(Number(profile.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const radiusMm = Math.min(Math.max(0, Number(profile.cornerRadius ?? 0)), Math.min(width, height) / 2);
  const halfWidth = width / 2 - radiusMm;
  const halfHeight = height / 2 - radiusMm;
  return {
    segments: polygonSegments([
      [x - halfWidth, z - halfHeight],
      [x + halfWidth, z - halfHeight],
      [x + halfWidth, z + halfHeight],
      [x - halfWidth, z + halfHeight]
    ]),
    radiusMm
  };
}

/** Distance between two profiles' boundaries. Negative when they overlap. */
export function profileGapMm(first, second) {
  const a = profileCore(first);
  const b = profileCore(second);
  if (!a || !b) return null;
  let closest = Infinity;
  for (const segmentA of a.segments) {
    for (const segmentB of b.segments) {
      closest = Math.min(closest, segmentDistance(segmentA, segmentB));
      if (closest === 0) break;
    }
  }
  if (!Number.isFinite(closest)) return null;
  return closest - a.radiusMm - b.radiusMm;
}

/**
 * The narrowest dimension of a profile: its own minimum wall, or - read as a void -
 * the smallest feature it asks a tool to make.
 *
 * For a polyline this is the minimum distance from a vertex to a non-incident
 * edge, which is the polygon's narrowest neck and, for a triangle, its shortest
 * altitude. That catches a hand-drawn outline with a thin waist, which a
 * bounding-box reading would miss entirely.
 */
export function profileNarrowestMm(profile) {
  if (!profile) return null;
  if (profile.type === "circle") return Math.abs(Number(profile.radius)) * 2;
  if (profile.type === "roundedSlot") return Math.abs(Number(profile.width));
  if (profile.type === "polyline") {
    const points = polylinePoints(profile);
    if (points.length < 3) return null;
    const segments = polygonSegments(points);
    let narrowest = Infinity;
    for (const [vertex, point] of points.entries()) {
      for (const [index, segment] of segments.entries()) {
        // Segment `index` runs from vertex `index` to `index + 1`, so the two
        // segments meeting at this vertex are skipped: their distance is zero.
        if (index === vertex || index === (vertex - 1 + points.length) % points.length) continue;
        narrowest = Math.min(narrowest, pointSegmentDistance(point[0], point[1], ...segment));
      }
    }
    return Number.isFinite(narrowest) ? narrowest : null;
  }
  const width = Math.abs(Number(profile.width));
  const height = Math.abs(Number(profile.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return Math.min(width, height);
}

/**
 * The outer profile's boundary as tessellated closed outlines.
 *
 * Taken from `profileToGeom2` so a wall against a rounded corner is measured
 * against the region the compiler actually builds, rather than against an
 * idealised arc the preview never shows.
 */
function outerBoundarySegments(profile) {
  if (!profile) return [];
  try {
    return geom2
      .toOutlines(profileToGeom2(profile))
      .flatMap((outline) => polygonSegments(outline));
  } catch {
    // An uncompilable outer profile is `validateBody`'s problem, not this report's.
    return [];
  }
}

/** Distance from a profile's boundary to the outer boundary curve. */
function gapToBoundaryMm(profile, boundarySegments) {
  const core = profileCore(profile);
  if (!core || !boundarySegments.length) return null;
  let closest = Infinity;
  for (const segment of core.segments) {
    for (const boundary of boundarySegments) {
      closest = Math.min(closest, segmentDistance(segment, boundary));
    }
  }
  return Number.isFinite(closest) ? closest - core.radiusMm : null;
}

/** Distance from a point to the outer boundary curve. */
function pointToBoundaryMm(x, z, boundarySegments) {
  let closest = Infinity;
  for (const segment of boundarySegments) {
    closest = Math.min(closest, pointSegmentDistance(x, z, ...segment));
  }
  return Number.isFinite(closest) ? closest : null;
}

/**
 * Corners in the **material** that a round tool cannot reproduce.
 *
 * A cut is a void, so the material wraps around its convex vertices; the outer
 * profile is material, so its reflex vertices are the ones that pinch inward. A
 * rectangle outer profile is therefore silent - a cutter walks around the outside
 * of an external corner - while a rectangular pocket has four.
 */
function sharpMaterialCornerCount(profile, isCut) {
  const points = polylinePoints(profile);
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  const orientation = area >= 0 ? 1 : -1;
  let count = 0;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross =
      (current[0] - previous[0]) * (next[1] - current[1]) - (current[1] - previous[1]) * (next[0] - current[0]);
    if (Math.abs(cross) < 1e-12) continue;
    const convex = cross * orientation > 0;
    if (convex === Boolean(isCut)) count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------- rules */

function dfmIssue(code, severity, message, path, extra) {
  return createIssue(code, message, path, severity, extra);
}

function namedList(entries, describe) {
  const named = entries.slice(0, NAMED_LIMIT).map(describe).join(", ");
  const remainder = entries.length - NAMED_LIMIT;
  return remainder > 0 ? `${named}, and ${remainder} more` : named;
}

function belowThreshold(measuredMm, thresholdMm) {
  return measuredMm != null && thresholdMm > 0 && measuredMm < thresholdMm - MEASUREMENT_EPSILON_MM;
}

/**
 * Cut profiles that overlap one another.
 *
 * Moved here from `exporters/dxf.js`, where it lived because that is where the
 * consequence was first felt, and it now exists in exactly one place. Two
 * overlapping cuts merge into one opening in the solid while a one-contour-per-
 * profile exporter emits two intersecting paths, and `validateBody` checks each
 * cut against the outer profile but never against another cut - so nothing else on
 * this page notices.
 *
 * The test is exact over the compiled 2D regions, with a bounds rejection first so
 * a bolt circle does not pay for a full pairwise boolean sweep.
 */
export function detectOverlappingCutProfiles(sketch, options = {}) {
  const cuts = Array.isArray(sketch?.cutProfiles) ? sketch.cutProfiles : [];
  if (cuts.length < 2) return null;

  const cores = cuts.map(profileCore);
  const pairs = [];

  for (let first = 0; first < cuts.length; first += 1) {
    for (let second = first + 1; second < cuts.length; second += 1) {
      const gap = cores[first] && cores[second] ? profileGapMm(cuts[first], cuts[second]) : 0;
      if (gap != null && gap > 0) continue;
      try {
        const area = Math.abs(measureArea(intersect(profileToGeom2(cuts[first]), profileToGeom2(cuts[second]))));
        if (area > OVERLAP_AREA_EPSILON_MM2) pairs.push([cuts[first].id, cuts[second].id]);
      } catch {
        // An uncompilable pair is the compile path's problem, not this report's.
      }
    }
  }

  if (!pairs.length) return null;

  return dfmIssue(
    DFM_OVERLAPPING_CUTS,
    "warning",
    `${pairs.length} cut pair${pairs.length === 1 ? "" : "s"} overlap (${namedList(pairs, ([a, b]) => `${a} and ${b}`)}), so they merge into one opening in the solid while a one-contour-per-profile export such as DXF emits intersecting paths.`,
    options.path ?? "sketch.cutProfiles",
    { pairCount: pairs.length, pairs }
  );
}

function minWallRule(context) {
  const { sketch, processProfile, thicknessMm, path } = context;
  const thresholdMm = effectiveMinWallMm(processProfile, thicknessMm);
  if (!(thresholdMm > 0)) return null;

  const measurements = [];
  const outerNarrowest = profileNarrowestMm(sketch.outerProfile);
  if (belowThreshold(outerNarrowest, thresholdMm)) {
    measurements.push({ featureIds: [sketch.outerProfile.id], measuredMm: outerNarrowest, between: "outline" });
  }

  for (const cut of sketch.cutProfiles) {
    const gap = gapToBoundaryMm(cut, context.outerBoundarySegments);
    // A gap of zero is a cut that meets the outline, which is an **opening** and
    // not a wall of no thickness - the U bracket's slot is exactly this, and
    // reporting it would tell the author their part is unmakeable because it has
    // the shape they drew. A cut that crosses the outline is `validateBody`'s
    // `cut-outside-outer-profile`, a hard gate this report never sees.
    if (gap == null || gap <= 0 || !belowThreshold(gap, thresholdMm)) continue;
    measurements.push({
      featureIds: [cut.id, sketch.outerProfile?.id].filter(Boolean),
      measuredMm: gap,
      between: "cut-to-edge"
    });
  }

  for (let first = 0; first < sketch.cutProfiles.length; first += 1) {
    for (let second = first + 1; second < sketch.cutProfiles.length; second += 1) {
      const gap = profileGapMm(sketch.cutProfiles[first], sketch.cutProfiles[second]);
      // A non-positive gap is an overlap, which `detectOverlappingCutProfiles`
      // owns. Reporting it here as a zero-thickness wall would say the same thing
      // twice in different words.
      if (gap == null || gap <= 0 || !belowThreshold(gap, thresholdMm)) continue;
      measurements.push({
        featureIds: [sketch.cutProfiles[first].id, sketch.cutProfiles[second].id],
        measuredMm: gap,
        between: "cut-to-cut"
      });
    }
  }

  if (!measurements.length) return null;
  measurements.sort((a, b) => a.measuredMm - b.measuredMm);

  return dfmIssue(
    DFM_MIN_WALL,
    "warning",
    `${measurements.length} wall${measurements.length === 1 ? " is" : "s are"} thinner than the ${mm(thresholdMm)} mm minimum for ${processProfile.label}: ${namedList(measurements, (entry) => `${entry.featureIds.join(" to ")} at ${mm(entry.measuredMm)} mm`)}.`,
    path,
    { thresholdMm, worstMm: measurements[0].measuredMm, measurements }
  );
}

function minFeatureRule(context) {
  const { sketch, processProfile, thicknessMm, path } = context;
  const thresholdMm = effectiveMinFeatureMm(processProfile, thicknessMm);
  if (!(thresholdMm > 0)) return null;

  const measurements = [];
  for (const cut of sketch.cutProfiles) {
    const narrowest = profileNarrowestMm(cut);
    if (belowThreshold(narrowest, thresholdMm)) {
      measurements.push({ featureIds: [cut.id], measuredMm: narrowest });
    }
  }
  if (!measurements.length) return null;
  measurements.sort((a, b) => a.measuredMm - b.measuredMm);

  return dfmIssue(
    DFM_MIN_FEATURE,
    "warning",
    `${measurements.length} cut${measurements.length === 1 ? " is" : "s are"} narrower than the ${mm(thresholdMm)} mm smallest feature ${processProfile.label} can make: ${namedList(measurements, (entry) => `${entry.featureIds[0]} at ${mm(entry.measuredMm)} mm`)}.`,
    path,
    { thresholdMm, worstMm: measurements[0].measuredMm, measurements }
  );
}

/**
 * Fastener edge distance, from the hole's own size.
 *
 * The threshold is `minEdgeDistanceMm` for the resolved fastener - never a literal
 * and never inferred from a radius, which is what having a `hole` field is for.
 *
 * **A cut with no resolved `hole` is deliberately not reported here.** Edge
 * distance is a statement about a clamped fastener tearing out through the edge,
 * and a plain circle has no fastener to state it for. The material between such a
 * cut and the edge is still checked - by `dfm-min-wall`, which measures it as the
 * wall it is. Guessing an M3 from a 1.7 mm radius would put a fastener in the
 * finding that the design never asked for.
 */
function holeEdgeDistanceRule(context) {
  const { sketch, processProfile, path } = context;
  const factor = Number(processProfile.holeEdgeDistanceFactor);
  if (!(factor > 0)) return null;

  const measurements = [];
  for (const cut of sketch.cutProfiles) {
    const resolved = profileHoleResolution(cut);
    if (!resolved?.ok) continue;
    const practiceMm = minEdgeDistanceMm(resolved.spec.size);
    if (practiceMm == null) continue;
    const thresholdMm = practiceMm * factor;
    const measuredMm = pointToBoundaryMm(Number(cut.x), Number(cut.z), context.outerBoundarySegments);
    if (!belowThreshold(measuredMm, thresholdMm)) continue;
    measurements.push({ featureIds: [cut.id], size: resolved.spec.size, measuredMm, thresholdMm });
  }
  if (!measurements.length) return null;
  measurements.sort((a, b) => a.measuredMm - a.thresholdMm - (b.measuredMm - b.thresholdMm));

  return dfmIssue(
    DFM_HOLE_EDGE_DISTANCE,
    "warning",
    `${measurements.length} fastener hole${measurements.length === 1 ? " sits" : "s sit"} closer to the outline than the practice minimum of 1.5 nominal diameters: ${namedList(measurements, (entry) => `${entry.featureIds[0]} (${entry.size}) centre ${mm(entry.measuredMm)} mm from the edge against ${mm(entry.thresholdMm)} mm`)}.`,
    path,
    { edgeDistanceFactor: factor, measurements }
  );
}

/**
 * A sloped pocket roof printed over air.
 *
 * Only pockets cut from the bed face have a roof at all, and only a **sloped** one
 * is an overhang: a flat roof is reported by `dfm-bridge-span` instead, so the two
 * rules partition the cases rather than both firing on a counterbore.
 *
 * A 90-degree-included countersink gives a 45-degree wall, which sits exactly on
 * the usual FDM limit and is therefore not reported at the default threshold.
 */
function unsupportedOverhangRule(context) {
  const { processProfile, path, pockets } = context;
  const limitDeg = finite(processProfile.maxOverhangAngleDeg);
  const bedFace = context.bedFace;
  if (limitDeg == null || !bedFace) return null;

  const measurements = [];
  for (const { profile, pocket } of pockets) {
    if (pocket.fromFace !== bedFace || pocket.shape !== "cone") continue;
    const angleDeg = Number(pocket.includedAngleDeg) / 2;
    if (!Number.isFinite(angleDeg) || angleDeg <= limitDeg) continue;
    measurements.push({ featureIds: [profile.id], style: pocket.style, measuredDeg: angleDeg });
  }
  if (!measurements.length) return null;

  return dfmIssue(
    DFM_UNSUPPORTED_OVERHANG,
    "warning",
    `${measurements.length} pocket roof${measurements.length === 1 ? "" : "s"} on the ${bedFace} face slope${measurements.length === 1 ? "s" : ""} past the ${mm(limitDeg, 1)} degree unsupported limit: ${namedList(measurements, (entry) => `${entry.featureIds[0]} (${entry.style}) at ${mm(entry.measuredDeg, 1)} degrees from vertical`)}.`,
    path,
    { thresholdDeg: limitDeg, bedFace, measurements }
  );
}

/**
 * A flat pocket roof printed over air.
 *
 * The unsupported run is half the difference between the pocket's mouth and its
 * pilot: the roof is an annular ledge anchored on the pocket wall, and the pilot in
 * the middle is a hole, so it supports nothing. `maxBridgeSpanMm` is the profile
 * parameter the meta plan requires - printer and cooling dependent, never a
 * constant - and it is read here and nowhere else.
 */
function bridgeSpanRule(context) {
  const { processProfile, path, pockets } = context;
  const limitMm = finite(processProfile.maxBridgeSpanMm);
  const bedFace = context.bedFace;
  if (limitMm == null || !bedFace) return null;

  const measurements = [];
  for (const { profile, pocket, resolved } of pockets) {
    if (pocket.fromFace !== bedFace || pocket.shape === "cone") continue;
    const mouthMm = pocket.shape === "hexPrism" ? Number(pocket.acrossCornersMm) : Number(pocket.diameterMm);
    const pilotMm = Number(resolved.pilotDiameterMm);
    if (!Number.isFinite(mouthMm) || !Number.isFinite(pilotMm)) continue;
    const measuredMm = (mouthMm - pilotMm) / 2;
    if (!(measuredMm > limitMm + MEASUREMENT_EPSILON_MM)) continue;
    measurements.push({ featureIds: [profile.id], style: pocket.style, measuredMm });
  }
  if (!measurements.length) return null;
  measurements.sort((a, b) => b.measuredMm - a.measuredMm);

  return dfmIssue(
    DFM_BRIDGE_SPAN,
    "warning",
    `${measurements.length} flat pocket roof${measurements.length === 1 ? "" : "s"} on the ${bedFace} face reach${measurements.length === 1 ? "es" : ""} further over air than the ${mm(limitMm)} mm limit for ${processProfile.label}: ${namedList(measurements, (entry) => `${entry.featureIds[0]} (${entry.style}) at ${mm(entry.measuredMm)} mm`)}. The limit is printer and cooling dependent; set it for your machine rather than trusting the default.`,
    path,
    { thresholdMm: limitMm, bedFace, measurements }
  );
}

/**
 * The material left under a blind pocket.
 *
 * `extrudeDepthMm` is the **stock** thickness, not the material thickness
 * everywhere: cycle 05's post-extrude cutter stage means a body under a counterbore
 * is thinner than the sketch suggests. The reported figure is therefore
 * `extrudeDepthMm` minus the pocket depth, which is the material that is really
 * there.
 *
 * A pocket that reaches the far face is not reported here. That is breakthrough,
 * it already rides on the compile result as `hole-pocket-breaks-through`, and
 * saying it twice in two vocabularies helps nobody.
 */
function thinWebUnderPocketRule(context) {
  const { processProfile, thicknessMm, path, pockets } = context;
  if (!pockets.length) return null;

  if (processProfile.pocketsSupported === false) {
    return dfmIssue(
      DFM_POCKET_UNSUPPORTED,
      "error",
      `${processProfile.label} cuts through the stock or not at all, so it cannot make ${pockets.length} blind pocket${pockets.length === 1 ? "" : "s"}: ${namedList(pockets, ({ profile, pocket }) => `${profile.id} (${pocket.style})`)}. The through pilot is makeable; the pocket is a separate operation.`,
      path,
      { pocketCount: pockets.length, profileIds: pockets.map(({ profile }) => profile.id) }
    );
  }

  const thresholdMm = Number(processProfile.minWebUnderPocketMm);
  if (!(thresholdMm > 0)) return null;
  const stockMm = finite(thicknessMm);
  if (stockMm == null) return null;

  const measurements = [];
  for (const { profile, pocket } of pockets) {
    const webMm = stockMm - Number(pocket.depthMm);
    if (!(webMm > 0) || !belowThreshold(webMm, thresholdMm)) continue;
    measurements.push({
      featureIds: [profile.id],
      style: pocket.style,
      measuredMm: webMm,
      stockThicknessMm: stockMm,
      pocketDepthMm: Number(pocket.depthMm)
    });
  }
  if (!measurements.length) return null;
  measurements.sort((a, b) => a.measuredMm - b.measuredMm);

  return dfmIssue(
    DFM_THIN_WEB_UNDER_POCKET,
    "warning",
    `${measurements.length} pocket${measurements.length === 1 ? " leaves" : "s leave"} less material under it than the ${mm(thresholdMm)} mm minimum for ${processProfile.label}: ${namedList(measurements, (entry) => `${entry.featureIds[0]} (${entry.style}) leaves ${mm(entry.measuredMm)} mm, the ${mm(entry.stockThicknessMm)} mm stock less a ${mm(entry.pocketDepthMm)} mm pocket`)}.`,
    path,
    { thresholdMm, worstMm: measurements[0].measuredMm, measurements }
  );
}

function deepHoleRule(context) {
  const { sketch, processProfile, thicknessMm, path } = context;
  const limit = finite(processProfile.maxHoleDepthRatio);
  const depthMm = finite(thicknessMm);
  if (limit == null || depthMm == null || !(limit > 0)) return null;

  const measurements = [];
  for (const cut of sketch.cutProfiles) {
    const narrowest = profileNarrowestMm(cut);
    if (!(narrowest > 0)) continue;
    const ratio = depthMm / narrowest;
    if (!(ratio > limit + MEASUREMENT_EPSILON_MM)) continue;
    measurements.push({ featureIds: [cut.id], measuredRatio: ratio, widthMm: narrowest, depthMm });
  }
  if (!measurements.length) return null;
  measurements.sort((a, b) => b.measuredRatio - a.measuredRatio);

  return dfmIssue(
    DFM_DEEP_HOLE,
    "warning",
    `${measurements.length} cut${measurements.length === 1 ? " is" : "s are"} deeper than ${mm(limit, 1)} times their width, past what ${processProfile.label} reaches without pecking or an extended holder: ${namedList(measurements, (entry) => `${entry.featureIds[0]} at ${mm(entry.measuredRatio, 1)} to 1 (${mm(entry.depthMm)} mm deep, ${mm(entry.widthMm)} mm wide)`)}.`,
    path,
    { thresholdRatio: limit, measurements }
  );
}

function internalCornerRadiusRule(context) {
  const { sketch, processProfile, path } = context;
  const thresholdMm = Number(processProfile.minInternalCornerRadiusMm);
  if (!(thresholdMm > 0)) return null;

  const measurements = [];
  for (const cut of sketch.cutProfiles) {
    if (cut.type === "rectangle") {
      const radius = Math.max(0, Number(cut.cornerRadius ?? 0));
      if (belowThreshold(radius, thresholdMm)) {
        measurements.push({ featureIds: [cut.id], measuredMm: radius, cornerCount: 4 });
      }
      continue;
    }
    if (cut.type !== "polyline") continue;
    const corners = sharpMaterialCornerCount(cut, true);
    if (corners) measurements.push({ featureIds: [cut.id], measuredMm: 0, cornerCount: corners });
  }

  if (sketch.outerProfile?.type === "polyline") {
    const corners = sharpMaterialCornerCount(sketch.outerProfile, false);
    if (corners) measurements.push({ featureIds: [sketch.outerProfile.id], measuredMm: 0, cornerCount: corners });
  }

  if (!measurements.length) return null;

  return dfmIssue(
    DFM_INTERNAL_CORNER_RADIUS,
    "warning",
    `${measurements.length} feature${measurements.length === 1 ? " has" : "s have"} internal corners sharper than the ${mm(thresholdMm)} mm cutter radius ${processProfile.label} needs: ${namedList(measurements, (entry) => `${entry.featureIds[0]} (${entry.cornerCount} corner${entry.cornerCount === 1 ? "" : "s"} at ${mm(entry.measuredMm)} mm)`)}. The cutter will leave its own radius there.`,
    path,
    { thresholdMm, measurements }
  );
}

function threadEngagementRule(context) {
  const { sketch, processProfile, thicknessMm, path } = context;
  const diameters = Number(processProfile.minThreadEngagementDiameters);
  const depthMm = finite(thicknessMm);
  if (!(diameters > 0) || depthMm == null) return null;

  const measurements = [];
  for (const cut of sketch.cutProfiles) {
    const resolved = profileHoleResolution(cut);
    if (!resolved?.ok || resolved.spec.style !== "tapped") continue;
    const thresholdMm = Number(resolved.nominalMm) * diameters;
    if (!belowThreshold(depthMm, thresholdMm)) continue;
    measurements.push({ featureIds: [cut.id], size: resolved.spec.size, measuredMm: depthMm, thresholdMm });
  }
  if (!measurements.length) return null;

  return dfmIssue(
    DFM_THREAD_ENGAGEMENT,
    "warning",
    `${measurements.length} tapped hole${measurements.length === 1 ? " has" : "s have"} less thread engagement than the ${mm(diameters, 1)} nominal diameters ${processProfile.label} needs to hold: ${namedList(measurements, (entry) => `${entry.featureIds[0]} (${entry.size}) engages ${mm(entry.measuredMm)} mm against ${mm(entry.thresholdMm)} mm`)}.`,
    path,
    { engagementDiameters: diameters, measurements }
  );
}

function stockThicknessRule(context) {
  const { processProfile, thicknessMm, material, path } = context;
  const stockMm = finite(thicknessMm);
  if (stockMm == null) return null;

  const minMm = finite(processProfile.minStockThicknessMm);
  const maxMm = finite(processProfile.maxStockThicknessMm);
  if (minMm != null && stockMm < minMm - MEASUREMENT_EPSILON_MM) {
    return dfmIssue(
      DFM_STOCK_THICKNESS,
      "warning",
      `The ${mm(stockMm)} mm thickness is below the ${mm(minMm)} mm minimum ${processProfile.label} works in.`,
      path,
      { thresholdMm: minMm, measuredMm: stockMm, bound: "min" }
    );
  }
  if (maxMm != null && stockMm > maxMm + MEASUREMENT_EPSILON_MM) {
    return dfmIssue(
      DFM_STOCK_THICKNESS,
      "warning",
      `The ${mm(stockMm)} mm thickness is above the ${mm(maxMm)} mm maximum ${processProfile.label} cuts through.`,
      path,
      { thresholdMm: maxMm, measuredMm: stockMm, bound: "max" }
    );
  }

  // A material that publishes a stock list is bought as sheet, so a thickness
  // between two sheets means somebody has to machine it down.
  const stocked = material?.stockThicknessesMm ?? null;
  if (!stocked?.length) return null;
  if (stocked.some((value) => Math.abs(value - stockMm) <= 0.01)) return null;

  return dfmIssue(
    DFM_STOCK_NOT_STOCKED,
    "info",
    `${material.label} is stocked at ${stocked.join(", ")} mm, and this body is ${mm(stockMm)} mm. Nothing here is unmakeable; the stock has to be machined down or the thickness changed.`,
    path,
    { measuredMm: stockMm, stockThicknessesMm: [...stocked] }
  );
}

function materialProcessRule(context) {
  const { processProfile, processId, material, path } = context;
  if (!material) return null;

  if (processId === "laser" && material.laserSafe === false) {
    // The material note is quoted only when it is actually about cutting this
    // material, so a hazard warning never carries an unrelated sentence about
    // layer adhesion as if it were the reason.
    const reason = /laser/iu.test(material.note ?? "") ? ` ${material.note}` : "";
    return dfmIssue(
      DFM_LASER_UNSAFE_MATERIAL,
      "error",
      `${material.label} must not be laser cut.${reason}`,
      path,
      { materialId: material.id, processId }
    );
  }

  if (material.processes.includes(processId)) return null;
  return dfmIssue(
    DFM_MATERIAL_PROCESS,
    "warning",
    `${material.label} is not listed for ${processProfile.label}; this build holds it for ${material.processes.join(", ")}. Nothing here measures the geometry - the material and the machine simply do not go together.`,
    path,
    { materialId: material.id, processId, materialProcesses: [...material.processes] }
  );
}

/**
 * Standards dimensions the fastener table holds but flags.
 *
 * Cycle 05 emits these labelled through `provenance` and nothing consumed them.
 * A flagged value is **not a defect** - it is a published number nobody has
 * checked against a copy of the standard - so this is `info` and worded as an
 * advisory. Reporting it at warning severity would put a machined counterbore in
 * the same list as a 0.4 mm wall, which would be wrong about both.
 */
function unverifiedDimensionRule(context) {
  const { sketch, path } = context;
  const measurements = [];
  for (const cut of sketch.cutProfiles) {
    const resolved = profileHoleResolution(cut);
    if (!resolved?.ok || !resolved.unverifiedDimensions.length) continue;
    measurements.push({
      featureIds: [cut.id],
      size: resolved.spec.size,
      dimensions: [...resolved.unverifiedDimensions]
    });
  }
  if (!measurements.length) return null;

  return dfmIssue(
    DFM_UNVERIFIED_DIMENSION,
    "info",
    `${measurements.length} hole${measurements.length === 1 ? " uses a dimension" : "s use dimensions"} this build publishes but flags as unchecked against the standard: ${namedList(measurements, (entry) => `${entry.featureIds[0]} (${entry.size}: ${entry.dimensions.join(", ")})`)}. The value is quoted, not invented; check it before a machined part depends on it.`,
    path,
    { measurements }
  );
}

/**
 * A gear whose root is cut away by the tool that generates it.
 *
 * Cycle 06 shipped `dfm-source-kind-unchecked` for every non-sketch body, which
 * named the gap rather than closing it. This is the third rule that closes part of
 * it, and it is the one the cycle-06 limits section predicted: undercut is
 * closed-form in tooth count, pressure angle and profile shift, so it needs neither
 * the sketch nor the solid.
 *
 * **It is a finding and not a `validateSpurGearSpec` issue, deliberately.** An
 * undercut gear is entirely manufacturable - it is what every small pinion in a
 * printed mechanism is - and it meshes. It is simply weaker at the root and loses a
 * little of its active flank. `validateBody` refuses to compile on anything it
 * holds, so routing this there would make a 12-tooth pinion impossible to preview.
 *
 * This rule reads no process-profile threshold, and that is not an oversight: the
 * undercut limit is geometry from `standards/gears.js`, the same kind of number as a
 * clearance hole diameter, and it does not change because the part is milled instead
 * of printed. The severity does not change either, which is why `substrate` is
 * `gear-spec` rather than `scalar`.
 */
function gearUndercutRule(context) {
  const geometry = context.gearGeometry;
  if (!geometry || !geometry.undercut) return null;

  const limit = geometry.undercutLimitToothCount;
  const minimumShift = geometry.minimumProfileShiftCoefficient;
  return dfmIssue(
    DFM_GEAR_UNDERCUT,
    "warning",
    `${geometry.toothCount} teeth at ${mm(geometry.pressureAngleDeg, 1)} degrees undercuts: the generating rack needs at least ${mm(limit, 2)} teeth at this pressure angle and ${mm(geometry.profileShiftCoefficient, 2)} profile shift, so the rack tip cuts into the involute near the root. The gear still meshes and prints; the root is weaker and a little active flank is lost. A profile shift of ${mm(minimumShift, 3)} or more clears it.`,
    context.path,
    {
      toothCount: geometry.toothCount,
      thresholdToothCount: limit,
      pressureAngleDeg: geometry.pressureAngleDeg,
      profileShiftCoefficient: geometry.profileShiftCoefficient,
      minimumProfileShiftCoefficient: minimumShift
    }
  );
}

/**
 * A tooth form that geometry has degenerated: a pointed tip or a pointed root.
 *
 * Both are real conditions with real causes - too much positive shift narrows the tip
 * to nothing, and a high pressure angle at a high tooth count converges the flanks
 * above the rack's root circle - and in both the generator clamps rather than
 * emitting a self-crossing profile. What it cannot do is make the land exist, so it
 * says so here. Like the undercut rule this reads no threshold: a land of zero width
 * is not a shop-practice limit, it is an absence.
 */
function gearDegenerateToothRule(context) {
  const geometry = context.gearGeometry;
  if (!geometry) return null;
  const conditions = [];
  if (geometry.tipPointed) {
    conditions.push(
      `the tip is pointed - a profile shift of ${mm(geometry.profileShiftCoefficient, 2)} puts the nominal tip radius at ${mm(geometry.nominalTipRadiusMm)} mm, past the ${mm(geometry.flankCrossingRadiusMm)} mm where the two flanks meet, so there is no top land`
    );
  }
  if (geometry.rootPointed) {
    conditions.push(
      `the root is a sharp V - at ${mm(geometry.pressureAngleDeg, 1)} degrees and ${geometry.toothCount} teeth the flanks converge at ${mm(geometry.rootCrossingRadiusMm)} mm, above the ${mm(geometry.nominalRootRadiusMm)} mm root the rack asks for, so there is no root land and the stress concentration is at a point`
    );
  }
  if (geometry.rootFilletClampedMm != null) {
    conditions.push(
      `the root fillet was reduced from ${mm(geometry.requestedRootFilletRadiusMm)} mm to ${mm(geometry.rootFilletRadiusMm)} mm to leave a root land at all`
    );
  }
  if (!conditions.length) return null;

  return dfmIssue(
    DFM_GEAR_DEGENERATE_TOOTH,
    "warning",
    `The tooth form is degenerate: ${conditions.join("; ")}.`,
    context.path,
    {
      tipPointed: geometry.tipPointed,
      rootPointed: geometry.rootPointed,
      rootFilletClampedMm: geometry.rootFilletClampedMm,
      rootLandWidthMm: geometry.rootLandWidthMm,
      tipLandWidthMm: geometry.tipLandWidthMm
    }
  );
}

/**
 * Every rule, with the substrate it reads.
 *
 * `substrate` is the cycle-06 plan's question answered per rule and kept where a
 * test can read it: `sketch-2d` is closed-form over the exact 2D region and the
 * profiles, `hole-spec` over the resolved hole standards, `gear-spec` over the
 * normalized gear parameters, `scalar` over `extrudeDepthMm`, and `material` over
 * the material table. **No rule reads `solid`**, which is why this whole module runs
 * on the main thread.
 */
export const DFM_RULES = Object.freeze([
  { id: DFM_MIN_WALL, title: "Minimum wall thickness", substrate: "sketch-2d", run: minWallRule },
  { id: DFM_MIN_FEATURE, title: "Minimum feature size", substrate: "sketch-2d", run: minFeatureRule },
  { id: DFM_HOLE_EDGE_DISTANCE, title: "Fastener edge distance", substrate: "hole-spec", run: holeEdgeDistanceRule },
  { id: DFM_UNSUPPORTED_OVERHANG, title: "Unsupported overhang", substrate: "hole-spec", run: unsupportedOverhangRule },
  { id: DFM_BRIDGE_SPAN, title: "Bridge span", substrate: "hole-spec", run: bridgeSpanRule },
  { id: DFM_THIN_WEB_UNDER_POCKET, title: "Web under a pocket", substrate: "hole-spec", run: thinWebUnderPocketRule },
  { id: DFM_OVERLAPPING_CUTS, title: "Cut against cut", substrate: "sketch-2d", run: (context) => detectOverlappingCutProfiles(context.sketch, { path: context.path }) },
  { id: DFM_DEEP_HOLE, title: "Hole depth to width", substrate: "sketch-2d", run: deepHoleRule },
  { id: DFM_INTERNAL_CORNER_RADIUS, title: "Internal corner radius", substrate: "sketch-2d", run: internalCornerRadiusRule },
  { id: DFM_THREAD_ENGAGEMENT, title: "Thread engagement", substrate: "hole-spec", run: threadEngagementRule },
  { id: DFM_STOCK_THICKNESS, title: "Stock thickness", substrate: "scalar", run: stockThicknessRule },
  { id: DFM_MATERIAL_PROCESS, title: "Material and process", substrate: "material", run: materialProcessRule },
  { id: DFM_UNVERIFIED_DIMENSION, title: "Unverified standard dimension", substrate: "hole-spec", run: unverifiedDimensionRule },
  { id: DFM_GEAR_UNDERCUT, title: "Gear undercut", substrate: "gear-spec", run: gearUndercutRule },
  { id: DFM_GEAR_DEGENERATE_TOOTH, title: "Degenerate gear tooth", substrate: "gear-spec", run: gearDegenerateToothRule }
]);

/** The process a body is made by. Persisted per body, exactly like `materialId`. */
export function bodyProcessId(body) {
  return normalizeProcessId(body?.processId);
}

/**
 * Derived gear geometry for the gear rules, or `null` if it cannot be computed.
 *
 * A spec so broken that the generator refuses is `validateBody`'s business, and this
 * report must never be the thing that throws while describing it.
 */
function gearGeometryOrNull(body) {
  try {
    return spurGearGeometry(body?.gear);
  } catch {
    return null;
  }
}

/** Human list of the rule families that did run on a non-sketch body. */
function describeRan(rules) {
  const families = new Set(rules.map((rule) => (rule.substrate === "gear-spec" ? "the gear tooth form" : rule.substrate === "material" ? "material" : "thickness")));
  const named = [...families];
  if (named.length === 1) return named[0][0].toUpperCase() + named[0].slice(1);
  const last = named.pop();
  const list = `${named.join(", ")} and ${last}`;
  return list[0].toUpperCase() + list.slice(1);
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

/**
 * Manufacturability findings for one body.
 *
 * Never call this from `validateBody`, and never merge the result into a
 * `validateBody` array. The whole point of the separation is that this list can be
 * non-empty on a body that compiles, previews, hands off and exports.
 *
 * `options.process` is a process id, a resolved profile, or omitted for the body's
 * own `processId`. `options.processOverrides` is a partial profile merged on top,
 * which is how a caller states a printer whose bridging differs from the default.
 */
export function validateManufacturability(body, options = {}) {
  const path = options.path ?? `bodies.${body?.id ?? "unknown"}`;
  const processId = typeof options.process === "string"
    ? normalizeProcessId(options.process)
    : options.process && typeof options.process === "object"
      ? normalizeProcessId(options.process.id)
      : bodyProcessId(body);
  const processProfile = resolveProcessProfile(options.process ?? processId, options.processOverrides ?? null);
  const material = getMaterial(normalizeMaterialId(body?.materialId));
  const thicknessMm = finite(body?.extrudeDepthMm);
  const sourceKind = body?.source?.kind ?? SKETCH_EXTRUDE_KIND;

  // A revolve, a gear, a boolean or a recipe has no 2D sketch to read, so the
  // sketch and hole rules have nothing to say about it. The rules that do apply run,
  // and the gap is stated rather than left as a silent pass.
  //
  // A gear is the one non-sketch kind with rules of its own, because a tooth form is
  // fully described by its spec: cycle 06 recorded "a gear DFM rule is the natural
  // third" as an opening and this is it.
  if (sourceKind !== SKETCH_EXTRUDE_KIND) {
    const context = {
      body,
      sketch: { outerProfile: null, cutProfiles: [] },
      outerBoundarySegments: [],
      pockets: [],
      gearGeometry: sourceKind === SPUR_GEAR_KIND ? gearGeometryOrNull(body) : null,
      processId,
      processProfile,
      material,
      thicknessMm,
      bedFace: null,
      path
    };
    const applicable = DFM_RULES.filter(
      (rule) => rule.substrate === "scalar" || rule.substrate === "material" || (rule.substrate === "gear-spec" && context.gearGeometry)
    );
    const issues = applicable.map((rule) => rule.run(context)).flat().filter(Boolean);
    issues.push(
      dfmIssue(
        DFM_SOURCE_KIND_UNCHECKED,
        "info",
        `Manufacturability rules that read the 2D sketch were not run: a ${sourceKind} body has no sketch. ${describeRan(applicable)} were still checked.`,
        path,
        {
          sourceKind,
          ranRules: applicable.map((rule) => rule.id),
          uncheckedRules: DFM_RULES.filter((rule) => rule.substrate === "sketch-2d" || rule.substrate === "hole-spec").map((rule) => rule.id)
        }
      )
    );
    return issues.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
  }

  const sketch = {
    outerProfile: body?.sketch?.outerProfile ?? null,
    cutProfiles: Array.isArray(body?.sketch?.cutProfiles) ? body.sketch.cutProfiles : []
  };
  if (!sketch.outerProfile) return [];

  const context = {
    body,
    sketch,
    outerBoundarySegments: outerBoundarySegments(sketch.outerProfile),
    pockets: sketchHolePockets(sketch),
    // A sketch body has no tooth form, so the gear rules see null and stand down.
    gearGeometry: null,
    processId,
    processProfile,
    material,
    thicknessMm,
    bedFace: options.bedFace !== undefined ? options.bedFace : processProfile.bedFace,
    path
  };

  const issues = [];
  for (const rule of DFM_RULES) {
    const produced = rule.run(context);
    if (!produced) continue;
    if (Array.isArray(produced)) issues.push(...produced.filter(Boolean));
    else issues.push(produced);
  }
  return issues.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
}

/** Manufacturability findings for every body in a project, tagged with the body. */
export function projectManufacturabilityIssues(project, options = {}) {
  const issues = [];
  for (const body of project?.bodies ?? []) {
    for (const issue of validateManufacturability(body, { ...options, path: `bodies.${body.id}` })) {
      issues.push({ ...issue, bodyId: body.id });
    }
  }
  return issues.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
}
