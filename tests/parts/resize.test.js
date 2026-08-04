import assert from "node:assert/strict";
import test from "node:test";

import { normalizePartBody } from "../../src/parts/projectState.js";
import { bodySourceSizeMm, resizePartBodyToTargetSize, targetSizeFromAxisEdit } from "../../src/parts/resize.js";
import { targetSizeFromSketchResize } from "../../src/parts/sketchResize.js";
import { clearanceHoleDiameterMm } from "../../src/parts/standards/fasteners.js";
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
  assert.equal(resized.sketch.cutProfiles[0].x, -25);
  // Cycle 08 made the link bar's pivots M4 clearance holes, so halving the bar moves
  // them and does not shrink them. The claim that a *decorative* circle still scales
  // when asked to lives in "landmine three" below, against a plain circle that has no
  // standard to protect - which is where it belongs, because this template no longer
  // has one.
  assert.equal(resized.sketch.cutProfiles[0].radius, clearanceHoleDiameterMm("M4", "normal") / 2);
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
  // Shrinking a plate far enough while holding its hole sizes walks the holes off the
  // edge, and that is a hard `validateBody` gate rather than a report. The target got
  // smaller in cycle 08: the plate's holes are now M3 clearance rather than the 6.4 mm
  // they used to be, so 20 mm square is no longer small enough to push one out.
  const body = createBodyFromTemplate("base_plate");
  const resized = resizePartBodyToTargetSize(body, [12, 6, 12], { keepCutSizes: true });
  const issues = validateBody(resized);

  assert.ok(issues.some((issue) => issue.code === "cut-outside-outer-profile"));
});

test("target-size helper supports uniform and per-axis edits", () => {
  assert.deepEqual(targetSizeFromAxisEdit([100, 10, 50], 0, 200, true), [200, 20, 100]);
  assert.deepEqual(targetSizeFromAxisEdit([100, 10, 50], 2, 25, false), [100, 10, 25]);
});

/** A 120 by 80 plate with one standards M3 hole off-centre and one plain circle. */
function plateWithStandardsHole(hole = { size: "M3" }) {
  return normalizePartBody({
    id: "plate",
    name: "Plate",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 120, height: 80 },
      cutProfiles: [
        { id: "screw", type: "circle", x: 30, z: 20, radius: 1, hole },
        { id: "decor", type: "circle", x: -30, z: -20, radius: 4 }
      ]
    }
  });
}

test("landmine three: doubling the plate leaves the M3 hole at its standard diameter", () => {
  const body = plateWithStandardsHole();
  const standardRadius = clearanceHoleDiameterMm("M3", "normal") / 2;
  assert.equal(body.sketch.cutProfiles[0].radius, standardRadius, "the hole starts at the standard");

  // `keepCutSizes: false` is the case that used to be wrong: it is the setting that
  // asks every cut to scale, and `scaleProfileDimensions` multiplied a radius by
  // sqrt(|scaleX * scaleZ|). Doubling a plate does not make the screws thicker.
  const resized = resizePartBodyToTargetSize(body, [240, 6, 160], { keepCutSizes: false });
  const [screw, decor] = resized.sketch.cutProfiles;

  assert.equal(screw.radius, standardRadius, "a locked standards hole keeps its diameter");
  assert.equal(decor.radius, 8, "a decorative circle still scales when asked to");

  // The centre moves proportionally in both cases: the hole stays where it is on the
  // part, it just stops being the wrong size.
  assert.equal(screw.x, 60);
  assert.equal(screw.z, 40);
  assert.equal(decor.x, -60);
  assert.equal(decor.z, -40);
});

test("the standards hole keeps its diameter with keepCutSizes either way", () => {
  const standardRadius = clearanceHoleDiameterMm("M3", "normal") / 2;
  for (const keepCutSizes of [true, false]) {
    const resized = resizePartBodyToTargetSize(plateWithStandardsHole(), [240, 6, 160], { keepCutSizes });
    assert.equal(resized.sketch.cutProfiles[0].radius, standardRadius, `keepCutSizes ${keepCutSizes}`);
  }

  // Cycle 08's acceptance criterion, asserted here rather than in a second test of its
  // own: a *shipped template* resized by two keeps its standards holes at nominal
  // diameter. Extending this test instead of writing a parallel one is the point -
  // the lock is one mechanism, and a template proving it separately from a hand-built
  // body would be two places to keep in step.
  //
  // Every circular cut is checked, and the non-fastener ones are checked to have
  // scaled, which is what keeps this from passing for the wrong reason: a build in
  // which the lock had frozen everything would look identical if only the holes were
  // asserted.
  for (const templateId of ["base_plate", "bearing_block_plate", "quad_motor_arm_plate"]) {
    const body = normalizePartBody(createBodyFromTemplate(templateId));
    const [width, thickness, depth] = bodySourceSizeMm(body);
    const doubled = resizePartBodyToTargetSize(body, [width * 2, thickness, depth * 2], { keepCutSizes: false });

    for (const [index, before] of body.sketch.cutProfiles.entries()) {
      const after = doubled.sketch.cutProfiles[index];
      if (before.type !== "circle") continue;
      if (before.hole) {
        assert.equal(after.radius, before.radius, `${templateId} ${before.id} is a standards hole and must not scale`);
        assert.equal(
          after.radius,
          clearanceHoleDiameterMm(before.hole.size, before.hole.fit) / 2,
          `${templateId} ${before.id} should measure its own standard`
        );
      } else {
        assert.equal(after.radius, before.radius * 2, `${templateId} ${before.id} carries no standard and should scale`);
      }
    }
  }
});

test("an explicitly unlocked hole scales like any other circle", () => {
  // `lockSize: false` is the author saying "this started from a standard and I am
  // scaling it anyway", so the per-profile override steps aside and the body-wide
  // toggle decides. Without that, `lockSize` would be a field with no false branch.
  const body = plateWithStandardsHole({ size: "M3", lockSize: false });
  assert.equal(body.sketch.cutProfiles[0].radius, 1, "an unlocked hole keeps the author's radius");

  const scaled = resizePartBodyToTargetSize(body, [240, 6, 160], { keepCutSizes: false });
  assert.equal(scaled.sketch.cutProfiles[0].radius, 2);

  const held = resizePartBodyToTargetSize(body, [240, 6, 160], { keepCutSizes: true });
  assert.equal(held.sketch.cutProfiles[0].radius, 1);
});

test("the lock holds through the drag resize path, because both paths share one implementation", () => {
  // The sketch drag and the numeric field both route through
  // `resizePartBodyToTargetSize`; the drag path only computes the target differently.
  // Asserting through `targetSizeFromSketchResize` is what proves there is no second
  // scaling implementation to keep in step.
  const body = plateWithStandardsHole();
  const standardRadius = clearanceHoleDiameterMm("M3", "normal") / 2;
  const drag = { handle: "se", startSize: [120, 6, 80], centerX: 0, centerZ: 0 };
  const targetSize = targetSizeFromSketchResize({ x: 120, z: 80 }, drag, { uniform: false });

  assert.deepEqual(targetSize, [240, 6, 160]);
  for (const keepCutSizes of [true, false]) {
    const dragged = resizePartBodyToTargetSize(body, targetSize, {
      currentSizeMm: drag.startSize,
      keepCutSizes
    });
    assert.equal(dragged.sketch.cutProfiles[0].radius, standardRadius);
    assert.equal(dragged.sketch.cutProfiles[0].x, 60);
  }
});

test("the lock holds on a circular outer profile's uniform radial resize too", () => {
  // A circular sketch takes its own branch in `resizeSketchBody`, so it needs its own
  // assertion: one lock check in the shared helper covers both, and this is what says so.
  const body = normalizePartBody({
    id: "boss",
    name: "Boss",
    extrudeDepthMm: 10,
    sketch: {
      outerProfile: { id: "outer", type: "circle", x: 0, z: 0, radius: 20 },
      cutProfiles: [{ id: "screw", type: "circle", x: 10, z: 0, radius: 1, hole: { size: "M4", fit: "loose" } }]
    }
  });
  const standardRadius = clearanceHoleDiameterMm("M4", "loose") / 2;

  const resized = resizePartBodyToTargetSize(body, [80, 10, 80], { keepCutSizes: false });
  assert.equal(resized.sketch.outerProfile.radius, 40);
  assert.equal(resized.sketch.cutProfiles[0].radius, standardRadius);
  assert.equal(resized.sketch.cutProfiles[0].x, 20, "the centre still moves proportionally");
});

test("a refused hole does not lock a radius it never derived", () => {
  // Locking on the *presence* of a hole rather than on its resolution would freeze a
  // radius the standards table never produced, which is a silent surprise rather than
  // a standard being honoured. `lockSize` is about intent, so it holds - and the
  // diameter it holds is the author's own, unchanged.
  const body = plateWithStandardsHole({ size: "M3.5" });
  assert.equal(body.sketch.cutProfiles[0].radius, 1);

  const resized = resizePartBodyToTargetSize(body, [240, 6, 160], { keepCutSizes: false });
  assert.equal(resized.sketch.cutProfiles[0].radius, 1);
});

