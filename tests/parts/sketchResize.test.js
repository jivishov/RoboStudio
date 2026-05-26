import assert from "node:assert/strict";
import test from "node:test";

import {
  sketchResizeAxes,
  targetSizeFromSketchResize
} from "../../src/parts/sketchResize.js";

const baseDrag = Object.freeze({
  startSize: [120, 6, 80],
  centerX: 0,
  centerZ: 0
});

test("detects sketch resize axes from handle names", () => {
  assert.deepEqual(sketchResizeAxes("e"), { x: true, z: false });
  assert.deepEqual(sketchResizeAxes("n"), { x: false, z: true });
  assert.deepEqual(sketchResizeAxes("sw"), { x: true, z: true });
});

test("edge drag resizes one sketch footprint axis when uniform is disabled", () => {
  assert.deepEqual(
    targetSizeFromSketchResize({ x: 90, z: 20 }, { ...baseDrag, handle: "e" }, { uniform: false }),
    [180, 6, 80]
  );
});

test("edge drag preserves proportions when uniform is enabled", () => {
  assert.deepEqual(
    targetSizeFromSketchResize({ x: 90, z: 20 }, { ...baseDrag, handle: "e" }, { uniform: true }),
    [180, 6, 120]
  );
});

test("corner drag uses the larger uniform factor", () => {
  assert.deepEqual(
    targetSizeFromSketchResize({ x: 75, z: 80 }, { ...baseDrag, handle: "ne" }, { uniform: true }),
    [240, 6, 160]
  );
});

test("sketch mouse resize clamps tiny targets", () => {
  assert.deepEqual(
    targetSizeFromSketchResize({ x: 0.1, z: 0.1 }, { ...baseDrag, handle: "se" }, { uniform: false, minSizeMm: 1 }),
    [1, 6, 1]
  );
});

