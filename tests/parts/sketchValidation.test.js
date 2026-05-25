import assert from "node:assert/strict";
import test from "node:test";

import { createPartProject } from "../../src/parts/contracts.js";
import { addBody } from "../../src/parts/projectState.js";
import {
  createCircularHole,
  createCircleProfile,
  createPolylineProfile,
  createRectangleProfile,
  createRoundedSlotProfile
} from "../../src/parts/sketch.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validateBody, validatePartProject } from "../../src/parts/validation.js";

test("validates one closed outer profile with closed cut profiles", () => {
  const body = createBodyFromTemplate("link_bar");
  assert.deepEqual(validateBody(body), []);
});

test("rejects missing, open, and unsupported outer profiles", () => {
  const missing = createBodyFromTemplate("base_plate");
  missing.sketch.outerProfile = null;
  assert.ok(validateBody(missing).some((item) => item.code === "missing-outer-profile"));

  const open = createBodyFromTemplate("base_plate");
  open.sketch.outerProfile = createPolylineProfile({
    id: "outer",
    closed: false,
    points: [
      [0, 0],
      [10, 0],
      [10, 10]
    ]
  });
  assert.ok(validateBody(open).some((item) => item.code === "open-outer-profile" || item.code === "open-profile"));

  const unsupported = createBodyFromTemplate("base_plate");
  unsupported.sketch.outerProfile = { id: "outer", type: "spline", points: [] };
  assert.ok(validateBody(unsupported).some((item) => item.code === "unsupported-profile"));
});

test("detects invalid dimensions and outside holes", () => {
  const rectangle = createBodyFromTemplate("base_plate");
  rectangle.sketch.outerProfile = createRectangleProfile({ id: "outer", width: 20, height: 20 });
  rectangle.sketch.cutProfiles = [createCircularHole({ id: "hole", x: 40, z: 0, radius: 3 })];
  assert.ok(validateBody(rectangle).some((item) => item.code === "cut-outside-outer-profile"));

  const circle = createBodyFromTemplate("spacer_standoff");
  circle.sketch.outerProfile = createCircleProfile({ id: "outer", radius: 10 });
  circle.sketch.cutProfiles = [createCircularHole({ id: "hole", x: 8, z: 0, radius: 4 })];
  assert.ok(validateBody(circle).some((item) => item.code === "cut-outside-outer-profile"));

  const slot = createBodyFromTemplate("link_bar");
  slot.sketch.outerProfile = createRoundedSlotProfile({ id: "outer", length: 10, width: 20 });
  slot.sketch.outerProfile.length = 10;
  assert.ok(validateBody(slot).some((item) => item.code === "invalid-slot-dimension"));
});

test("detects cuts inside a polyline bounding box but outside the actual closed profile", () => {
  const lBracket = createBodyFromTemplate("l_bracket");
  lBracket.sketch.cutProfiles.push(createCircularHole({ id: "missing_corner_hole", x: 20, z: 20, radius: 3 }));

  assert.ok(validateBody(lBracket).some((item) => item.code === "cut-outside-outer-profile"));
});

test("detects duplicate ids in bodies and profiles", () => {
  const body = createBodyFromTemplate("base_plate");
  body.sketch.cutProfiles[0].id = "outer";
  assert.ok(validateBody(body).some((item) => item.code === "duplicate-profile-id"));

  const project = createPartProject({
    bodies: [createBodyFromTemplate("base_plate"), createBodyFromTemplate("base_plate")],
    selectedBodyId: "base_plate",
    updatedAt: "2026-05-25T10:00:00.000Z"
  });
  assert.ok(validatePartProject(project).some((item) => item.code === "duplicate-body-id"));
});

test("validates project selection and template state through add body", () => {
  let project = createPartProject({ selectedBodyId: "missing", updatedAt: "2026-05-25T10:00:00.000Z" });
  project = addBody(project, createBodyFromTemplate("u_bracket"), {
    updatedAt: "2026-05-25T10:01:00.000Z"
  });

  assert.equal(project.selectedBodyId, "u_bracket");
  assert.equal(validatePartProject(project).length, 0);

  project.selectedBodyId = "missing";
  assert.ok(validatePartProject(project).some((item) => item.code === "invalid-selection"));
});
