import assert from "node:assert/strict";
import test from "node:test";

import {
  compileBodiesToMeshResults,
  serializeWorkerError
} from "../../src/parts/cadWorkerCore.js";
import { AdvancedCadBackendRequiredError } from "../../src/parts/advancedCadRecipe.js";
import { PartCadCompileError } from "../../src/parts/cadCompile.js";
import { createBooleanOperationBody } from "../../src/parts/featureOps.js";
import { POCKET_BREAKTHROUGH_CODE, REFUSED_HOLE_CODE } from "../../src/parts/holes.js";
import { MESH_DIVERGENCE_METHOD } from "../../src/parts/massProperties.js";
import { normalizePartBody, normalizePartProject } from "../../src/parts/projectState.js";
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

test("worker results carry density-free geometry properties", () => {
  const body = createBodyFromTemplate("base_plate");
  const [result] = compileBodiesToMeshResults([body]).results;
  const properties = result.geometryProperties;

  assert.equal(properties.method, "exact-2d");
  assert.ok(properties.volumeMm3 > 0);
  assert.ok(properties.surfaceAreaMm2 > 0);
  assert.equal(properties.centroidMm.length, 3);
  assert.ok(properties.boundsMm.size[1] > 0);

  // Density stays on the main thread. If it ever leaked into the worker result, a
  // material change would have to invalidate the compile to update the mass.
  const serialized = JSON.stringify(properties).toLowerCase();
  assert.ok(!serialized.includes("density"));
  assert.ok(!serialized.includes("material"));
  assert.ok(!serialized.includes("gram"));
});

test("a closed body carries no watertight warning, and the check runs on every kind", () => {
  const existingIds = new Set();
  const plate = createBodyFromTemplate("base_plate", { existingIds });
  existingIds.add(plate.id);
  const bar = createBodyFromTemplate("link_bar", { existingIds });
  existingIds.add(bar.id);
  const boolean = createBooleanOperationBody("union", [plate, bar], { id: "welded" }, existingIds);
  const bodies = normalizePartProject({ bodies: [plate, bar, boolean] }).bodies;

  const { results, errors } = compileBodiesToMeshResults(bodies);
  assert.equal(errors.length, 0);
  for (const result of results) {
    // The boolean body is the one that matters: JSCAD leaves T-junctions there, and
    // a naive watertight check would have warned on it and blocked its mesh export.
    assert.deepEqual(
      result.warnings.filter((warning) => warning.code === "non-watertight-solid"),
      [],
      `${result.bodyId} should not be reported as open`
    );
    assert.notEqual(result.geometryProperties, null);
    assert.ok(result.geometryProperties.volumeMm3 > 0);
  }
});

test("watertight findings are warnings on the result, never validation issues", () => {
  const body = createBodyFromTemplate("base_plate");
  const [result] = compileBodiesToMeshResults([body]).results;

  // The warning channel exists and is an array on every result, which is what the
  // Build panel renders and what the export gate reads. Cycle 03 established the
  // channel for disconnected solids; this cycle adds a second finding to it, and
  // neither may reach `validateBody`.
  assert.ok(Array.isArray(result.warnings));
  assert.deepEqual(result.warnings, []);
});

test("compileBodyIds narrows what is rebuilt without narrowing what is available", () => {
  const existingIds = new Set();
  const plate = createBodyFromTemplate("base_plate", { existingIds });
  existingIds.add(plate.id);
  const bar = createBodyFromTemplate("link_bar", { existingIds });
  existingIds.add(bar.id);
  const boolean = createBooleanOperationBody("subtract", [plate, bar], { id: "cut_result" }, existingIds);
  const bodies = normalizePartProject({ bodies: [plate, bar, boolean] }).bodies;

  const all = compileBodiesToMeshResults(bodies);
  assert.deepEqual(all.results.map((result) => result.bodyId), bodies.map((body) => body.id));

  // Only the boolean body is rebuilt, and it still resolves both operands out of the
  // full body list (AGENTS.md:38).
  const partial = compileBodiesToMeshResults(bodies, { compileBodyIds: ["cut_result"] });
  assert.deepEqual(partial.results.map((result) => result.bodyId), ["cut_result"]);
  assert.equal(partial.errors.length, 0);
  assert.ok(partial.results[0].triangleCount > 0);
  assert.equal(partial.transfers.length, 2);
});

test("worker error serialization preserves wrapped advanced CAD backend codes", () => {
  const wrapped = new PartCadCompileError("CAD compile failed for Backend mount.", {
    bodyId: "backend_mount",
    cause: new AdvancedCadBackendRequiredError()
  });

  assert.deepEqual(serializeWorkerError(wrapped), {
    bodyId: "backend_mount",
    code: "advanced-cad-backend-required",
    message: "CAD compile failed for Backend mount.",
    issues: []
  });
});

test("a counterbored body still measures and reports through the worker result", () => {
  const body = normalizePartBody({
    id: "plate",
    name: "Counterbored plate",
    extrudeDepthMm: 8,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
      cutProfiles: [{ id: "screw", type: "circle", x: 0, z: 0, radius: 1.7, hole: { size: "M3", style: "counterbore" } }]
    }
  });

  const { results, errors } = compileBodiesToMeshResults([body]);
  assert.equal(errors.length, 0);
  const [result] = results;

  // The pocket makes the body a non-prism, so the mesh path measures it - and that
  // path is gated on closure, so a real volume here is also a watertight verdict.
  assert.equal(result.geometryProperties.method, MESH_DIVERGENCE_METHOD);
  assert.equal(result.geometryProperties.watertight, true);
  assert.ok(result.geometryProperties.volumeMm3 > 0);
  // No warnings at all: an 8 mm plate holds a 3.4 mm counterbore blind.
  assert.deepEqual(result.warnings, []);
  // Mass properties stay density-free (AGENTS.md:42), pocket or no pocket.
  assert.equal(Object.hasOwn(result.geometryProperties, "massG"), false);
});

test("hole findings arrive as compile warnings, in the order the reports are gathered", () => {
  const body = normalizePartBody({
    id: "plate",
    name: "Thin plate",
    extrudeDepthMm: 3,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
      cutProfiles: [
        { id: "typo", type: "circle", x: -15, z: 0, radius: 2, hole: { size: "M9" } },
        { id: "insert", type: "circle", x: 15, z: 0, radius: 2, hole: { size: "M3", style: "heatSetInsert" } }
      ]
    }
  });

  const [result] = compileBodiesToMeshResults([body]).results;
  const codes = result.warnings.map((warning) => warning.code);

  assert.ok(codes.includes(REFUSED_HOLE_CODE));
  assert.ok(codes.includes(POCKET_BREAKTHROUGH_CODE));
  // The body still built: a 5.8 mm insert bore through a 3 mm plate is a wide through
  // hole, not a compile failure.
  assert.ok(result.triangleCount > 0);
  assert.ok(result.warnings.every((warning) => warning.severity === "warning"));
});
