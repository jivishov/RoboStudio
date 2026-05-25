import assert from "node:assert/strict";
import test from "node:test";

import { createGeneratedAssemblySnapshot } from "../../src/parts/snapshot.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

test("includes compile metadata and world matrices in generated assembly snapshots", () => {
  const body = createBodyFromTemplate("base_plate");
  const matrixWorld = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 0, 0, 1];
  const snapshot = createGeneratedAssemblySnapshot({
    savedAt: "2026-05-25T14:00:00.000Z",
    glb: new ArrayBuffer(8),
    bodies: [body],
    compileResults: new Map([[body.id, { triangleCount: 88, bounds: { size: [120, 6, 80] } }]]),
    matrixWorldById: new Map([[body.id, matrixWorld]])
  });

  assert.equal(snapshot.parts[0].type, "generated");
  assert.equal(snapshot.parts[0].source, "part-studio");
  assert.equal(snapshot.parts[0].triangles, 88);
  assert.deepEqual(snapshot.parts[0].bounds, { size: [120, 6, 80] });
  assert.deepEqual(snapshot.parts[0].matrixWorld, matrixWorld);
});
