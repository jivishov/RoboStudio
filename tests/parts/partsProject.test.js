import assert from "node:assert/strict";
import test from "node:test";

import {
  createGeneratedBodyMetadata,
  createPartProject,
  createSketchExtrudeBody,
  sanitizePartId,
  uniquePartId
} from "../../src/parts/contracts.js";
import {
  addBody,
  commitProject,
  createProjectHistory,
  duplicateBody,
  normalizePartProject,
  redoProject,
  undoProject,
  updateBody
} from "../../src/parts/projectState.js";
import { parsePartProjectJson, serializePartProject } from "../../src/parts/serialization.js";
import { createGeneratedAssemblySnapshot, createGeneratedPartSnapshot } from "../../src/parts/snapshot.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validateBody } from "../../src/parts/validation.js";

test("creates PartProject defaults and stable ids", () => {
  const project = createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" });

  assert.equal(project.version, 1);
  assert.equal(project.units, "mm");
  assert.deepEqual(project.bodies, []);
  assert.equal(project.selectedBodyId, null);
  assert.equal(project.updatedAt, "2026-05-25T10:00:00.000Z");
  assert.equal(sanitizePartId("Servo Mount Plate.stl"), "servo_mount_plate");
  assert.equal(uniquePartId("body", new Set(["body", "body_2"])), "body_3");
});

test("normalizes bodies and keeps source contract server-independent", () => {
  const body = createSketchExtrudeBody({
    id: "Base Plate",
    name: "Base Plate",
    color: "not-a-color",
    transform: { position: ["1", "bad", 3], scale: [1, 0, 2] },
    sketch: createBodyFromTemplate("base_plate").sketch,
    extrudeDepthMm: "8"
  });

  const project = normalizePartProject({ bodies: [body], selectedBodyId: body.id });
  assert.equal(project.bodies[0].id, "base_plate");
  assert.equal(project.bodies[0].color, "#2563eb");
  assert.deepEqual(project.bodies[0].transform.position, [1, 0, 3]);
  assert.deepEqual(project.bodies[0].transform.scale, [1, 1, 2]);
  assert.equal(project.bodies[0].source.kind, "sketchExtrude");
});

test("updates, duplicates, and preserves undo redo history", () => {
  const history = createProjectHistory(createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" }));
  const first = addBody(history.current, createBodyFromTemplate("link_bar"), {
    updatedAt: "2026-05-25T10:01:00.000Z"
  });
  commitProject(history, first);

  const renamed = updateBody(history.current, history.current.selectedBodyId, (body) => {
    body.name = "Driven link";
    body.extrudeDepthMm = 7.5;
    return body;
  }, { updatedAt: "2026-05-25T10:02:00.000Z" });
  commitProject(history, renamed);

  assert.equal(history.current.bodies[0].name, "Driven link");
  assert.equal(history.current.bodies[0].extrudeDepthMm, 7.5);

  const duplicated = duplicateBody(history.current, history.current.selectedBodyId, {
    updatedAt: "2026-05-25T10:03:00.000Z"
  });
  commitProject(history, duplicated);
  assert.equal(history.current.bodies.length, 2);
  assert.equal(history.current.bodies[1].id, "link_bar_copy");
  assert.equal(history.current.selectedBodyId, "link_bar_copy");

  undoProject(history);
  assert.equal(history.current.bodies.length, 1);
  assert.equal(history.current.bodies[0].name, "Driven link");

  redoProject(history);
  assert.equal(history.current.bodies.length, 2);
});

test("serializes and parses PartProject JSON round trip", () => {
  const project = addBody(
    createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" }),
    createBodyFromTemplate("spacer_standoff"),
    { updatedAt: "2026-05-25T10:01:00.000Z" }
  );
  const serialized = serializePartProject(project);
  const parsed = parsePartProjectJson(serialized);

  assert.deepEqual(parsed, project);
  assert.throws(() => parsePartProjectJson("{nope"), /PartProject JSON is invalid/);
});

test("preserves unsupported body source kinds for validation", () => {
  const project = normalizePartProject({
    bodies: [
      {
        id: "future_body",
        name: "Future body",
        source: { kind: "futureKernel" }
      }
    ],
    selectedBodyId: "future_body",
    updatedAt: "2026-05-25T10:00:00.000Z"
  });

  assert.equal(project.bodies[0].source.kind, "futureKernel");
  assert.ok(validateBody(project.bodies[0]).some((issue) => issue.code === "unsupported-body-source"));
});

test("creates generated body and assembly snapshot contract metadata", () => {
  const body = createBodyFromTemplate("base_plate");
  const metadata = createGeneratedBodyMetadata(body);
  const part = createGeneratedPartSnapshot(body, { triangles: 12, bounds: { size: [1, 2, 3] } });
  const snapshot = createGeneratedAssemblySnapshot({
    savedAt: "2026-05-25T10:00:00.000Z",
    glb: "binary",
    bodies: [body]
  });

  assert.deepEqual(metadata, {
    id: "base_plate",
    label: "Base plate",
    type: "generated",
    file: null,
    source: "part-studio"
  });
  assert.equal(part.triangles, 12);
  assert.deepEqual(part.bounds, { size: [1, 2, 3] });
  assert.equal(snapshot.savedAt, "2026-05-25T10:00:00.000Z");
  assert.equal(snapshot.glb, "binary");
  assert.equal(snapshot.parts[0].source, "part-studio");
  assert.equal(snapshot.layout, null);
});
