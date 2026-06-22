import assert from "node:assert/strict";
import test from "node:test";

import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { addBody } from "../../src/parts/projectState.js";
import { createBodyFromTemplate, listPartTemplates } from "../../src/parts/templates.js";
import { validateBody, validatePartProject } from "../../src/parts/validation.js";

const EXPECTED_TEMPLATE_IDS = Object.freeze([
  "base_plate",
  "link_bar",
  "l_bracket",
  "u_bracket",
  "triangular_gusset_plate",
  "tube_connector_plate",
  "servo_mount_plate",
  "motor_face_mount",
  "servo_horn_disk",
  "spacer_standoff",
  "axle_shaft",
  "bearing_block_plate",
  "wheel_hub_flange",
  "linear_rail_carriage",
  "sensor_mount_plate",
  "electronics_tray",
  "gripper_finger",
  "end_effector_palm",
  "drive_chassis_side_plate",
  "quad_motor_arm_plate"
]);

test("creates all V1 starter templates as valid sketch-extrude bodies", () => {
  const templates = listPartTemplates();
  assert.deepEqual(templates.map((template) => template.id), EXPECTED_TEMPLATE_IDS);
  assert.ok(templates.every((template) => template.category));

  for (const template of templates) {
    const body = createBodyFromTemplate(template.id);
    assert.equal(body.source.kind, "sketchExtrude");
    assert.ok(body.sketch.outerProfile);
    assert.equal(validateBody(body).length, 0, `${template.id} should validate`);
    assert.ok(compilePartBodyToSolid(body), `${template.id} should compile`);
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
  const bearingBlock = createBodyFromTemplate("bearing_block_plate");
  const motorMount = createBodyFromTemplate("motor_face_mount");
  const sensorMount = createBodyFromTemplate("sensor_mount_plate");
  const wheelHub = createBodyFromTemplate("wheel_hub_flange");
  const chassisPlate = createBodyFromTemplate("drive_chassis_side_plate");
  const quadArm = createBodyFromTemplate("quad_motor_arm_plate");

  assert.equal(basePlate.sketch.cutProfiles.length, 4);
  assert.ok(servoMount.sketch.cutProfiles.some((profile) => profile.id === "servo_window"));
  assert.equal(axle.sketch.outerProfile.type, "circle");
  assert.equal(axle.sketch.cutProfiles.length, 0);
  assert.ok(bearingBlock.sketch.cutProfiles.some((profile) => profile.id === "bearing_bore"));
  assert.ok(motorMount.sketch.cutProfiles.some((profile) => profile.id === "pilot_bore"));
  assert.ok(sensorMount.sketch.cutProfiles.some((profile) => profile.id === "sensor_window"));
  assert.equal(wheelHub.sketch.cutProfiles.filter((profile) => profile.id.startsWith("bolt_hole_")).length, 6);
  assert.ok(chassisPlate.sketch.cutProfiles.some((profile) => profile.id === "front_axle"));
  assert.ok(quadArm.sketch.cutProfiles.some((profile) => profile.id === "body_mount_slot"));
});
