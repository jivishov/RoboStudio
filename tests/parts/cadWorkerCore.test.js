import assert from "node:assert/strict";
import test from "node:test";

import { compileBodiesToMeshResults } from "../../src/parts/cadWorkerCore.js";
import { createCircularHole } from "../../src/parts/sketch.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

test("worker compile core builds base plate mesh data", () => {
  const body = createBodyFromTemplate("base_plate");
  const { results, errors, transfers } = compileBodiesToMeshResults([body]);

  assert.equal(errors.length, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].bodyId, body.id);
  assert.ok(results[0].triangleCount > 0);
  assert.ok(results[0].vertices instanceof Float32Array);
  assert.ok(results[0].normals instanceof Float32Array);
  assert.equal(results[0].vertices.length, results[0].triangleCount * 9);
  assert.equal(results[0].normals.length, results[0].vertices.length);
  assert.ok(results[0].bounds.size[0] >= 119);
  assert.equal(Number(results[0].bounds.size[1].toFixed(3)), body.extrudeDepthMm);
  assert.ok(transfers.includes(results[0].vertices.buffer));
  assert.ok(transfers.includes(results[0].normals.buffer));
});

test("worker compile core serializes invalid body errors", () => {
  const body = createBodyFromTemplate("base_plate");
  body.sketch.cutProfiles = [createCircularHole({ id: "bad_hole", x: 200, z: 0, radius: 3 })];

  const { results, errors, transfers } = compileBodiesToMeshResults([body]);

  assert.equal(results.length, 0);
  assert.equal(transfers.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].bodyId, body.id);
  assert.equal(errors[0].code, "cad-compile-error");
  assert.ok(errors[0].issues.some((issue) => issue.code === "cut-outside-outer-profile"));
});
