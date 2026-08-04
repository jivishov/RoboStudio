/**
 * A painter's-algorithm isometric, from the triangle soup the main thread already has.
 *
 * ## Why this one works for every body kind and the orthographic views do not
 *
 * Orthographic projection needs a `geom3`, which the main thread never has. Painter's
 * isometric needs **no booleans and no solid**: it needs triangles, depth-sorts them, and
 * draws back to front. The mesh is already here, cached, transferred from the worker as
 * `vertices` and `normals`. That asymmetry is the whole reason a revolve, a gear, a
 * boolean or a recipe body gets a drawing at all instead of a blank sheet with an
 * apology.
 *
 * ## Lifted, not imported
 *
 * The projection, the face normal, the shading and the depth sort are
 * `six_axis_robot_arm_stl_kit/src/draw-kit.mjs`'s, lines 39 through 128. ⚠ That file is
 * **not importable**: it opens with Node's own file-system, path and URL built-ins at
 * module scope and imports a generator. So the maths is copied and this is its own module.
 *
 * (Those built-ins are named indirectly here on purpose. The import ban across this
 * directory is a bare substring check, deliberately - the narrower regex the DFM ban uses
 * lets a relative-path or dynamic import slip past - so spelling the prefix even in a
 * comment would trip it. That is the check working, not the check being wrong.)
 *
 * Two things were deliberately **not** lifted:
 *
 * - `buildProjectedFaces` calls `geom3.toPolygons`. A triangle-soup adapter replaces it,
 *   and the adapter is the whole change: every nine floats is one triangle.
 * - `baseSvg` hard-codes `#f8fafc`, `#0f172a` and a dozen more literals - which is the
 *   per-page palette duplication cycle 01 deleted. Colours here come from `tokens.css`
 *   through CSS custom properties, so the drawing follows the page's palette instead of
 *   founding a second one.
 *
 * ## No JSCAD, no DOM, no Node
 *
 * It takes a `Float32Array` and returns data. Asserted at source level.
 */

const ISO_COS = Math.cos(Math.PI / 6);
const ISO_SIN = Math.sin(Math.PI / 6);

/**
 * The light direction the shading uses.
 *
 * Lifted with the rest of the maths. It is a rendering choice and not a measurement, which
 * is why it is a constant here rather than a parameter somewhere: nothing derives from it
 * and no dimension depends on it.
 */
const LIGHT = Object.freeze([-0.45, -0.35, 0.82]);

/** How far a face's shade may travel from the base lightness. */
const SHADE_BASE = 46;
const SHADE_RANGE = 34;

function projectPoint(x, y, z) {
  return {
    u: (x - y) * ISO_COS,
    v: -z + (x + y) * ISO_SIN,
    // The depth key: a weighted sum rather than a true camera distance, which is enough for
    // a painter's sort on convex-ish parts and is what the kit has drawn with for a year.
    depth: x + y + z * 1.25
  };
}

function triangleNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

/**
 * A face's shade as a lightness percentage, not a colour.
 *
 * The hue and saturation are the **page's**, applied by the renderer from `tokens.css`, so
 * this module states how lit a face is and never what colour the page is. That is what
 * keeps the palette in one file.
 */
function faceLightness(a, b, c) {
  const normal = triangleNormal(a, b, c);
  const dot = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
  return Math.round(SHADE_BASE + dot * SHADE_RANGE);
}

/**
 * Depth-sorted projected faces for a triangle soup.
 *
 * `vertices` is the interleaved `[x, y, z, ...]` buffer the CAD worker transfers - three
 * vertices, nine floats, one triangle. Returns faces already sorted back to front, so a
 * renderer emits them in order and needs no z-buffer.
 */
export function isometricFaces(vertices, triangleCount = null) {
  const source = vertices ?? [];
  const triangles = Number.isFinite(triangleCount) ? Number(triangleCount) : Math.floor(source.length / 9);
  const faces = [];
  const bounds = { minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity };

  for (let index = 0; index < triangles; index += 1) {
    const at = index * 9;
    if (at + 8 >= source.length + 1 && at + 9 > source.length) break;
    const a = [source[at], source[at + 1], source[at + 2]];
    const b = [source[at + 3], source[at + 4], source[at + 5]];
    const c = [source[at + 6], source[at + 7], source[at + 8]];
    if (![...a, ...b, ...c].every(Number.isFinite)) continue;

    const projected = [a, b, c].map((point) => projectPoint(point[0], point[1], point[2]));
    for (const point of projected) {
      bounds.minU = Math.min(bounds.minU, point.u);
      bounds.minV = Math.min(bounds.minV, point.v);
      bounds.maxU = Math.max(bounds.maxU, point.u);
      bounds.maxV = Math.max(bounds.maxV, point.v);
    }
    faces.push({
      points: projected.map((point) => [point.u, point.v]),
      lightness: faceLightness(a, b, c),
      depth: (projected[0].depth + projected[1].depth + projected[2].depth) / 3
    });
  }

  faces.sort((first, second) => first.depth - second.depth);
  if (!faces.length) return { faces, extents: null, triangleCount: 0 };
  return {
    faces,
    extents: { ...bounds, widthMm: bounds.maxU - bounds.minU, heightMm: bounds.maxV - bounds.minV },
    triangleCount: faces.length
  };
}

/**
 * The overall size of a body, from the mesh bounds the compile already reported.
 *
 * ⚠ These are **measured** extents rather than authored dimensions, and the difference
 * matters enough to be a separate function with this comment on it: a sketch body's
 * drawing dimensions come from `dimensions.js` and are the numbers the designer typed.
 * These are what a non-sketch body gets instead, and they are labelled as extents
 * everywhere they appear so nobody reads a measured 39.98 as an authored 40.
 */
export function meshExtents(bounds) {
  const size = bounds?.size;
  // Length checked as well as finiteness: a two-element `size` would otherwise produce a
  // `zMm` of `NaN`, which renders as a number-shaped absence rather than as no answer.
  if (!Array.isArray(size) || size.length < 3 || !size.slice(0, 3).every((value) => Number.isFinite(Number(value)))) {
    return null;
  }
  return {
    xMm: Number(size[0]),
    yMm: Number(size[1]),
    zMm: Number(size[2]),
    measured: true,
    note: "Overall extents measured from the compiled mesh, not dimensions read from a sketch."
  };
}
