import assert from "node:assert/strict";
import test from "node:test";

import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { validateManufacturability } from "../../src/parts/dfm.js";
import { profileHoleResolution } from "../../src/parts/holes.js";
import { addBody } from "../../src/parts/projectState.js";
import {
  PART_TEMPLATES,
  TEMPLATE_NON_FASTENER_CUTS,
  createBodyFromTemplate,
  listPartTemplates
} from "../../src/parts/templates.js";
import {
  componentDimensionMm,
  locatingBoreMm
} from "../../src/parts/standards/components.js";
import { clearanceHoleDiameterMm } from "../../src/parts/standards/fasteners.js";
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

/** Every circular cut of a template, which is the only kind that can carry a `hole`. */
function circularCuts(body) {
  return body.sketch.cutProfiles.filter((profile) => profile.type === "circle");
}

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

/* ---------------------------------------------- the retrofit's central claim */

test("every circular cut in every template is a resolvable standard or a listed non-fastener", () => {
  // The acceptance criterion, and the reason `TEMPLATE_NON_FASTENER_CUTS` is exported.
  // A template hole is one of exactly two things and the file has to say which. The
  // failure this prevents is not a wrong number - it is a hole nobody classified, which
  // is how a radius survives beside a standard.
  for (const template of PART_TEMPLATES) {
    const body = createBodyFromTemplate(template.id);
    const registry = TEMPLATE_NON_FASTENER_CUTS[template.id] ?? {};

    for (const profile of circularCuts(body)) {
      const resolved = profileHoleResolution(profile);
      const listed = registry[profile.id];

      if (resolved?.ok) {
        assert.equal(
          listed,
          undefined,
          `${template.id}/${profile.id} resolves a fastener and must not also be listed as a non-fastener`
        );
        // And the radius genuinely came from the table rather than agreeing with it by
        // coincidence, which is the defect this cycle exists to remove.
        assert.equal(profile.radius, resolved.pilotRadiusMm, `${template.id}/${profile.id}`);
      } else {
        assert.equal(resolved, null, `${template.id}/${profile.id} carries a hole that will not resolve`);
        assert.ok(
          typeof listed === "string" && listed.length > 20,
          `${template.id}/${profile.id} has no standard and no recorded reason for not having one`
        );
      }
    }

    // The other direction: a registry entry naming a profile the template no longer
    // has is a stale claim, and stale claims are how a registry stops being checkable.
    for (const profileId of Object.keys(registry)) {
      assert.ok(
        circularCuts(body).some((profile) => profile.id === profileId),
        `${template.id} lists ${profileId} as a non-fastener but has no such circular cut`
      );
    }
  }

  // Nothing is registered for a template that does not exist.
  for (const templateId of Object.keys(TEMPLATE_NON_FASTENER_CUTS)) {
    assert.ok(EXPECTED_TEMPLATE_IDS.includes(templateId), `${templateId} is not a template`);
  }
});

/**
 * The argument text of every `createCircularHole({...})` call in a source string.
 *
 * Brace-matched rather than regexed. The first attempt used `\{[^}]*\}`, which stops at
 * the first closing brace and therefore never matched a single call carrying a nested
 * `hole: { ... }` - so the check it fed passed by seeing nothing. A test that cannot
 * fail is worse than no test, so the scanner is written out.
 */
function circularHoleCallArguments(source) {
  const marker = "createCircularHole({";
  const calls = [];
  let index = source.indexOf(marker);
  while (index !== -1) {
    let depth = 0;
    let cursor = index + marker.length - 1;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "{") depth += 1;
      else if (source[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(index + marker.length - 1, cursor + 1));
    index = source.indexOf(marker, cursor);
  }
  return calls;
}

/** A call carrying both a named standard and a hand-typed radius: the defect's shape. */
function offends(call) {
  return call.includes("hole:") && /radius:/u.test(call);
}

test("no template authors a radius for a fastener hole, in the source itself", async () => {
  // The behavioural test above catches a wrong number. This catches the thing a future
  // author will actually write: `radius: 1.7` beside an M3 hole "for clarity". Cycle 05
  // rejected that explicitly - a label that can disagree with its number reproduces the
  // defect - so it is checked at the source rather than left to reviewer discipline.
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../../src/parts/templates.js", import.meta.url), "utf8");
  const calls = circularHoleCallArguments(source);

  // The scanner is proved to see both shapes before it is trusted to find neither.
  assert.ok(calls.some((call) => call.includes("hole:")), "the scanner should see standards holes");
  assert.ok(calls.some((call) => /radius:/u.test(call)), "the scanner should see plain radii");
  assert.deepEqual(
    calls.filter((call) => offends(call)),
    [],
    "a hole that names a standard must not also carry a radius"
  );

  // The negative control, run rather than merely once performed. Seeing both shapes
  // separately does not prove the scanner can see them together, and "together" is the
  // violation. So the violation is injected into a copy of the real source and the
  // scanner is required to find exactly one - if this stops holding, the assertion above
  // has gone back to passing by seeing nothing, which is where this check started.
  const injected = source.replace(
    'createCircularHole({ id: "upright_hole", x: -25, z: 14, hole: { size: "M5" } })',
    'createCircularHole({ id: "upright_hole", x: -25, z: 14, radius: 2.8, hole: { size: "M5" } })'
  );
  assert.notEqual(injected, source, "the injection site must still exist for the control to mean anything");
  assert.equal(circularHoleCallArguments(injected).filter((call) => offends(call)).length, 1);
});

test("base plate mount holes measure M3 clearance, asserted through the fastener table", () => {
  // Deliberately not against the literal 3.4. A test that writes 3.4 proves the number
  // was typed twice; this one proves the template and the standard cannot drift apart.
  const body = createBodyFromTemplate("base_plate");
  const holes = body.sketch.cutProfiles;

  assert.equal(holes.length, 4);
  for (const hole of holes) {
    assert.equal(hole.radius * 2, clearanceHoleDiameterMm("M3", "normal"));
    assert.equal(hole.hole.size, "M3");
    assert.equal(hole.hole.fit, "normal");
    assert.equal(hole.hole.lockSize, true);
  }
});

test("the four radius-for-diameter defects are gone and none of them left a radius behind", () => {
  const expected = {
    base_plate: { ids: ["mount_hole_1", "mount_hole_2", "mount_hole_3", "mount_hole_4"], size: "M3" },
    link_bar: { ids: ["pivot_hole_a", "pivot_hole_b"], size: "M4" },
    u_bracket: { ids: ["left_pivot", "right_pivot"], size: "M3" },
    tube_connector_plate: {
      ids: [
        "tube_hole_1", "tube_hole_2", "tube_hole_3", "tube_hole_4",
        "tube_hole_5", "tube_hole_6", "tube_hole_7", "tube_hole_8"
      ],
      size: "M3"
    },
    spacer_standoff: { ids: ["bore"], size: "M3" }
  };

  for (const [templateId, { ids, size }] of Object.entries(expected)) {
    const body = createBodyFromTemplate(templateId);
    for (const id of ids) {
      const profile = body.sketch.cutProfiles.find((cut) => cut.id === id);
      assert.ok(profile, `${templateId}/${id} should exist`);
      assert.equal(profile.hole?.size, size, `${templateId}/${id}`);
      assert.equal(profile.radius * 2, clearanceHoleDiameterMm(size, "normal"), `${templateId}/${id}`);
    }
  }
});

test("the motor face mount is the NEMA 17 pattern its source names, not a 36 mm square", () => {
  // The shipped square was plus-or-minus 18, so 36 mm where NEMA ICS 16-2001 gives
  // 31.0. Asserted through the component table, whose entry carries the standard's own
  // inch figure so the number can be re-checked against the document.
  const body = createBodyFromTemplate("motor_face_mount");
  const bolts = body.sketch.cutProfiles.filter((profile) => profile.id.startsWith("motor_hole_"));
  const half = componentDimensionMm("nema17", "boltSpacingMm") / 2;

  assert.equal(bolts.length, 4);
  for (const bolt of bolts) {
    assert.equal(Math.abs(bolt.x), half);
    assert.equal(Math.abs(bolt.z), half);
    assert.equal(bolt.radius * 2, clearanceHoleDiameterMm("M3", "normal"));
  }
  assert.notEqual(half, 18, "the defect being fixed");
});

test("the motor face mount's pilot bore admits the boss it locates on", () => {
  const body = createBodyFromTemplate("motor_face_mount");
  const pilot = body.sketch.cutProfiles.find((profile) => profile.id === "pilot_bore");
  const boss = componentDimensionMm("nema17", "pilotDiameterMm");

  assert.ok(pilot.radius * 2 > boss, `a ${pilot.radius * 2} mm bore over a ${boss} mm boss`);
  assert.equal(pilot.radius, locatingBoreMm("nema17", "pilotDiameterMm").diameterMm / 2);
  // Still not a fastener, so still no `hole` - which is what keeps cycle 06's edge
  // distance rule from reporting a screw that is not there.
  assert.equal(Object.hasOwn(pilot, "hole"), false);
});

test("the bearing block plate's bore accepts a 608, which is what the defect was", () => {
  const body = createBodyFromTemplate("bearing_block_plate");
  const bore = body.sketch.cutProfiles.find((profile) => profile.id === "bearing_bore");
  const race = componentDimensionMm("bearing608", "outerDiameterMm");

  assert.equal(race, 22, "the premise: a 608's outer diameter is 22 mm");
  assert.ok(bore.radius * 2 > race, `a ${bore.radius * 2} mm bore must exceed a ${race} mm race`);
  assert.notEqual(bore.radius, 11, "the shipped zero-clearance bore");
});

test("axle_shaft is unchanged, which is what makes it the control", () => {
  // It has no holes, so the retrofit had nothing to do to it. Pinned exactly rather
  // than loosely: if this body ever changes, the retrofit reached further than it meant
  // to and the diff needs reading.
  const body = createBodyFromTemplate("axle_shaft");
  assert.deepEqual(body.sketch, {
    outerProfile: { id: "outer", type: "circle", x: 0, z: 0, radius: 4 },
    cutProfiles: []
  });
  assert.equal(body.extrudeDepthMm, 60);
});

test("the retrofit never grew a hole it was not told to", () => {
  // The size rule, stated as a property. Outside the five identified
  // radius-for-diameter defects and the two component-driven bores, no hole came out
  // larger than it went in: a larger hole spends edge distance and wall thickness the
  // template was drawn with, and the retrofit's licence was to correct numbers rather
  // than to redraw parts.
  const shippedRadii = {
    l_bracket: { leg_hole: 3, upright_hole: 3 },
    triangular_gusset_plate: { base_hole_a: 2.8, base_hole_b: 2.8, upright_hole: 2.8 },
    servo_mount_plate: { servo_hole_1: 2.3, servo_hole_2: 2.3, servo_hole_3: 2.3, servo_hole_4: 2.3 },
    servo_horn_disk: { radial_hole_1: 1.8, radial_hole_2: 1.8, radial_hole_3: 1.8, radial_hole_4: 1.8 },
    bearing_block_plate: { mount_hole_1: 2.8, mount_hole_2: 2.8, mount_hole_3: 2.8, mount_hole_4: 2.8 },
    wheel_hub_flange: { bolt_hole_1: 2.5, bolt_hole_4: 2.5 },
    linear_rail_carriage: { rail_hole_1: 2.6, rail_hole_4: 2.6 },
    electronics_tray: { corner_hole_1: 3, corner_hole_3: 3 },
    gripper_finger: { mount_hole_a: 3 },
    end_effector_palm: { wrist_hole_a: 3, tool_hole_a: 2.8 },
    drive_chassis_side_plate: { motor_hole_a: 2.8, motor_hole_b: 2.8 },
    quad_motor_arm_plate: { motor_hole_1: 2.2, motor_hole_3: 2.2 }
  };

  for (const [templateId, radii] of Object.entries(shippedRadii)) {
    const body = createBodyFromTemplate(templateId);
    for (const [profileId, shipped] of Object.entries(radii)) {
      const profile = body.sketch.cutProfiles.find((cut) => cut.id === profileId);
      assert.ok(profile, `${templateId}/${profileId}`);
      assert.ok(
        profile.radius <= shipped,
        `${templateId}/${profileId} grew from ${shipped} to ${profile.radius}`
      );
    }
  }

  // And `servo_horn_disk`'s radial holes did not move at all, because M3 at loose fit
  // is 3.6 mm exactly. The exact-match branch of the size rule, pinned.
  const horn = createBodyFromTemplate("servo_horn_disk");
  const radial = horn.sketch.cutProfiles.find((profile) => profile.id === "radial_hole_1");
  assert.equal(radial.radius, 1.8);
  assert.equal(radial.radius * 2, clearanceHoleDiameterMm("M3", "loose"));
});

/* ------------------------------------------- the re-baselined DFM assertion */

test("the retrofitted templates report no manufacturability finding at the default process", () => {
  // Cycle 06 pinned six templates as finding-free and said plainly that this was a
  // baseline rather than a result, because the templates carried no `hole` and so no
  // fastener rule could see them. They can now, and the honest re-baseline is all
  // twenty rather than six.
  //
  // Getting here cost two templates a change of geometry rather than a change of
  // assertion: `triangular_gusset_plate`'s upright hole measured 4.69 mm from the
  // hypotenuse against an M5 minimum of 7.5, and `quad_motor_arm_plate`'s outer motor
  // holes measured 3.94 mm from the arm tip against an M3 minimum of 4.5. Both were
  // legal as plain circles and are screws tearing out of an edge as fasteners, so both
  // moved inboard. That is the plan's rule followed: a corrected template that trips a
  // rule is a finding about the template.
  for (const template of PART_TEMPLATES) {
    const findings = validateManufacturability(createBodyFromTemplate(template.id));
    assert.deepEqual(
      findings.map((finding) => finding.code),
      [],
      `${template.id}: ${findings.map((finding) => finding.message).join(" | ")}`
    );
  }
});
