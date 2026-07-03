import * as THREE from "three";
import { proxyWorldMatrix } from "./collision.js";
import { getJointWorldFrame, transformPoint } from "./kinematics.js";

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}

export class WorkbenchOverlays {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "robot_design_overlays";
    this.scene.add(this.group);
    this.target = new THREE.Mesh(
      new THREE.SphereGeometry(6, 24, 16),
      new THREE.MeshStandardMaterial({ color: "#f59e0b", emissive: "#8a4a00", emissiveIntensity: 0.18 })
    );
    this.target.name = "ik_target";
    this.scene.add(this.target);
  }

  setTarget(position) {
    this.target.position.fromArray(position ?? [0, 0, 0]);
    this.target.visible = Array.isArray(position);
  }

  update(design, transforms, options = {}) {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }

    if (options.showProxies !== false) this.addCollisionProxies(design, transforms, options.collisions ?? []);
    if (options.showCom !== false) this.addComMarkers(design, transforms);
    if (options.showJoints !== false) this.addJointAxes(design, transforms);
  }

  addCollisionProxies(design, transforms, collisions = []) {
    const conflictKeys = new Set(
      collisions.flatMap((collision) => [
        `${collision.linkA}:${collision.proxyA}`,
        `${collision.linkB}:${collision.proxyB}`
      ])
    );
    const material = new THREE.MeshBasicMaterial({
      color: "#1268e8",
      transparent: true,
      opacity: 0.12,
      depthWrite: false
    });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: "#1268e8", transparent: true, opacity: 0.75 });
    const conflictMaterial = new THREE.MeshBasicMaterial({
      color: "#c2413f",
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    });
    const conflictEdgeMaterial = new THREE.LineBasicMaterial({ color: "#c2413f", transparent: true, opacity: 0.95 });

    for (const link of design.links) {
      const matrix = transforms.get(link.id) ?? new THREE.Matrix4();
      for (const proxy of link.collisionProxies ?? []) {
        if (proxy.enabled === false) continue;
        const [a = 10, b = a, c = a] = proxy.dimensions ?? [10, 10, 10];
        let geometry;
        if (proxy.type === "sphere") geometry = new THREE.SphereGeometry(a, 20, 12);
        else if (proxy.type === "capsule") geometry = new THREE.CapsuleGeometry(a, Math.max(1, b), 12, 8);
        else if (proxy.type === "cylinder") geometry = new THREE.CylinderGeometry(a, a, b, 24, 1);
        else geometry = new THREE.BoxGeometry(a, b, c);

        const isConflict = conflictKeys.has(`${link.id}:${proxy.id}`);
        const mesh = new THREE.Mesh(geometry, (isConflict ? conflictMaterial : material).clone());
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(proxyWorldMatrix(proxy, matrix));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), (isConflict ? conflictEdgeMaterial : edgeMaterial).clone());
        edges.matrixAutoUpdate = false;
        edges.matrix.copy(mesh.matrix);
        this.group.add(mesh, edges);
      }
    }
  }

  addComMarkers(design, transforms) {
    const geometry = new THREE.SphereGeometry(4, 16, 10);
    const material = new THREE.MeshStandardMaterial({ color: "#0f9f6e" });
    for (const link of design.links) {
      const matrix = transforms.get(link.id) ?? new THREE.Matrix4();
      const marker = new THREE.Mesh(geometry.clone(), material.clone());
      marker.position.copy(transformPoint(matrix, link.com));
      this.group.add(marker);
    }
  }

  addJointAxes(design, transforms) {
    const axisMaterial = new THREE.LineBasicMaterial({ color: "#f59e0b" });
    for (const joint of design.joints) {
      const frame = getJointWorldFrame(design, joint, transforms);
      const start = frame.origin.clone().addScaledVector(frame.axis, -24);
      const end = frame.origin.clone().addScaledVector(frame.axis, 24);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), axisMaterial.clone());
      this.group.add(line);
    }
  }
}
