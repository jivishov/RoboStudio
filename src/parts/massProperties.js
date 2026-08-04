/**
 * Mass properties for Component Builder bodies.
 *
 * Two contracts shape this module.
 *
 * It is **density-free**. Volume, area, centroid and bounds are geometry; grams
 * are geometry times a material density. Keeping density out means the worker can
 * return these properties once and the main thread can re-apply any material to
 * them without a recompile, which is the whole reason the split exists.
 *
 * The results are **derived, never persisted**. `AGENTS.md` already states the
 * principle for recipes: persist the source, derive the output. Mass properties
 * are output, so they live in the compile cache and never on a `PartBody`.
 *
 * Two paths, chosen by how the body was built:
 *
 * - `sketchExtrude` bodies take the exact 2D path **unless a hole pocket makes the
 *   body something other than a prism**: a shoelace integral over
 *   `geom2.toOutlines` gives the area, perimeter and centroid of the compiled
 *   profile, and the extrusion turns those into volume and surface area in closed
 *   form. "Exact" means exact over the region that is actually built - the same
 *   region the preview and every exporter use - so a polygonal hole is measured as
 *   the polygon it will be, not as the circle it approximates. There is no
 *   triangulation and no float32 round trip in the answer, and area and perimeter
 *   come out as first-class numbers that later cycles (DFM, DXF) need.
 * - Every other kind is faceted geometry, so the volume comes from the divergence
 *   theorem over the triangle soup. That is exact for the mesh, and the mesh is all
 *   there is for those kinds - but only if the mesh is closed. The divergence
 *   theorem over an open surface returns a number with no meaning, so the mesh path
 *   consults `watertight.js` and reports a `null` volume rather than that number.
 *   Surface area and bounds survive, because they are well defined either way.
 *
 * The module is DOM-free: it runs in the CAD worker and under `node:test`.
 */

import jscad from "@jscad/modeling";
import { compileSketchToGeom2 } from "./cadCompile.js";
import { SKETCH_EXTRUDE_KIND } from "./contracts.js";
import { sketchHasHolePockets } from "./holes.js";
import { createBoundsTracker, finalizeBounds, includePoint } from "./meshConversion.js";
import { solidWatertightReport, triangleSoupWatertightReport } from "./watertight.js";

const { geom2, geom3 } = jscad.geometries;

export const EXACT_2D_METHOD = "exact-2d";
export const MESH_DIVERGENCE_METHOD = "mesh-divergence";

const AREA_EPSILON = 1e-9;
const VOLUME_EPSILON = 1e-9;

/**
 * A usable number, or `null`.
 *
 * Strict about the type on purpose. `Number(null)` is `0`, so a coercing version
 * turned a deliberately absent volume into a scaled zero - a fabricated number
 * standing exactly where the module promises never to guess. Every caller here
 * passes real numbers, so nothing is lost by refusing to coerce.
 *
 * Keeps its own name for that reason. `asFiniteNumber` (`contracts.js`) returns a
 * fallback where this returns `null`, and that difference *is* the absent-not-zero
 * contract this module is judged by - the fabricated `0` was found in review twice.
 * Merging it into the shared helper would reintroduce the defect by definition.
 */
function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Shoelace integral over closed 2D outlines.
 *
 * Outer outlines and hole outlines wind in opposite directions, so the signed
 * sums subtract holes without the caller separating them. Area is reported
 * unsigned; `signedAreaMm2` is kept because its sign tells the caller which way
 * the region wound.
 */
export function outlinesMassProperties(outlines = []) {
  let doubleArea = 0;
  let momentX = 0;
  let momentY = 0;
  let perimeterMm = 0;
  let pointCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const outline of outlines) {
    const points = Array.isArray(outline) ? outline : [];
    if (points.length < 3) continue;

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const x0 = Number(current[0]);
      const y0 = Number(current[1]);
      const x1 = Number(next[0]);
      const y1 = Number(next[1]);
      const cross = x0 * y1 - x1 * y0;

      doubleArea += cross;
      momentX += (x0 + x1) * cross;
      momentY += (y0 + y1) * cross;
      perimeterMm += Math.hypot(x1 - x0, y1 - y0);
      pointCount += 1;
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x0);
      maxY = Math.max(maxY, y0);
    }
  }

  const signedAreaMm2 = doubleArea / 2;
  const hasArea = Math.abs(signedAreaMm2) > AREA_EPSILON;
  const centroid = hasArea
    ? [momentX / (6 * signedAreaMm2), momentY / (6 * signedAreaMm2)]
    : [null, null];

  return {
    signedAreaMm2,
    areaMm2: Math.abs(signedAreaMm2),
    perimeterMm,
    centroid,
    pointCount,
    bounds: pointCount
      ? { min: [minX, minY], max: [maxX, maxY] }
      : { min: [0, 0], max: [0, 0] }
  };
}

/**
 * Exact mass properties for a sketch-extrude body.
 *
 * The sketch plane is X/Z and Y is thickness (`AGENTS.md`), and
 * `orientSolidToPartPlane` centres the extrusion on Y, so a 2D centroid
 * `[u, v]` becomes `[u, 0, v]` in body space.
 */
export function sketchExtrudeMassProperties(body) {
  const depthMm = Number(body?.extrudeDepthMm);
  if (!Number.isFinite(depthMm) || depthMm <= 0) return null;

  // A counterbored plate is not a prism. The whole closed form below is "profile
  // area times depth", and a post-extrude pocket removes material that the 2D
  // profile does not know about, so this path would report the volume of the plate
  // the pocket was cut from. It declines instead, and `bodyGeometryProperties`
  // hands the body to the mesh path - which measures the solid that was actually
  // built and is therefore entitled to state its volume.
  if (sketchHasHolePockets(body?.sketch)) return null;

  // Nominal, and this module takes no compensation argument at all. Cycle 09 kept the
  // compiled solid nominal, so this path and the mesh path still measure the same part
  // and the JSCAD cross-check keeps its meaning - the divergence cycle 09's plan
  // predicted between them does not arise. The as-made figures live in
  // `bodyCompensationReport`, beside the nominal ones and labelled, so nothing here has
  // to choose which of the two numbers a reader wanted.
  const flat = outlinesMassProperties(geom2.toOutlines(compileSketchToGeom2(body.sketch)));
  if (!(flat.areaMm2 > AREA_EPSILON)) return null;

  const half = depthMm / 2;
  const min = [flat.bounds.min[0], -half, flat.bounds.min[1]];
  const max = [flat.bounds.max[0], half, flat.bounds.max[1]];
  const size = max.map((value, index) => value - min[index]);

  return {
    method: EXACT_2D_METHOD,
    volumeMm3: flat.areaMm2 * depthMm,
    surfaceAreaMm2: 2 * flat.areaMm2 + flat.perimeterMm * depthMm,
    crossSectionAreaMm2: flat.areaMm2,
    perimeterMm: flat.perimeterMm,
    extrudeDepthMm: depthMm,
    centroidMm: [flat.centroid[0], 0, flat.centroid[1]],
    boundsMm: {
      min,
      max,
      size,
      center: min.map((value, index) => value + size[index] / 2)
    }
  };
}

function createTriangleAccumulator() {
  return {
    volume: 0,
    surfaceAreaMm2: 0,
    centroid: [0, 0, 0],
    triangleCount: 0,
    bounds: createBoundsTracker()
  };
}

/**
 * Divergence theorem over one triangle.
 *
 * The signed volume of the tetrahedron from the origin to the triangle is
 * `a . (b x c) / 6`; summing them over a closed surface leaves the enclosed
 * volume, with the sign following the surface orientation. The centroid is the
 * volume-weighted mean of the tetrahedron centroids `(a + b + c) / 4`.
 */
function accumulateTriangle(accumulator, a, b, c) {
  const crossX = b[1] * c[2] - b[2] * c[1];
  const crossY = b[2] * c[0] - b[0] * c[2];
  const crossZ = b[0] * c[1] - b[1] * c[0];
  const signedVolume = (a[0] * crossX + a[1] * crossY + a[2] * crossZ) / 6;

  accumulator.volume += signedVolume;
  accumulator.centroid[0] += ((a[0] + b[0] + c[0]) / 4) * signedVolume;
  accumulator.centroid[1] += ((a[1] + b[1] + c[1]) / 4) * signedVolume;
  accumulator.centroid[2] += ((a[2] + b[2] + c[2]) / 4) * signedVolume;

  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  accumulator.surfaceAreaMm2 += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  accumulator.triangleCount += 1;

  includePoint(accumulator.bounds, a);
  includePoint(accumulator.bounds, b);
  includePoint(accumulator.bounds, c);
}

function finalizeTriangleAccumulator(accumulator) {
  if (!accumulator.triangleCount) return null;
  if (!Number.isFinite(accumulator.volume) || Math.abs(accumulator.volume) <= VOLUME_EPSILON) return null;

  // Dividing by the signed volume cancels the surface orientation, so an inverted
  // mesh still reports a positive volume at the right centroid.
  const centroidMm = accumulator.centroid.map((value) => value / accumulator.volume);

  return {
    method: MESH_DIVERGENCE_METHOD,
    volumeMm3: Math.abs(accumulator.volume),
    surfaceAreaMm2: accumulator.surfaceAreaMm2,
    triangleCount: accumulator.triangleCount,
    centroidMm,
    boundsMm: finalizeBounds(accumulator.bounds)
  };
}

/**
 * Strip the volume-derived fields from a mesh measurement.
 *
 * Used when the surface is not closed. The volume itself is the obvious
 * casualty, but the centroid is divided by that volume so it goes with it; area
 * and bounds are properties of the surface and stay.
 */
function withoutVolume(properties, reason) {
  if (!properties) return null;
  return {
    ...properties,
    volumeMm3: null,
    centroidMm: [null, null, null],
    watertight: false,
    volumeUnavailableReason: reason
  };
}

/**
 * Mass properties of a compiled JSCAD solid, fanning each polygon into triangles.
 *
 * `options.watertight` accepts a verdict the caller has already computed so a
 * compile does not walk the same edges twice. Omitting it makes this function
 * check for itself, so it is never a path that trusts an unstated assumption.
 */
export function solidMassProperties(solid, options = {}) {
  const accumulator = createTriangleAccumulator();

  for (const polygon of geom3.toPolygons(solid)) {
    const vertices = polygon.vertices;
    if (!vertices || vertices.length < 3) continue;
    for (let index = 1; index < vertices.length - 1; index += 1) {
      accumulateTriangle(accumulator, vertices[0], vertices[index], vertices[index + 1]);
    }
  }

  const properties = finalizeTriangleAccumulator(accumulator);
  if (!properties) return null;

  const watertight = options.watertight ?? solidWatertightReport(solid).watertight;
  if (watertight) return { ...properties, watertight: true };
  return withoutVolume(
    properties,
    "The built surface is not closed, so the divergence theorem cannot state a volume."
  );
}

/**
 * Mass properties of a flat triangle buffer, nine floats per triangle.
 *
 * Used for meshes that never existed as a JSCAD solid on this thread, such as a
 * mesh returned by the build123d backend.
 */
export function triangleSoupMassProperties(vertices, triangleCount = null, options = {}) {
  const buffer = vertices ?? [];
  const triangles = Number.isFinite(Number(triangleCount))
    ? Math.floor(Number(triangleCount))
    : Math.floor(buffer.length / 9);
  const accumulator = createTriangleAccumulator();

  for (let index = 0; index < triangles; index += 1) {
    const offset = index * 9;
    if (offset + 9 > buffer.length) break;
    accumulateTriangle(
      accumulator,
      [buffer[offset], buffer[offset + 1], buffer[offset + 2]],
      [buffer[offset + 3], buffer[offset + 4], buffer[offset + 5]],
      [buffer[offset + 6], buffer[offset + 7], buffer[offset + 8]]
    );
  }

  const properties = finalizeTriangleAccumulator(accumulator);
  if (!properties) return null;

  const watertight = options.watertight ?? triangleSoupWatertightReport(buffer, triangles).watertight;
  if (watertight) return { ...properties, watertight: true };
  return withoutVolume(
    properties,
    "The supplied mesh is not closed, so the divergence theorem cannot state a volume."
  );
}

/**
 * Density-free geometry properties for a compiled body.
 *
 * Never throws: an unmeasurable body reports `null`, which the UI renders as a
 * dash. A guessed number would be worse than no number.
 */
export function bodyGeometryProperties(body, solid = null, options = {}) {
  const kind = body?.source?.kind ?? SKETCH_EXTRUDE_KIND;

  // A pocketed sketch body deliberately skips the exact 2D path: the pockets are
  // post-extrude, so the 2D region cannot state the volume. It falls to the mesh
  // path below, which is gated on watertightness like every other mesh measurement.
  if (kind === SKETCH_EXTRUDE_KIND && body?.sketch?.outerProfile) {
    try {
      const exact = sketchExtrudeMassProperties(body);
      // No `watertight` field on this path, deliberately. It integrates a closed 2D
      // region, so its volume never depended on the mesh being closed - and it
      // never looked at the mesh, so it is in no position to vouch for it. The
      // export gate reads the compile result's warnings, which do come from the solid.
      if (exact) return exact;
    } catch {
      // Fall through to the mesh path: the solid compiled, so it can still be measured.
    }
  }

  if (!solid) return null;
  try {
    return solidMassProperties(solid, { watertight: options.watertight });
  } catch {
    return null;
  }
}

function isUniform(scale) {
  return Math.abs(scale[0] - scale[1]) < 1e-9 && Math.abs(scale[1] - scale[2]) < 1e-9;
}

/**
 * Apply a body's placement scale to density-free geometry properties.
 *
 * Placement scale is on the transform, which the compile signature deliberately
 * ignores, so scaling has to happen on the main thread rather than by recompiling.
 * Volume and lengths scale in closed form. Surface area under a non-uniform scale
 * does not, so it is reported as `null` instead of an approximation.
 */
export function scaleGeometryProperties(properties, scale = [1, 1, 1]) {
  if (!properties) return null;
  const factors = [0, 1, 2].map((index) => {
    const value = Number(scale?.[index]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  if (factors.every((value) => Math.abs(value - 1) < 1e-12)) return { ...properties };

  const volumeFactor = factors[0] * factors[1] * factors[2];
  const uniform = isUniform(factors);
  const scaled = {
    ...properties,
    volumeMm3: finiteOrNull(properties.volumeMm3) == null ? null : properties.volumeMm3 * volumeFactor,
    surfaceAreaMm2:
      uniform && finiteOrNull(properties.surfaceAreaMm2) != null
        ? properties.surfaceAreaMm2 * factors[0] * factors[0]
        : null,
    centroidMm: Array.isArray(properties.centroidMm)
      ? properties.centroidMm.map((value, index) => (finiteOrNull(value) == null ? null : value * factors[index]))
      : properties.centroidMm,
    placementScale: factors
  };

  if (properties.boundsMm) {
    const min = properties.boundsMm.min.map((value, index) => value * factors[index]);
    const max = properties.boundsMm.max.map((value, index) => value * factors[index]);
    const size = max.map((value, index) => value - min[index]);
    scaled.boundsMm = { min, max, size, center: min.map((value, index) => value + size[index] / 2) };
  }

  if (finiteOrNull(properties.crossSectionAreaMm2) != null) {
    scaled.crossSectionAreaMm2 = properties.crossSectionAreaMm2 * factors[0] * factors[2];
  }
  if (finiteOrNull(properties.perimeterMm) != null) {
    scaled.perimeterMm = Math.abs(factors[0] - factors[2]) < 1e-9 ? properties.perimeterMm * factors[0] : null;
  }
  if (finiteOrNull(properties.extrudeDepthMm) != null) {
    scaled.extrudeDepthMm = properties.extrudeDepthMm * factors[1];
  }

  // The exact 2D path can still state an exact surface area under a scale that is
  // uniform within the sketch plane, because the profile keeps its shape there.
  if (
    scaled.surfaceAreaMm2 == null &&
    properties.method === EXACT_2D_METHOD &&
    finiteOrNull(scaled.crossSectionAreaMm2) != null &&
    finiteOrNull(scaled.perimeterMm) != null &&
    finiteOrNull(scaled.extrudeDepthMm) != null
  ) {
    scaled.surfaceAreaMm2 = 2 * scaled.crossSectionAreaMm2 + scaled.perimeterMm * scaled.extrudeDepthMm;
  }

  return scaled;
}
