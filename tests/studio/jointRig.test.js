import assert from "node:assert/strict";
import test from "node:test";

import { jointAnchors } from "../../src/assemblySpec.js";
import { JOINTS_BY_ID, getMostSpecificJointIdForPart } from "../../src/studio/jointRig.js";

function normalizedDelta(from, to) {
  const delta = to.map((value, index) => value - from[index]);
  const length = Math.hypot(...delta);
  return delta.map((value) => value / length);
}

function assertVectorClose(actual, expected, epsilon = 1e-10) {
  assert.equal(actual.length, expected.length);
  for (const [index, value] of actual.entries()) {
    assert.ok(Math.abs(value - expected[index]) <= epsilon, `${value} ~= ${expected[index]}`);
  }
}

test("maps rig parts to the most specific hinge joint", () => {
  assert.equal(getMostSpecificJointIdForPart("waist"), "turntable");
  assert.equal(getMostSpecificJointIdForPart("lower_arm"), "shoulder");
  assert.equal(getMostSpecificJointIdForPart("inferred_shoulder_axle"), "shoulder");
  assert.equal(getMostSpecificJointIdForPart("upper_arm"), "elbow");
  assert.equal(getMostSpecificJointIdForPart("inferred_elbow_axle"), "elbow");
  assert.equal(getMostSpecificJointIdForPart("wrist_yoke"), "wrist_roll");
  assert.equal(getMostSpecificJointIdForPart("inferred_wrist_axle"), "wrist_roll");
  assert.equal(getMostSpecificJointIdForPart("gripper_base"), "wrist_roll");
  assert.equal(getMostSpecificJointIdForPart("inferred_gripper_mount_axle"), "wrist_roll");
  assert.equal(getMostSpecificJointIdForPart("gear_left"), "left_gear");
  assert.equal(getMostSpecificJointIdForPart("grip_link_left_lower"), "left_gear");
  assert.equal(getMostSpecificJointIdForPart("gear_right"), "right_gear");
  assert.equal(getMostSpecificJointIdForPart("grip_link_right_upper"), "right_gear");
  assert.equal(getMostSpecificJointIdForPart("base"), null);
  assert.equal(getMostSpecificJointIdForPart("imported_part"), null);
});

test("defines wrist roll around the wrist-to-gripper centerline", () => {
  const wristRoll = JOINTS_BY_ID.get("wrist_roll");
  assert.ok(wristRoll);
  assert.equal(wristRoll.label, "Wrist roll");
  assert.deepEqual(wristRoll.pivot, jointAnchors.gripper_mount);
  assertVectorClose(wristRoll.axis, normalizedDelta(jointAnchors.wrist, jointAnchors.gripper_mount));
  assert.notDeepEqual(wristRoll.axis, [0, 0, 1]);
  assert.ok(wristRoll.affectedPartIds.includes("wrist_yoke"));
  assert.ok(wristRoll.affectedPartIds.includes("inferred_wrist_axle"));
  assert.ok(wristRoll.affectedPartIds.includes("gripper_base"));
});
