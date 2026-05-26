import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { compileBodyToStlSolid, serializeBodyToStl, stlFileNameForBody } from "../../src/parts/exporters.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

const { measureBoundingBox } = jscad.measurements;

test("exports a selected generated body as ASCII STL", () => {
  const body = createBodyFromTemplate("servo_mount_plate");
  const stl = serializeBodyToStl(body);

  assert.equal(stlFileNameForBody(body), "servo_mount_plate.stl");
  assert.match(stl, /^solid /);
  assert.match(stl, /facet normal/);
});

test("bakes placement scale into standalone STL dimensions", () => {
  const body = createBodyFromTemplate("base_plate");
  body.transform.scale = [0.5, 2, 1.25];
  const solid = compileBodyToStlSolid(body);
  const [min, max] = measureBoundingBox(solid);

  assert.equal(Number((max[0] - min[0]).toFixed(3)), 60);
  assert.equal(Number((max[1] - min[1]).toFixed(3)), 12);
  assert.equal(Number((max[2] - min[2]).toFixed(3)), 100);
});
