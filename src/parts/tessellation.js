/**
 * Adaptive tessellation for curved 2D features.
 *
 * A single constant segment count is wrong in both directions: 48 segments on an
 * M3 clearance hole is wasted triangles, and 48 segments on a 60 mm bore leaves
 * a 0.6 mm flat where the part has to be round. Segment counts are therefore
 * derived from the feature radius and a chord (sagitta) tolerance, so every arc
 * in a body deviates from true by at most `toleranceMm` regardless of size.
 *
 * The deviation of an inscribed n-gon from its circle is r(1 - cos(PI / n)), so
 * the segment count that holds a tolerance t is PI / acos(1 - t / r).
 *
 * Counts are rounded up to a multiple of four. That keeps a point on each axis,
 * which makes holes symmetric about the sketch axes and keeps the X/Z extents of
 * a rounded rectangle equal to its nominal size.
 */

export const DEFAULT_CHORD_TOLERANCE_MM = 0.02;
export const MIN_CURVE_SEGMENTS = 12;
export const MAX_CURVE_SEGMENTS = 128;

function quantizeUp(value, step) {
  return Math.ceil(value / step) * step;
}

/**
 * Segment count for an arc of the given radius.
 *
 * Returns `MIN_CURVE_SEGMENTS` for a radius that is not a usable positive
 * number rather than guessing a finer count from bad input.
 */
export function circleSegmentsForRadius(radiusMm, options = {}) {
  const toleranceMm = Number(options.toleranceMm ?? DEFAULT_CHORD_TOLERANCE_MM);
  const minimum = Math.max(3, Math.floor(options.minimumSegments ?? MIN_CURVE_SEGMENTS));
  const maximum = Math.max(minimum, Math.floor(options.maximumSegments ?? MAX_CURVE_SEGMENTS));
  const radius = Number(radiusMm);

  if (!Number.isFinite(radius) || radius <= 0) return minimum;
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return maximum;
  if (toleranceMm >= radius) return minimum;

  const cosine = 1 - toleranceMm / radius;
  const half = Math.acos(Math.min(1, Math.max(-1, cosine)));
  if (!Number.isFinite(half) || half <= 0) return maximum;

  const exact = Math.PI / half;
  const quantized = quantizeUp(exact, 4);
  return Math.min(maximum, Math.max(minimum, quantized));
}

/** Segment count for an arc described by a diameter rather than a radius. */
export function circleSegmentsForDiameter(diameterMm, options = {}) {
  return circleSegmentsForRadius(Number(diameterMm) / 2, options);
}

/**
 * Segment count for a full revolution of a lathe profile, driven by the largest
 * radius in the profile because that is where the facets are widest.
 */
export function revolveSegmentsForRadius(maxRadiusMm, options = {}) {
  return circleSegmentsForRadius(maxRadiusMm, {
    minimumSegments: options.minimumSegments ?? 16,
    maximumSegments: options.maximumSegments ?? MAX_CURVE_SEGMENTS,
    toleranceMm: options.toleranceMm
  });
}
