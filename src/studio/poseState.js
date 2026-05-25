import * as THREE from "three";
import { JOINT_DEFINITIONS, clampJointAngle, getPartJointMatrix } from "./jointRig.js";

export const POSE_VERSION = 1;

const IDENTITY_OFFSET = Object.freeze({
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1]
});

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function round(value, digits = 6) {
  return Number(finiteNumber(value).toFixed(digits));
}

function normalizeVector(values, length, fallback) {
  if (!Array.isArray(values) || values.length !== length) {
    return [...fallback];
  }

  return values.map((value, index) => finiteNumber(Number(value), fallback[index]));
}

export function cloneTransform(transform = IDENTITY_OFFSET) {
  return {
    position: normalizeVector(transform.position, 3, IDENTITY_OFFSET.position),
    quaternion: normalizeVector(transform.quaternion, 4, IDENTITY_OFFSET.quaternion),
    scale: normalizeVector(transform.scale, 3, IDENTITY_OFFSET.scale)
  };
}

export function transformToMatrix(transform = IDENTITY_OFFSET) {
  const safe = cloneTransform(transform);
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(safe.position),
    new THREE.Quaternion().fromArray(safe.quaternion).normalize(),
    new THREE.Vector3().fromArray(safe.scale)
  );
}

export function matrixToTransform(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  return {
    position: position.toArray().map((value) => round(value, 5)),
    quaternion: quaternion.toArray().map((value) => round(value, 8)),
    scale: scale.toArray().map((value) => round(value, 5))
  };
}

export function captureRestState(parts) {
  const restMatrices = new Map();

  for (const part of parts) {
    part.updateMatrixWorld(true);
    restMatrices.set(part.userData.id, part.matrixWorld.clone());
  }

  return { restMatrices };
}

export function createDefaultPose(parts = []) {
  const joints = {};
  const visibility = {};

  for (const joint of JOINT_DEFINITIONS) {
    joints[joint.id] = { angleDeg: joint.defaultDeg };
  }

  for (const part of parts) {
    visibility[part.userData.id] = part.visible;
  }

  return {
    version: POSE_VERSION,
    units: "mm",
    joints,
    partOffsets: {},
    visibility
  };
}

export function normalizePose(input, parts = []) {
  if (!input || typeof input !== "object") {
    return createDefaultPose(parts);
  }

  if (input.version !== POSE_VERSION) {
    throw new Error(`Unsupported pose version: ${input.version ?? "missing"}`);
  }

  const pose = createDefaultPose(parts);

  for (const joint of JOINT_DEFINITIONS) {
    pose.joints[joint.id] = {
      angleDeg: clampJointAngle(joint.id, Number(input.joints?.[joint.id]?.angleDeg))
    };
  }

  if (input.partOffsets && typeof input.partOffsets === "object") {
    const knownPartIds = new Set(parts.map((part) => part.userData.id));
    for (const [partId, transform] of Object.entries(input.partOffsets)) {
      if (knownPartIds.size === 0 || knownPartIds.has(partId)) {
        pose.partOffsets[partId] = cloneTransform(transform);
      }
    }
  }

  if (input.visibility && typeof input.visibility === "object") {
    for (const part of parts) {
      const visible = input.visibility[part.userData.id];
      if (typeof visible === "boolean") {
        pose.visibility[part.userData.id] = visible;
      }
    }
  }

  return pose;
}

export function getPartOffsetTransform(pose, partId) {
  return cloneTransform(pose.partOffsets?.[partId] ?? IDENTITY_OFFSET);
}

export function setPartOffsetTransform(pose, partId, transform) {
  const normalized = cloneTransform(transform);
  pose.partOffsets[partId] = normalized;
  return normalized;
}

export function resetPartOffset(pose, partId) {
  delete pose.partOffsets[partId];
}

function setWorldMatrix(object, worldMatrix) {
  const parentInverse = new THREE.Matrix4();
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    parentInverse.copy(object.parent.matrixWorld).invert();
  }

  const localMatrix = parentInverse.multiply(worldMatrix);
  localMatrix.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld(true);
}

export function applyPoseToAssembly(parts, restState, pose) {
  for (const part of parts) {
    const partId = part.userData.id;
    const restMatrix = restState.restMatrices.get(partId);
    if (!restMatrix) continue;

    const finalMatrix = new THREE.Matrix4()
      .copy(getPartJointMatrix(partId, pose))
      .multiply(restMatrix)
      .multiply(transformToMatrix(pose.partOffsets?.[partId]));

    setWorldMatrix(part, finalMatrix);
    part.visible = pose.visibility?.[partId] ?? true;
  }
}

export function capturePartOffsetFromWorld(partId, worldMatrix, restState, pose) {
  const restMatrix = restState.restMatrices.get(partId);
  if (!restMatrix) return IDENTITY_OFFSET;

  const offsetMatrix = new THREE.Matrix4()
    .copy(restMatrix)
    .invert()
    .multiply(new THREE.Matrix4().copy(getPartJointMatrix(partId, pose)).invert())
    .multiply(worldMatrix);

  return setPartOffsetTransform(pose, partId, matrixToTransform(offsetMatrix));
}

export function serializePose(pose) {
  return JSON.stringify(
    {
      version: POSE_VERSION,
      units: "mm",
      joints: pose.joints,
      partOffsets: pose.partOffsets,
      visibility: pose.visibility
    },
    null,
    2
  );
}
