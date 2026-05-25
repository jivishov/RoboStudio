import assert from "node:assert/strict";
import test from "node:test";

import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { solidToMeshData } from "../../src/parts/meshConversion.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

test("converts compiled solids into typed triangle buffers", () => {
  const body = createBodyFromTemplate("link_bar");
  const mesh = solidToMeshData(compilePartBodyToSolid(body));

  assert.ok(mesh.vertices instanceof Float32Array);
  assert.ok(mesh.normals instanceof Float32Array);
  assert.equal(mesh.vertices.length, mesh.normals.length);
  assert.equal(mesh.vertices.length, mesh.triangleCount * 9);
  assert.ok(mesh.triangleCount > 0);
  assert.equal(Number(mesh.bounds.size[1].toFixed(3)), body.extrudeDepthMm);
});
