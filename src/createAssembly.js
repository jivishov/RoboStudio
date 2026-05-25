import * as THREE from "three";
import {
  SOURCE_STL_COUNT,
  inferredJointConnectors,
  inferredSupports,
  stlInstances
} from "./assemblySpec.js";

export function createMaterial(color, inferred = false) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: inferred ? 0.72 : 0.5,
    metalness: inferred ? 0.02 : 0.08,
    side: THREE.DoubleSide
  });
}

function normalizeStlGeometry(sourceGeometry) {
  const geometry = sourceGeometry.clone();
  geometry.computeBoundingBox();

  const center = new THREE.Vector3();
  geometry.boundingBox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  return { center, geometry };
}

function applyTransform(object, spec, bboxCenter = null) {
  object.rotation.fromArray(spec.rotation ?? [0, 0, 0]);
  object.scale.fromArray(spec.scale ?? [1, 1, 1]);

  if (spec.anchorOriginal && spec.targetWorld && bboxCenter) {
    const scale = new THREE.Vector3().fromArray(spec.scale ?? [1, 1, 1]);
    const anchor = new THREE.Vector3()
      .fromArray(spec.anchorOriginal)
      .sub(bboxCenter)
      .multiply(scale)
      .applyEuler(object.rotation);
    object.position.fromArray(spec.targetWorld).sub(anchor);
  } else {
    object.position.fromArray(spec.position);
  }

  object.updateMatrixWorld(true);
}

function createPrimitiveGeometry(spec) {
  if (spec.type === "cylinder") {
    return new THREE.CylinderGeometry(spec.radius, spec.radius, spec.length, 36, 1);
  }

  return new THREE.BoxGeometry(...spec.size);
}

export async function createRoboticArmAssembly(loadStlGeometry) {
  if (typeof loadStlGeometry !== "function") {
    throw new TypeError("createRoboticArmAssembly requires a loadStlGeometry function.");
  }

  const group = new THREE.Group();
  group.name = "robotic_arm_static_assembly";
  group.userData = {
    sourceStlCount: SOURCE_STL_COUNT,
    generatedFrom: "STL_files",
    assemblyType: "static"
  };

  const sourceGeometryCache = new Map();
  const manifest = [];

  for (const spec of stlInstances) {
    if (!sourceGeometryCache.has(spec.file)) {
      sourceGeometryCache.set(spec.file, await loadStlGeometry(spec.file));
    }

    const { center, geometry } = normalizeStlGeometry(sourceGeometryCache.get(spec.file));
    const mesh = new THREE.Mesh(geometry, createMaterial(spec.color, spec.inferred));
    mesh.name = spec.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      id: spec.id,
      label: spec.label,
      file: spec.file,
      type: spec.inferred ? "inferred" : "source",
      inferredReason: spec.inferredReason ?? null,
      jointNotes: spec.jointNotes ?? null
    };
    applyTransform(mesh, spec, center);
    group.add(mesh);
    manifest.push(mesh.userData);
  }

  for (const spec of [...inferredSupports, ...inferredJointConnectors]) {
    const geometry = createPrimitiveGeometry(spec);
    const mesh = new THREE.Mesh(geometry, createMaterial(spec.color, true));
    mesh.name = spec.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      id: spec.id,
      label: spec.label,
      file: null,
      type: "inferred",
      inferredReason:
        spec.reason ?? "Approximated support foot because Pata de Soporte.STL is absent locally."
    };
    applyTransform(mesh, spec);
    group.add(mesh);
    manifest.push(mesh.userData);
  }

  group.userData.manifest = manifest;
  return group;
}

export function collectAssemblyParts(group) {
  const parts = [];
  group.traverse((object) => {
    if (object.isMesh && object.userData?.id) {
      parts.push(object);
    }
  });
  return parts;
}
