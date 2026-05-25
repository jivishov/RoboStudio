import assert from "node:assert/strict";
import test from "node:test";

import { createPartProject } from "../../src/parts/contracts.js";
import { addBody } from "../../src/parts/projectState.js";
import { createBodyFromTemplate, listPartTemplates } from "../../src/parts/templates.js";
import { validateBody, validatePartProject } from "../../src/parts/validation.js";

test("creates all V1 starter templates as valid sketch-extrude bodies", () => {
  const templates = listPartTemplates();
  assert.deepEqual(
    templates.map((template) => template.id),
    [
      "base_plate",
      "link_bar",
      "servo_mount_plate",
      "l_bracket",
      "u_bracket",
      "spacer_standoff",
      "axle_shaft",
      "gripper_finger"
    ]
  );

  for (const template of templates) {
    const body = createBodyFromTemplate(template.id);
    assert.equal(body.source.kind, "sketchExtrude");
    assert.ok(body.sketch.outerProfile);
    assert.equal(validateBody(body).length, 0, `${template.id} should validate`);
  }
});

test("template insertion produces unique body ids", () => {
  let project = createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" });
  project = addBody(project, createBodyFromTemplate("base_plate"), {
    updatedAt: "2026-05-25T10:01:00.000Z"
  });
  project = addBody(project, createBodyFromTemplate("base_plate"), {
    updatedAt: "2026-05-25T10:02:00.000Z"
  });

  assert.deepEqual(project.bodies.map((body) => body.id), ["base_plate", "base_plate_2"]);
  assert.equal(project.selectedBodyId, "base_plate_2");
  assert.equal(validatePartProject(project).length, 0);
});

test("templates cover holes and cutouts expected for robotic parts", () => {
  const basePlate = createBodyFromTemplate("base_plate");
  const servoMount = createBodyFromTemplate("servo_mount_plate");
  const axle = createBodyFromTemplate("axle_shaft");

  assert.equal(basePlate.sketch.cutProfiles.length, 4);
  assert.ok(servoMount.sketch.cutProfiles.some((profile) => profile.id === "servo_window"));
  assert.equal(axle.sketch.outerProfile.type, "circle");
  assert.equal(axle.sketch.cutProfiles.length, 0);
});
