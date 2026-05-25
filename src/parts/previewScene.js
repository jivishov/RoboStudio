import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createGeneratedBodyMetadata } from "./contracts.js";

function createGeometry(result) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(result.vertices, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function applyBodyTransform(mesh, body) {
  mesh.position.fromArray(body.transform.position);
  mesh.quaternion.fromArray(body.transform.quaternion);
  mesh.scale.fromArray(body.transform.scale);
  mesh.updateMatrixWorld(true);
}

function fitCameraToObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxSize) || maxSize <= 0) {
    camera.position.set(100, 85, 130);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }

  const distance = maxSize / (2 * Math.tan((Math.PI * camera.fov) / 360));
  camera.position.set(center.x + distance * 0.6, center.y + distance * 0.42, center.z + distance * 0.9);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = distance * 8;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

export function createPartPreviewScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f8fafc");

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 5000);
  camera.position.set(100, 85, 130);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = "model-preview__canvas";
  renderer.domElement.style.touchAction = "none";
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 24;
  controls.maxDistance = 900;

  scene.add(new THREE.HemisphereLight("#ffffff", "#cbd5e1", 2));
  const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
  keyLight.position.set(160, 260, 210);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight("#dbeafe", 0.9);
  fillLight.position.set(-190, 120, -140);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(220, 22, "#9aa5b1", "#d4dbe5");
  grid.material.opacity = 0.42;
  grid.material.transparent = true;
  scene.add(grid);

  const group = new THREE.Group();
  group.name = "part_studio_generated_parts";
  scene.add(group);

  const selection = new THREE.BoxHelper(new THREE.Object3D(), "#f59e0b");
  selection.visible = false;
  scene.add(selection);

  const meshesById = new Map();
  let selectedBodyId = null;

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function updateSelection() {
    const selected = meshesById.get(selectedBodyId);
    selection.visible = Boolean(selected);
    if (selected) selection.setFromObject(selected);
  }

  function clearMeshes() {
    for (const mesh of meshesById.values()) {
      group.remove(mesh);
      disposeObject(mesh);
    }
    meshesById.clear();
  }

  function updateBodies(bodies, compileResults, nextSelectedBodyId, options = {}) {
    clearMeshes();
    selectedBodyId = nextSelectedBodyId ?? selectedBodyId;

    for (const body of bodies) {
      const result = compileResults.get(body.id);
      if (!result) continue;

      const mesh = new THREE.Mesh(
        createGeometry(result),
        new THREE.MeshStandardMaterial({
          color: body.color,
          roughness: 0.62,
          metalness: 0.04,
          side: THREE.DoubleSide
        })
      );
      mesh.name = body.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = createGeneratedBodyMetadata(body);
      applyBodyTransform(mesh, body);
      meshesById.set(body.id, mesh);
      group.add(mesh);
    }

    updateSelection();
    if (options.fitCamera !== false) fitCameraToObject(camera, controls, group);
  }

  function setSelectedBodyId(bodyId) {
    selectedBodyId = bodyId;
    updateSelection();
  }

  function render() {
    controls.update();
    if (selection.visible) updateSelection();
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(render);

  function getMatrixWorldById() {
    group.updateMatrixWorld(true);
    return new Map([...meshesById].map(([id, mesh]) => [id, mesh.matrixWorld.toArray()]));
  }

  function getVisibleBodyIds() {
    return [...meshesById.values()].filter((mesh) => mesh.visible).map((mesh) => mesh.userData.id);
  }

  async function exportVisibleGlb() {
    const exportGroup = new THREE.Group();
    exportGroup.name = "part_studio_generated_parts";

    for (const mesh of meshesById.values()) {
      if (!mesh.visible) continue;
      const clone = mesh.clone();
      clone.geometry = mesh.geometry.clone();
      clone.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone();
      exportGroup.add(clone);
    }

    if (!exportGroup.children.length) {
      throw new Error("No generated bodies are ready for handoff.");
    }

    return new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      exporter.parse(
        exportGroup,
        (result) => {
          disposeObject(exportGroup);
          resolve(result);
        },
        (error) => {
          disposeObject(exportGroup);
          reject(error);
        },
        { binary: true, onlyVisible: true }
      );
    });
  }

  return {
    updateBodies,
    setSelectedBodyId,
    getMatrixWorldById,
    getVisibleBodyIds,
    exportVisibleGlb
  };
}
