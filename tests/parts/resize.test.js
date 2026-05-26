import assert from "node:assert/strict";
import test from "node:test";

import { bodySourceSizeMm, resizePartBodyToTargetSize, targetSizeFromAxisEdit } from "../../src/parts/resize.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validateBody } from "../../src/parts/validation.js";

test("resizes rectangle sketches by source dimensions while preserving hole sizes", () => {
  const body = createBodyFromTemplate("base_plate");
  const resized = resizePartBodyToTargetSize(body, [60, 8, 40], { keepCutSizes: true });

  assert.deepEqual(bodySourceSizeMm(resized).map((value) => Number(value.toFixed(3))), [60, 8, 40]);
  assert.equal(resized.sketch.outerProfile.width, 60);
  assert.equal(resized.sketch.outerProfile.height, 40);
  assert.equal(resized.extrudeDepthMm, 8);
  assert.equal(resized.sketch.cutProfiles[0].radius, body.sketch.cutProfiles[0].radius);
  assert.equal(resized.sketch.cutProfiles[0].x, -24);
  assert.equal(resized.sketch.cutProfiles[0].z, -14);
});

test("can scale sketch cuts with the body footprint", () => {
  const body = createBodyFromTemplate("link_bar");
  const resized = resizePartBodyToTargetSize(body, [70, 5, 12], { keepCutSizes: false });

  assert.equal(resized.sketch.outerProfile.length, 70);
  assert.equal(resized.sketch.outerProfile.width, 12);
  assert.equal(Number(resized.sketch.cutProfiles[0].radius.toFixed(3)), 2.1);
  assert.equal(resized.sketch.cutProfiles[0].x, -25);
});

test("resizes polyline sketches around the footprint center", () => {
  const body = createBodyFromTemplate("gripper_finger");
  const resized = resizePartBodyToTargetSize(body, [76, 5, 58], { keepCutSizes: true });
  const xs = resized.sketch.outerProfile.points.map((point) => point[0]);
  const zs = resized.sketch.outerProfile.points.map((point) => point[1]);

  assert.equal(Math.max(...xs) - Math.min(...xs), 76);
  assert.equal(Math.max(...zs) - Math.min(...zs), 58);
  assert.equal(resized.sketch.cutProfiles[0].radius, body.sketch.cutProfiles[0].radius);
});

test("resizes circular sketches uniformly through source radius", () => {
  const body = createBodyFromTemplate("spacer_standoff");
  const resized = resizePartBodyToTargetSize(body, [48, 36, 48], { keepCutSizes: true });

  assert.deepEqual(bodySourceSizeMm(resized).map((value) => Number(value.toFixed(3))), [48, 36, 48]);
  assert.equal(resized.sketch.outerProfile.radius, 24);
  assert.equal(resized.sketch.cutProfiles[0].radius, body.sketch.cutProfiles[0].radius);
  assert.deepEqual(resized.transform.scale, [1, 1, 1]);
});

test("uses placement scale for non-uniform circular resize", () => {
  const body = createBodyFromTemplate("spacer_standoff");
  const resized = resizePartBodyToTargetSize(body, [48, 18, 24], { keepCutSizes: true });

  assert.equal(resized.sketch.outerProfile.radius, body.sketch.outerProfile.radius);
  assert.equal(resized.extrudeDepthMm, 18);
  assert.deepEqual(resized.transform.scale.map((value) => Number(value.toFixed(3))), [2, 1, 1]);
});

test("surfaces invalid fixed-hole resizes through body validation", () => {
  const body = createBodyFromTemplate("base_plate");
  const resized = resizePartBodyToTargetSize(body, [20, 6, 20], { keepCutSizes: true });
  const issues = validateBody(resized);

  assert.ok(issues.some((issue) => issue.code === "cut-outside-outer-profile"));
});

test("target-size helper supports uniform and per-axis edits", () => {
  assert.deepEqual(targetSizeFromAxisEdit([100, 10, 50], 0, 200, true), [200, 20, 100]);
  assert.deepEqual(targetSizeFromAxisEdit([100, 10, 50], 2, 25, false), [100, 10, 25]);
});

