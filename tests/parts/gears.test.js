import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import {
  createSpurGearBody,
  createSpurGearProfilePoints,
  normalizeSpurGearSpec,
  validateSpurGearSpec
} from "../../src/parts/gears.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;

test("normalizes and validates spur gear parameters", () => {
  const gear = normalizeSpurGearSpec({
    toothCount: 24,
    moduleMm: 2,
    pressureAngleDeg: 20,
    boreDiameterMm: 6,
    thicknessMm: 5
  });

  assert.deepEqual(validateSpurGearSpec(gear), []);
  assert.equal(gear.toothCount, 24);
  assert.equal(createSpurGearProfilePoints(gear).length, 96);
});

test("reports invalid spur gear parameters before compile", () => {
  const issues = validateSpurGearSpec({
    toothCount: 4,
    moduleMm: 0,
    pressureAngleDeg: 45,
    boreDiameterMm: "not-a-number",
    thicknessMm: -1
  });

  assert.ok(issues.some((issue) => issue.code === "invalid-gear-tooth-count"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-module"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-pressure-angle"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-thickness"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-bore"));
});

test("compiles a reliable spur gear body with a bore", () => {
  const body = createSpurGearBody({
    gear: {
      toothCount: 18,
      moduleMm: 2,
      pressureAngleDeg: 20,
      boreDiameterMm: 5,
      thicknessMm: 6
    }
  });
  const solid = compilePartBodyToSolid(body);
  const [min, max] = measureBoundingBox(solid);

  assert.equal(body.source.kind, "spurGear");
  assert.equal(Number((max[1] - min[1]).toFixed(3)), 6);
  assert.ok(max[0] - min[0] > 38);
  assert.ok(measureVolume(solid) > 0);
});
