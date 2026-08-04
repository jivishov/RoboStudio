import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import {
  DISCONNECTED_SOLID_CODE,
  countSolidComponents,
  detectDisconnectedSolid
} from "../../src/parts/connectivity.js";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { compileBodyToMeshResult } from "../../src/parts/cadWorkerCore.js";
import { createRectangleProfile } from "../../src/parts/sketch.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validateBody } from "../../src/parts/validation.js";

const { union } = jscad.booleans;
const { cuboid } = jscad.primitives;

// A plate the full height of the outer profile, cut into two by a slot that spans it.
function splitPlateBody() {
  return {
    id: "split_plate",
    name: "Split plate",
    source: { kind: "sketchExtrude" },
    transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    extrudeDepthMm: 4,
    materialId: "pla",
    sketch: {
      outerProfile: createRectangleProfile({ id: "outer", width: 60, height: 20, cornerRadius: 0 }),
      cutProfiles: [createRectangleProfile({ id: "split", x: 0, z: 0, width: 6, height: 20, cornerRadius: 0 })]
    }
  };
}

test("a single lump counts as one component and reports no finding", () => {
  const solid = compilePartBodyToSolid(createBodyFromTemplate("base_plate"));
  assert.equal(countSolidComponents(solid), 1);
  assert.equal(detectDisconnectedSolid(solid), null);
});

test("two disjoint lumps are counted and reported as a warning", () => {
  const solid = union(
    cuboid({ center: [-20, 0, 0], size: [10, 10, 10] }),
    cuboid({ center: [20, 0, 0], size: [10, 10, 10] })
  );

  assert.equal(countSolidComponents(solid), 2);
  const finding = detectDisconnectedSolid(solid, { path: "bodies.two_lumps" });
  assert.equal(finding.code, DISCONNECTED_SOLID_CODE);
  assert.equal(finding.severity, "warning");
  assert.equal(finding.partCount, 2);
  assert.equal(finding.path, "bodies.two_lumps");
});

test("a cut that severs a plate is reported without blocking the compile", () => {
  const body = splitPlateBody();

  // Landmine one: this finding must not reach the compile gate. `validateBody` refuses
  // to compile on any issue at any severity, so a severed plate has to validate clean
  // and still compile, preview and export.
  assert.deepEqual(validateBody(body), []);

  const result = compileBodyToMeshResult(body, [body]);
  assert.ok(result.triangleCount > 0);
  assert.ok(result.geometryProperties.volumeMm3 > 0);
  assert.deepEqual(result.warnings.map((warning) => warning.code), [DISCONNECTED_SOLID_CODE]);
  assert.equal(result.warnings[0].partCount, 2);
  assert.equal(result.warnings[0].severity, "warning");
});

test("detection never throws on unusable input", () => {
  assert.equal(detectDisconnectedSolid(null), null);
  assert.equal(detectDisconnectedSolid({ not: "a solid" }), null);
});
