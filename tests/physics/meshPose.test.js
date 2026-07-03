import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { computeForwardKinematics } from "../../src/physics/kinematics.js";
import {
  applyLinkWorldTransforms,
  createMeshPoseBindings,
  snapshotsToLinkMatrices
} from "../../src/physics/meshPose.js";
import { collectAssemblyPartMeshes, collectAssemblyPartRecords } from "../../src/physics/model.js";

function closeTo(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);
}

function positionOf(object, root) {
  root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
}

function simpleAssembly() {
  const root = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(10, 0, 0);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
  mesh.name = "Upper Link";
  mesh.userData.id = "upper";
  mesh.position.set(140, 0, 0);
  parent.add(mesh);
  root.add(parent);
  root.updateMatrixWorld(true);
  return { root, parent, mesh };
}

function twoLinkDesign(angleDeg = 0) {
  return {
    links: [
      { id: "base", partIds: [] },
      { id: "upper", partIds: ["upper"] }
    ],
    joints: [
      {
        id: "shoulder",
        type: "revolute",
        parentLinkId: "base",
        childLinkId: "upper",
        origin: [100, 0, 0],
        axis: [0, 0, 1],
        min: -180,
        max: 180
      }
    ],
    pose: { jointAngles: { shoulder: angleDeg } }
  };
}

test("mesh posing preserves rest world matrices at zero pose", () => {
  const { root, mesh } = simpleAssembly();
  const bindings = createMeshPoseBindings(root, [{ id: "upper", label: "Upper" }]);
  const rest = positionOf(mesh, root);
  const design = twoLinkDesign(0);

  applyLinkWorldTransforms(bindings, design, computeForwardKinematics(design));
  const posed = positionOf(mesh, root);

  closeTo(posed.x, rest.x);
  closeTo(posed.y, rest.y);
  closeTo(posed.z, rest.z);
});

test("mesh posing rotates around the zero-pose link frame without double translation", () => {
  const { root, mesh } = simpleAssembly();
  const bindings = createMeshPoseBindings(root, [{ id: "upper", label: "Upper" }]);
  const design = twoLinkDesign(90);

  applyLinkWorldTransforms(bindings, design, computeForwardKinematics(design));
  const posed = positionOf(mesh, root);

  closeTo(posed.x, 100);
  closeTo(posed.y, 50);
  closeTo(posed.z, 0);
});

test("simulation snapshot matrices use the same zero-pose inverse as FK posing", () => {
  const { root, mesh } = simpleAssembly();
  const bindings = createMeshPoseBindings(root, [{ id: "upper", label: "Upper" }]);
  const design = twoLinkDesign(0);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const matrices = snapshotsToLinkMatrices([
    { linkId: "base", position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    { linkId: "upper", position: [100, 0, 0], quaternion: quaternion.toArray() }
  ]);

  applyLinkWorldTransforms(bindings, design, matrices);
  const posed = positionOf(mesh, root);

  closeTo(posed.x, 100);
  closeTo(posed.y, 50);
  closeTo(posed.z, 0);
});

test("missing pose matrices leave linked meshes at their rest transform", () => {
  const { root, mesh } = simpleAssembly();
  const bindings = createMeshPoseBindings(root, [{ id: "upper", label: "Upper" }]);
  const rest = positionOf(mesh, root);

  applyLinkWorldTransforms(bindings, twoLinkDesign(0), new Map([["base", new THREE.Matrix4()]]));
  const posed = positionOf(mesh, root);

  closeTo(posed.x, rest.x);
  closeTo(posed.y, rest.y);
  closeTo(posed.z, rest.z);
});

test("unassigned meshes restore their captured local rest transform", () => {
  const { root, mesh } = simpleAssembly();
  const bindings = createMeshPoseBindings(root, [{ id: "upper", label: "Upper" }]);
  const restLocal = mesh.matrix.clone();
  const posedDesign = twoLinkDesign(90);
  applyLinkWorldTransforms(bindings, posedDesign, computeForwardKinematics(posedDesign));

  applyLinkWorldTransforms(bindings, { links: [{ id: "base", partIds: [] }], joints: [], pose: { jointAngles: {} } }, new Map([["base", new THREE.Matrix4()]]));

  for (let index = 0; index < restLocal.elements.length; index += 1) {
    closeTo(mesh.matrix.elements[index], restLocal.elements[index]);
  }
});

test("part record and mesh traversal produce the same generated IDs for duplicate mesh names", () => {
  const root = new THREE.Group();
  const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  first.name = "duplicate";
  second.name = "duplicate";
  root.add(first, second);

  const recordIds = collectAssemblyPartRecords(root).map((record) => record.id);
  const meshIds = [...collectAssemblyPartMeshes(root).keys()];

  assert.deepEqual(meshIds, recordIds);
});
