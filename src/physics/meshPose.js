import * as THREE from "three";
import { computeForwardKinematics } from "./kinematics.js";
import { collectAssemblyPartMeshes } from "./model.js";

const IDENTITY = new THREE.Matrix4();

function zeroPose(design) {
  return {
    jointAngles: Object.fromEntries((design?.joints ?? []).map((joint) => [joint.id, 0]))
  };
}

function partLinkMap(design) {
  const map = new Map();
  for (const link of design?.links ?? []) {
    for (const partId of link.partIds ?? []) {
      if (!map.has(partId)) map.set(partId, link);
    }
  }
  return map;
}

function markMatrixDirty(object) {
  object.matrixWorldNeedsUpdate = true;
  let parent = object.parent;
  while (parent) {
    parent.matrixWorldNeedsUpdate = true;
    parent = parent.parent;
  }
}

export function createMeshPoseBindings(assemblyRoot, snapshotParts = []) {
  const meshes = collectAssemblyPartMeshes(assemblyRoot, snapshotParts);
  const bindings = new Map();
  assemblyRoot?.updateMatrixWorld(true);

  for (const [partId, object] of meshes.entries()) {
    object.updateMatrixWorld(true);
    const parentWorldInverse = object.parent
      ? object.parent.matrixWorld.clone().invert()
      : new THREE.Matrix4();
    bindings.set(partId, {
      object,
      parentWorldInverse,
      restWorldMatrix: object.matrixWorld.clone(),
      restLocalMatrix: object.matrix.clone()
    });
  }

  return bindings;
}

export function linkZeroPoseMatrices(design) {
  return computeForwardKinematics(design, zeroPose(design));
}

export function snapshotsToLinkMatrices(snapshots = []) {
  const matrices = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot?.linkId) continue;
    const position = new THREE.Vector3().fromArray(snapshot.position ?? [0, 0, 0]);
    const quaternion = new THREE.Quaternion().fromArray(snapshot.quaternion ?? [0, 0, 0, 1]);
    matrices.set(snapshot.linkId, new THREE.Matrix4().compose(position, quaternion.normalize(), new THREE.Vector3(1, 1, 1)));
  }
  return matrices;
}

export function linkPoseDelta(linkId, linkMatrices, zeroMatrices = new Map()) {
  const zero = zeroMatrices.get(linkId) ?? IDENTITY;
  const posed = linkMatrices?.get(linkId) ?? zero;
  return posed.clone().multiply(zero.clone().invert());
}

export function applyLinkWorldTransforms(bindings, design, linkMatrices) {
  if (!bindings?.size || !design) return;
  const linksByPart = partLinkMap(design);
  const zeroMatrices = linkZeroPoseMatrices(design);

  for (const [partId, binding] of bindings.entries()) {
    const link = linksByPart.get(partId);
    const object = binding.object;
    object.matrixAutoUpdate = false;

    if (!link) {
      object.matrix.copy(binding.restLocalMatrix);
      markMatrixDirty(object);
      continue;
    }

    const delta = linkPoseDelta(link.id, linkMatrices, zeroMatrices);
    const worldMatrix = delta.multiply(binding.restWorldMatrix);
    const localMatrix = binding.parentWorldInverse.clone().multiply(worldMatrix);
    object.matrix.copy(localMatrix);
    markMatrixDirty(object);
  }
}
