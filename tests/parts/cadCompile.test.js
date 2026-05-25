import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { PartCadCompileError, compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { createCircularHole } from "../../src/parts/sketch.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;

test("compiles a template body into X/Z sketch geometry with Y thickness", () => {
  const body = createBodyFromTemplate("base_plate");
  const solid = compilePartBodyToSolid(body);
  const [min, max] = measureBoundingBox(solid);

  assert.ok(max[0] - min[0] >= 119);
  assert.ok(max[2] - min[2] >= 79);
  assert.equal(Number((max[1] - min[1]).toFixed(3)), body.extrudeDepthMm);
});

test("subtracts cut profiles before extrusion", () => {
  const withHole = createBodyFromTemplate("spacer_standoff");
  const withoutHole = createBodyFromTemplate("spacer_standoff");
  withoutHole.sketch.cutProfiles = [];

  assert.ok(measureVolume(compilePartBodyToSolid(withHole)) < measureVolume(compilePartBodyToSolid(withoutHole)));
});

test("rejects invalid bodies without crashing compile callers", () => {
  const body = createBodyFromTemplate("base_plate");
  body.sketch.cutProfiles = [createCircularHole({ id: "bad_hole", x: 200, z: 0, radius: 3 })];

  assert.throws(() => compilePartBodyToSolid(body), (error) => {
    assert.ok(error instanceof PartCadCompileError);
    assert.ok(error.issues.some((issue) => issue.code === "cut-outside-outer-profile"));
    return true;
  });
});
