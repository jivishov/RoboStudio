import * as THREE from "three";
import { jointAnchors } from "../assemblySpec.js";

const deg = (value) => (value * Math.PI) / 180;

const wristRollAxis = new THREE.Vector3()
  .fromArray(jointAnchors.gripper_mount)
  .sub(new THREE.Vector3().fromArray(jointAnchors.wrist))
  .normalize()
  .toArray();

const ARM_CHAIN = [
  "lower_arm",
  "upper_arm",
  "wrist_yoke",
  "gripper_base",
  "gear_left",
  "gear_right",
  "gripper_finger_left",
  "gripper_finger_right",
  "grip_link_left_lower",
  "grip_link_left_upper",
  "grip_link_right_lower",
  "grip_link_right_upper",
  "inferred_shoulder_axle",
  "inferred_elbow_axle",
  "inferred_wrist_axle",
  "inferred_gripper_mount_axle",
  "inferred_left_gear_axle",
  "inferred_right_gear_axle"
];

const UPPER_CHAIN = ARM_CHAIN.filter(
  (id) => !["lower_arm", "inferred_shoulder_axle"].includes(id)
);

const WRIST_CHAIN = [
  "wrist_yoke",
  "gripper_base",
  "gear_left",
  "gear_right",
  "gripper_finger_left",
  "gripper_finger_right",
  "grip_link_left_lower",
  "grip_link_left_upper",
  "grip_link_right_lower",
  "grip_link_right_upper",
  "inferred_wrist_axle",
  "inferred_gripper_mount_axle",
  "inferred_left_gear_axle",
  "inferred_right_gear_axle"
];

const GRIPPER_CHAIN = [
  "gripper_base",
  "gear_left",
  "gear_right",
  "gripper_finger_left",
  "gripper_finger_right",
  "grip_link_left_lower",
  "grip_link_left_upper",
  "grip_link_right_lower",
  "grip_link_right_upper",
  "inferred_gripper_mount_axle",
  "inferred_left_gear_axle",
  "inferred_right_gear_axle"
];

const WRIST_ROLL_CHAIN = [
  "wrist_yoke",
  "inferred_wrist_axle",
  ...GRIPPER_CHAIN
];

const PREFERRED_JOINT_BY_PART_ID = {
  wrist_yoke: "wrist_roll",
  inferred_wrist_axle: "wrist_roll",
  gripper_base: "wrist_roll",
  inferred_gripper_mount_axle: "wrist_roll"
};

export const JOINT_DEFINITIONS = [
  {
    id: "turntable",
    label: "Turntable",
    pivot: jointAnchors.turntable,
    axis: [0, 1, 0],
    minDeg: -180,
    maxDeg: 180,
    defaultDeg: 0,
    parentIds: [],
    affectedPartIds: ["waist", ...ARM_CHAIN]
  },
  {
    id: "shoulder",
    label: "Shoulder",
    pivot: jointAnchors.shoulder,
    axis: [0, 0, 1],
    minDeg: -80,
    maxDeg: 80,
    defaultDeg: 0,
    parentIds: ["turntable"],
    affectedPartIds: ARM_CHAIN
  },
  {
    id: "elbow",
    label: "Elbow",
    pivot: jointAnchors.elbow,
    axis: [0, 0, 1],
    minDeg: -120,
    maxDeg: 120,
    defaultDeg: 0,
    parentIds: ["turntable", "shoulder"],
    affectedPartIds: UPPER_CHAIN
  },
  {
    id: "wrist",
    label: "Wrist pitch",
    pivot: jointAnchors.wrist,
    axis: [0, 0, 1],
    minDeg: -120,
    maxDeg: 120,
    defaultDeg: 0,
    parentIds: ["turntable", "shoulder", "elbow"],
    affectedPartIds: WRIST_CHAIN
  },
  {
    id: "wrist_roll",
    label: "Wrist roll",
    pivot: jointAnchors.gripper_mount,
    axis: wristRollAxis,
    minDeg: -180,
    maxDeg: 180,
    defaultDeg: 0,
    parentIds: ["turntable", "shoulder", "elbow", "wrist"],
    affectedPartIds: WRIST_ROLL_CHAIN
  },
  {
    id: "gripper_mount",
    label: "Gripper mount",
    pivot: jointAnchors.gripper_mount,
    axis: [0, 0, 1],
    minDeg: -90,
    maxDeg: 90,
    defaultDeg: 0,
    parentIds: ["turntable", "shoulder", "elbow", "wrist", "wrist_roll"],
    affectedPartIds: GRIPPER_CHAIN
  },
  {
    id: "left_gear",
    label: "Left gear",
    pivot: jointAnchors.left_gear,
    axis: [0, 0, 1],
    minDeg: -90,
    maxDeg: 90,
    defaultDeg: 0,
    parentIds: ["turntable", "shoulder", "elbow", "wrist", "wrist_roll", "gripper_mount"],
    affectedPartIds: [
      "gear_left",
      "gripper_finger_left",
      "grip_link_left_lower",
      "grip_link_left_upper",
      "inferred_left_gear_axle"
    ]
  },
  {
    id: "right_gear",
    label: "Right gear",
    pivot: jointAnchors.right_gear,
    axis: [0, 0, 1],
    minDeg: -90,
    maxDeg: 90,
    defaultDeg: 0,
    parentIds: ["turntable", "shoulder", "elbow", "wrist", "wrist_roll", "gripper_mount"],
    affectedPartIds: [
      "gear_right",
      "gripper_finger_right",
      "grip_link_right_lower",
      "grip_link_right_upper",
      "inferred_right_gear_axle"
    ]
  }
];

export const JOINTS_BY_ID = new Map(JOINT_DEFINITIONS.map((joint) => [joint.id, joint]));

export function getMostSpecificJointIdForPart(partId) {
  if (!partId) return null;
  if (PREFERRED_JOINT_BY_PART_ID[partId]) {
    return PREFERRED_JOINT_BY_PART_ID[partId];
  }

  for (let index = JOINT_DEFINITIONS.length - 1; index >= 0; index -= 1) {
    const joint = JOINT_DEFINITIONS[index];
    if (joint.affectedPartIds.includes(partId)) {
      return joint.id;
    }
  }

  return null;
}

export function clampJointAngle(jointId, angleDeg) {
  const joint = JOINTS_BY_ID.get(jointId);
  if (!joint) return 0;
  const value = Number.isFinite(angleDeg) ? angleDeg : joint.defaultDeg;
  return Math.min(joint.maxDeg, Math.max(joint.minDeg, value));
}

function createJointDelta(joint, angleDeg) {
  const pivot = new THREE.Vector3().fromArray(joint.pivot);
  const axis = new THREE.Vector3().fromArray(joint.axis).normalize();
  const rotation = new THREE.Matrix4().makeRotationAxis(axis, deg(angleDeg));
  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

export function getJointAngle(pose, jointId) {
  const joint = JOINTS_BY_ID.get(jointId);
  return clampJointAngle(jointId, pose?.joints?.[jointId]?.angleDeg ?? joint?.defaultDeg ?? 0);
}

export function getJointDeltaMatrix(pose, jointId) {
  const joint = JOINTS_BY_ID.get(jointId);
  if (!joint) return new THREE.Matrix4();
  return createJointDelta(joint, getJointAngle(pose, jointId));
}

export function getPartJointMatrix(partId, pose) {
  const matrix = new THREE.Matrix4();
  for (const joint of JOINT_DEFINITIONS) {
    if (joint.affectedPartIds.includes(partId)) {
      matrix.multiply(getJointDeltaMatrix(pose, joint.id));
    }
  }
  return matrix;
}

export function getJointAncestorMatrix(jointId, pose) {
  const joint = JOINTS_BY_ID.get(jointId);
  const matrix = new THREE.Matrix4();
  if (!joint) return matrix;

  for (const parentId of joint.parentIds) {
    matrix.multiply(getJointDeltaMatrix(pose, parentId));
  }

  return matrix;
}

export function getJointWorldPivot(jointId, pose) {
  const joint = JOINTS_BY_ID.get(jointId);
  if (!joint) return new THREE.Vector3();

  return new THREE.Vector3().fromArray(joint.pivot).applyMatrix4(getJointAncestorMatrix(jointId, pose));
}

export function getJointWorldAxis(jointId, pose) {
  const joint = JOINTS_BY_ID.get(jointId);
  if (!joint) return new THREE.Vector3(0, 1, 0);

  const axis = new THREE.Vector3().fromArray(joint.axis).normalize();
  const normalMatrix = new THREE.Matrix3().setFromMatrix4(getJointAncestorMatrix(jointId, pose));
  return axis.applyMatrix3(normalMatrix).normalize();
}
