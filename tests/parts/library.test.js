import assert from "node:assert/strict";
import test from "node:test";

import { createPartProject } from "../../src/parts/contracts.js";
import { createBooleanOperationBody, createRevolveBodyFromPreset } from "../../src/parts/featureOps.js";
import { createSpurGearBody } from "../../src/parts/gears.js";
import {
  addPartLibraryItemToProject,
  collectPartLibraryBodyIds,
  createPartLibraryItem,
  mergePartLibraryItems,
  parsePartLibraryBundleJson,
  serializePartLibraryBundle
} from "../../src/parts/library.js";
import { addBody } from "../../src/parts/projectState.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validatePartProject } from "../../src/parts/validation.js";

function projectWithBodies(bodies, selectedBodyId = bodies.at(-1)?.id) {
  return createPartProject({
    bodies,
    selectedBodyId,
    updatedAt: "2026-05-27T12:00:00.000Z"
  });
}

test("creates library items from sketch, revolve, and gear bodies", () => {
  const sketch = createBodyFromTemplate("base_plate");
  const revolve = createRevolveBodyFromPreset("spacer");
  const gear = createSpurGearBody();

  for (const body of [sketch, revolve, gear]) {
    const item = createPartLibraryItem(projectWithBodies([body]), body.id, {
      createdAt: "2026-05-27T12:00:00.000Z",
      updatedAt: "2026-05-27T12:00:00.000Z"
    });

    assert.equal(item.version, 1);
    assert.equal(item.primaryBodyId, body.id);
    assert.equal(item.bodies.length, 1);
    assert.equal(item.bodies[0].source.kind, body.source.kind);
  }
});

test("saves boolean bodies with recursive operand dependencies", () => {
  const base = createBodyFromTemplate("base_plate");
  const spacer = createBodyFromTemplate("spacer_standoff");
  const servo = createBodyFromTemplate("servo_mount_plate");
  const firstBoolean = createBooleanOperationBody("subtract", [base, spacer], {}, new Set([base.id, spacer.id]));
  const secondBoolean = createBooleanOperationBody(
    "intersect",
    [firstBoolean, servo],
    { id: "nested_boolean" },
    new Set([base.id, spacer.id, servo.id, firstBoolean.id])
  );
  const project = projectWithBodies([secondBoolean, base, spacer, firstBoolean, servo], secondBoolean.id);

  assert.deepEqual(collectPartLibraryBodyIds(project, secondBoolean.id), [
    base.id,
    spacer.id,
    firstBoolean.id,
    servo.id,
    secondBoolean.id
  ]);

  const item = createPartLibraryItem(project, secondBoolean.id);
  assert.deepEqual(item.bodies.map((body) => body.id), [
    base.id,
    spacer.id,
    firstBoolean.id,
    servo.id,
    secondBoolean.id
  ]);
});

test("adds library items with collision-free body ids and rewritten boolean operands", () => {
  const base = createBodyFromTemplate("base_plate");
  const spacer = createBodyFromTemplate("spacer_standoff");
  const booleanBody = createBooleanOperationBody("subtract", [base, spacer], {}, new Set([base.id, spacer.id]));
  const item = createPartLibraryItem(projectWithBodies([base, spacer, booleanBody], booleanBody.id), booleanBody.id);
  const currentProject = addBody(createPartProject(), createBodyFromTemplate("base_plate"));

  const result = addPartLibraryItemToProject(currentProject, item, {
    updatedAt: "2026-05-27T12:10:00.000Z"
  });
  const addedBoolean = result.project.bodies.find((body) => body.id === result.primaryBodyId);

  assert.equal(validatePartProject(result.project).length, 0);
  assert.deepEqual(result.project.bodies.map((body) => body.id), [
    "base_plate",
    "base_plate_2",
    "spacer_standoff",
    "subtract_body"
  ]);
  assert.deepEqual(addedBoolean.boolean.operandBodyIds, ["base_plate_2", "spacer_standoff"]);
  assert.equal(result.project.selectedBodyId, "subtract_body");
});

test("exports, imports, merges, and rejects invalid library bundles", () => {
  const body = createBodyFromTemplate("link_bar");
  const item = createPartLibraryItem(projectWithBodies([body], body.id), body.id, {
    id: "saved_link",
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:00:00.000Z"
  });
  const exported = serializePartLibraryBundle([item], {
    exportedAt: "2026-05-27T12:05:00.000Z"
  });
  const parsed = parsePartLibraryBundleJson(exported);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.items[0].id, "saved_link");

  const replacement = { ...parsed.items[0], name: "Updated link" };
  const merged = mergePartLibraryItems([item], [replacement]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Updated link");

  assert.throws(
    () => parsePartLibraryBundleJson(JSON.stringify({ version: 1, items: [{ ...item, primaryBodyId: "missing" }] })),
    /primary body must exist/
  );
  assert.throws(() => parsePartLibraryBundleJson("{nope"), /Part library JSON is invalid/);
});
