import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import {
  createBooleanOperationBody,
  createCircularPatternProfiles,
  createLinearPatternProfiles,
  createRevolveBodyFromPreset,
  validateBooleanFeature,
  validateRevolveFeature
} from "../../src/parts/featureOps.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { addBody } from "../../src/parts/projectState.js";
import { createCircularHole } from "../../src/parts/sketch.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validatePartProject } from "../../src/parts/validation.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;

test("creates linear and circular profile patterns with stable unique ids", () => {
  const hole = createCircularHole({ id: "hole", radius: 2 });
  const linear = createLinearPatternProfiles(hole, {
    count: 4,
    spacingX: 10,
    idPrefix: "vent",
    existingIds: new Set(["outer"])
  });
  const circular = createCircularPatternProfiles(hole, {
    count: 6,
    radius: 20,
    idPrefix: "bolt",
    existingIds: new Set(["outer", ...linear.map((profile) => profile.id)])
  });

  assert.deepEqual(linear.map((profile) => profile.id), ["vent_1", "vent_2", "vent_3", "vent_4"]);
  assert.equal(circular.length, 6);
  assert.equal(new Set([...linear, ...circular].map((profile) => profile.id)).size, 10);
  assert.equal(linear[0].x, -15);
  assert.equal(linear[3].x, 15);
  assert.equal(Number(Math.hypot(circular[0].x, circular[0].z).toFixed(3)), 20);
});

test("creates and compiles revolved lathe bodies", () => {
  const body = createRevolveBodyFromPreset("spacer");
  const solid = compilePartBodyToSolid(body);
  const [min, max] = measureBoundingBox(solid);

  assert.equal(body.source.kind, "revolve");
  assert.deepEqual(validateRevolveFeature(body.revolve), []);
  assert.ok(max[1] - min[1] >= 23);
  assert.ok(max[0] - min[0] >= 21);
  assert.ok(measureVolume(solid) > 0);
});

test("creates boolean operation bodies from existing compiled bodies", () => {
  let project = createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" });
  const base = createBodyFromTemplate("base_plate");
  const window = createBodyFromTemplate("servo_mount_plate");
  project = addBody(project, base);
  project = addBody(project, window);

  const booleanBody = createBooleanOperationBody("intersect", project.bodies, {}, new Set(project.bodies.map((body) => body.id)));
  project = addBody(project, booleanBody);
  const normalizedBoolean = project.bodies.find((body) => body.source.kind === "booleanOperation");
  const solid = compilePartBodyToSolid(normalizedBoolean, { bodies: project.bodies });

  assert.deepEqual(validateBooleanFeature(normalizedBoolean.boolean, "boolean", new Set(project.bodies.map((body) => body.id)), normalizedBoolean.id), []);
  assert.equal(validatePartProject(project).length, 0);
  assert.ok(measureVolume(solid) > 0);
});

test("validates boolean operands regardless of body order in project JSON", () => {
  const base = createBodyFromTemplate("base_plate");
  const spacer = createBodyFromTemplate("spacer_standoff");
  const booleanBody = createBooleanOperationBody("subtract", [base, spacer], {}, new Set([base.id, spacer.id]));
  const project = createPartProject({
    bodies: [booleanBody, base, spacer],
    selectedBodyId: booleanBody.id,
    updatedAt: "2026-05-25T10:00:00.000Z"
  });

  assert.equal(validatePartProject(project).length, 0);
});
