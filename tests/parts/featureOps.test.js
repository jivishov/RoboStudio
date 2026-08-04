import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import {
  createBooleanOperationBody,
  createCircularPatternProfiles,
  createLinearPatternProfiles,
  createRevolveBodyFromPreset,
  normalizeRevolveFeature,
  validateBooleanFeature,
  validateRevolveFeature
} from "../../src/parts/featureOps.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { addBody, normalizePartBody, normalizePartProject } from "../../src/parts/projectState.js";
import { parsePartProjectJson, serializePartProject } from "../../src/parts/serialization.js";
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

test("a partial revolve angle round-trips through the normalizers", () => {
  const body = createRevolveBodyFromPreset("wheel", { angleDeg: 90 });
  assert.equal(body.revolve.angleDeg, 90);

  // Landmine two: the field is only persisted if the whitelist knows about it, so the
  // round trip has to go through normalizePartBody and not just the feature normalizer.
  const normalized = normalizePartBody(body);
  assert.equal(normalized.revolve.angleDeg, 90);
  assert.equal(normalizePartBody(normalized).revolve.angleDeg, 90);

  const project = normalizePartProject({ bodies: [body], selectedBodyId: body.id });
  assert.equal(project.bodies[0].revolve.angleDeg, 90);
  assert.equal(
    parsePartProjectJson(serializePartProject(project)).bodies[0].revolve.angleDeg,
    90
  );
});

test("revolve angles are clamped to a usable sweep and a missing angle is a full turn", () => {
  assert.equal(normalizeRevolveFeature({}).angleDeg, 360);
  assert.equal(normalizeRevolveFeature({ angleDeg: 0 }).angleDeg, 360);
  assert.equal(normalizeRevolveFeature({ angleDeg: -30 }).angleDeg, 360);
  assert.equal(normalizeRevolveFeature({ angleDeg: 540 }).angleDeg, 360);
  assert.equal(normalizeRevolveFeature({ angleDeg: "180" }).angleDeg, 180);
  assert.equal(normalizeRevolveFeature({ angleDeg: Number.NaN }).angleDeg, 360);

  // A raw body carrying an unusable angle is a structural fault, so it belongs in the
  // compile gate rather than in an advisory report.
  assert.ok(validateRevolveFeature({ ...normalizeRevolveFeature({}), angleDeg: 0 })
    .some((issue) => issue.code === "invalid-revolve-angle"));
  assert.ok(validateRevolveFeature({ ...normalizeRevolveFeature({}), angleDeg: 400 })
    .some((issue) => issue.code === "invalid-revolve-angle"));
});

test("a partial revolve compiles to a capped wedge of the full solid", () => {
  const full = createRevolveBodyFromPreset("wheel");
  const half = createRevolveBodyFromPreset("wheel", { angleDeg: 180 });
  const quarter = createRevolveBodyFromPreset("wheel", { angleDeg: 90 });

  const fullVolume = measureVolume(compilePartBodyToSolid(full));
  const halfVolume = measureVolume(compilePartBodyToSolid(half));
  const quarterVolume = measureVolume(compilePartBodyToSolid(quarter));

  assert.ok(halfVolume > 0);
  assert.ok(Math.abs(halfVolume / fullVolume - 0.5) < 0.02, `half is ${halfVolume / fullVolume} of full`);
  assert.ok(Math.abs(quarterVolume / fullVolume - 0.25) < 0.02, `quarter is ${quarterVolume / fullVolume} of full`);

  // Capped, so it is a closed solid the mesh path can still measure.
  const [min, max] = measureBoundingBox(compilePartBodyToSolid(half));
  assert.ok(max[0] - min[0] > 0);
  assert.ok(max[2] - min[2] > 0);
});

test("segments count a whole revolution, so a partial sweep keeps the same facet width", () => {
  // The other half of the partial-revolve decision, and the half a volume-ratio test
  // cannot see: a half sweep built at half the facet width is still half the volume to
  // well inside the 2 percent band above.
  const full = createRevolveBodyFromPreset("wheel");
  const half = createRevolveBodyFromPreset("wheel", { angleDeg: 180 });
  assert.equal(half.revolve.segments, full.revolve.segments);
  assert.equal(normalizeRevolveFeature({ angleDeg: 90 }).segments, normalizeRevolveFeature({}).segments);

  // `extrudeRotate` scales the whole-turn count down to the requested angle itself, so
  // side facets accumulate linearly with the sweep: equal angular steps add equal facet
  // counts. Pre-scaling `segments` by the angle fraction would make them accumulate with
  // the square of it, which is what this catches - and the cap polygons, identical across
  // all three partial sweeps, cancel out of the differences.
  const facets = [90, 180, 270].map(
    (angleDeg) => compilePartBodyToSolid(createRevolveBodyFromPreset("wheel", { angleDeg })).polygons.length
  );
  assert.equal(facets[1] - facets[0], facets[2] - facets[1]);
  assert.ok(facets[0] > 0 && facets[1] > facets[0]);
});

test("revolve segments default to the profile radius and stay respected once stored", () => {
  const shaft = createRevolveBodyFromPreset("shaft");
  const wheel = createRevolveBodyFromPreset("wheel");

  // The wheel is five times the radius of the shaft, so it earns more segments.
  assert.ok(wheel.revolve.segments > shaft.revolve.segments);
  // An explicit count is a user decision and is left alone.
  assert.equal(createRevolveBodyFromPreset("wheel", { segments: 24 }).revolve.segments, 24);
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
