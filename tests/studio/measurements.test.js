import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVO_HORN_SPACING_PRESETS,
  createMeasurementAnchor,
  measureAnchors,
  spacingAdjustmentForTarget
} from "../../src/studio/measurements.js";

test("measures 3D, projected, and edge clearance distances", () => {
  const a = createMeasurementAnchor({
    type: "holeCenter",
    worldPosition: [0, 0, 0],
    radiusMm: 2
  });
  const b = createMeasurementAnchor({
    type: "holeCenter",
    worldPosition: [3, 4, 12],
    radiusMm: 1
  });

  const result = measureAnchors(a, b, { activePlane: "xy" });

  assert.equal(result.ready, true);
  assert.equal(Number(result.distanceMm.toFixed(3)), 13);
  assert.equal(Number(result.projectedDistanceMm.toFixed(3)), 5);
  assert.deepEqual(result.deltaMm, [3, 4, 12]);
  assert.equal(Number(result.edgeClearanceMm.toFixed(3)), 10);
});

test("computes target spacing moves for one-sided and symmetric edits", () => {
  const a = createMeasurementAnchor({ worldPosition: [0, 0, 0] });
  const b = createMeasurementAnchor({ worldPosition: [20, 0, 0] });

  assert.deepEqual(spacingAdjustmentForTarget(a, b, 24).moveB, [4, 0, 0]);

  const symmetric = spacingAdjustmentForTarget(a, b, 24, { symmetric: true });
  assert.deepEqual(symmetric.moveA, [-2, -0, -0]);
  assert.deepEqual(symmetric.moveB, [2, 0, 0]);
});

test("servo horn template presets expose opposite and adjacent hole spacing", () => {
  const opposite = SERVO_HORN_SPACING_PRESETS.find((item) => item.id === "servo_horn_opposite_radial");
  const adjacent = SERVO_HORN_SPACING_PRESETS.find((item) => item.id === "servo_horn_adjacent_radial");

  assert.equal(opposite.targetDistanceMm, 24);
  assert.equal(adjacent.targetDistanceMm, 16.971);
});
