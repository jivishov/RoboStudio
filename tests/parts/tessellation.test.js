import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import {
  DEFAULT_CHORD_TOLERANCE_MM,
  MAX_CURVE_SEGMENTS,
  MIN_CURVE_SEGMENTS,
  circleSegmentsForDiameter,
  circleSegmentsForRadius,
  revolveSegmentsForRadius
} from "../../src/parts/tessellation.js";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { createCircularHole } from "../../src/parts/sketch.js";

const { measureBoundingBox } = jscad.measurements;

function chordErrorMm(radiusMm, segments) {
  return radiusMm * (1 - Math.cos(Math.PI / segments));
}

test("segment counts rise with radius instead of staying at one constant", () => {
  const counts = [1.6, 3.2, 8, 20, 60].map((radius) => circleSegmentsForRadius(radius));
  for (let index = 1; index < counts.length; index += 1) {
    assert.ok(counts[index] >= counts[index - 1], `${counts}`);
  }
  // The old fixed 48 was simultaneously too many for an M3 hole and too few for a
  // 60 mm bore. Adaptive counts have to fall on both sides of it.
  assert.ok(counts[1] < 48);
  assert.ok(counts[4] > 48);
});

test("every segment count holds the chord tolerance it claims", () => {
  for (const radius of [0.5, 1.6, 3.2, 5, 12, 25, 40, 90]) {
    const segments = circleSegmentsForRadius(radius);
    if (segments >= MAX_CURVE_SEGMENTS || segments <= MIN_CURVE_SEGMENTS) continue;
    assert.ok(
      chordErrorMm(radius, segments) <= DEFAULT_CHORD_TOLERANCE_MM + 1e-12,
      `r=${radius} n=${segments} error=${chordErrorMm(radius, segments)}`
    );
    // And it is not wastefully fine: one step coarser would break the tolerance.
    assert.ok(chordErrorMm(radius, segments - 4) > DEFAULT_CHORD_TOLERANCE_MM);
  }
});

test("counts are multiples of four so a hole keeps a point on each axis", () => {
  for (const radius of [0.8, 2, 3.2, 7, 19, 33]) {
    assert.equal(circleSegmentsForRadius(radius) % 4, 0);
  }
});

test("counts stay inside the clamp and degrade honestly on bad input", () => {
  assert.equal(circleSegmentsForRadius(0), MIN_CURVE_SEGMENTS);
  assert.equal(circleSegmentsForRadius(-4), MIN_CURVE_SEGMENTS);
  assert.equal(circleSegmentsForRadius(Number.NaN), MIN_CURVE_SEGMENTS);
  assert.equal(circleSegmentsForRadius(null), MIN_CURVE_SEGMENTS);
  assert.equal(circleSegmentsForRadius(0.005), MIN_CURVE_SEGMENTS);
  assert.equal(circleSegmentsForRadius(100000), MAX_CURVE_SEGMENTS);
  assert.equal(circleSegmentsForRadius(10, { toleranceMm: 0 }), MAX_CURVE_SEGMENTS);
});

test("a tighter tolerance asks for more segments", () => {
  assert.ok(circleSegmentsForRadius(10, { toleranceMm: 0.005 }) > circleSegmentsForRadius(10, { toleranceMm: 0.05 }));
});

test("diameter and radius helpers agree", () => {
  assert.equal(circleSegmentsForDiameter(6.4), circleSegmentsForRadius(3.2));
});

test("revolve segment counts never drop below a usable full turn", () => {
  assert.ok(revolveSegmentsForRadius(0) >= 16);
  assert.ok(revolveSegmentsForRadius(21) > revolveSegmentsForRadius(3));
});

test("adaptive holes stay inside their nominal size and keep the profile extents exact", () => {
  const body = createBodyFromTemplate("base_plate");
  body.sketch.cutProfiles = [createCircularHole({ id: "big_bore", x: 0, z: 0, radius: 22 })];
  const bounds = measureBoundingBox(compilePartBodyToSolid(body));

  // The rounded outer rectangle is 120 x 80 and its corner arcs are tangent to that
  // box at every segment count, so the extents must not move with tessellation. The
  // 0.0002 mm band is JSCAD's own subtract-and-repair jitter, which is present with a
  // fixed segment count too and is independent of the hole radius.
  assert.ok(Math.abs(bounds[1][0] - bounds[0][0] - 120) < 0.0002);
  assert.ok(Math.abs(bounds[1][2] - bounds[0][2] - 80) < 0.0002);
});
