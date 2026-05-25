import * as THREE from "three";
import { MM_TO_M } from "./constants.js";

let rapierReady = null;

export const SIMULATION_STATES = Object.freeze([
  "not initialized",
  "initializing",
  "initialized",
  "running",
  "paused",
  "stepped",
  "failed"
]);

export const DEFAULT_SIMULATION_OPTIONS = Object.freeze({
  gravityEnabled: true,
  timestep: 1 / 60
});

export async function ensureRapier() {
  if (!rapierReady) {
    rapierReady = import("@dimforge/rapier3d-compat").then(async (module) => {
      const rapier = module.default ?? module;
      await rapier.init();
      return rapier;
    });
  }
  return rapierReady;
}

function decomposeMatrix(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { position, quaternion };
}

function proxyColliderDesc(proxy, rapier) {
  const [a = 10, b = a, c = a] = proxy.dimensions ?? [10, 10, 10];
  if (proxy.type === "sphere") return rapier.ColliderDesc.ball(Math.max(0.001, a * MM_TO_M));
  if (proxy.type === "capsule") {
    return rapier.ColliderDesc.capsule(Math.max(0.001, (b * MM_TO_M) / 2), Math.max(0.001, a * MM_TO_M));
  }
  if (proxy.type === "cylinder") {
    return rapier.ColliderDesc.cylinder(Math.max(0.001, (b * MM_TO_M) / 2), Math.max(0.001, a * MM_TO_M));
  }
  return rapier.ColliderDesc.cuboid(
    Math.max(0.001, (a * MM_TO_M) / 2),
    Math.max(0.001, (b * MM_TO_M) / 2),
    Math.max(0.001, (c * MM_TO_M) / 2)
  );
}

function jointData(joint, rapier) {
  const anchor1 = {
    x: (joint.origin?.[0] ?? 0) * MM_TO_M,
    y: (joint.origin?.[1] ?? 0) * MM_TO_M,
    z: (joint.origin?.[2] ?? 0) * MM_TO_M
  };
  const anchor2 = { x: 0, y: 0, z: 0 };
  const axis = {
    x: joint.axis?.[0] ?? 0,
    y: joint.axis?.[1] ?? 0,
    z: joint.axis?.[2] ?? 1
  };

  if (joint.type === "fixed") {
    return rapier.JointData.fixed(anchor1, { x: 0, y: 0, z: 0, w: 1 }, anchor2, { x: 0, y: 0, z: 0, w: 1 });
  }
  if (joint.type === "prismatic") return rapier.JointData.prismatic(anchor1, anchor2, axis);
  return rapier.JointData.revolute(anchor1, anchor2, axis);
}

export class DynamicsRunner {
  constructor() {
    this.rapier = null;
    this.world = null;
    this.bodies = new Map();
    this.joints = [];
    this.steps = 0;
    this.gravityEnabled = DEFAULT_SIMULATION_OPTIONS.gravityEnabled;
    this.timestep = DEFAULT_SIMULATION_OPTIONS.timestep;
  }

  clear() {
    this.world = null;
    this.bodies.clear();
    this.joints = [];
    this.steps = 0;
  }

  async reset(design, transforms, options = {}) {
    this.gravityEnabled = options.gravityEnabled !== false;
    this.timestep = Math.min(1 / 15, Math.max(1 / 240, Number(options.timestep) || DEFAULT_SIMULATION_OPTIONS.timestep));
    this.rapier = await ensureRapier();
    this.world = new this.rapier.World(this.gravityEnabled ? { x: 0, y: -9.80665, z: 0 } : { x: 0, y: 0, z: 0 });
    this.world.timestep = this.timestep;
    this.bodies.clear();
    this.joints = [];
    this.steps = 0;

    const childLinks = new Set(design.joints.map((joint) => joint.childLinkId));
    for (const link of design.links) {
      const matrix = transforms.get(link.id) ?? new THREE.Matrix4();
      const { position, quaternion } = decomposeMatrix(matrix);
      const desc = childLinks.has(link.id) ? this.rapier.RigidBodyDesc.dynamic() : this.rapier.RigidBodyDesc.fixed();
      desc
        .setTranslation(position.x * MM_TO_M, position.y * MM_TO_M, position.z * MM_TO_M)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
        .setAdditionalMass(Math.max(0.001, Number(link.massKg) || 0.001))
        .setLinearDamping(0.18)
        .setAngularDamping(0.22)
        .setUserData({ linkId: link.id });
      const body = this.world.createRigidBody(desc);
      this.bodies.set(link.id, body);

      for (const proxy of link.collisionProxies ?? []) {
        if (proxy.enabled === false) continue;
        const collider = proxyColliderDesc(proxy, this.rapier)
          .setTranslation(
            (proxy.origin?.[0] ?? 0) * MM_TO_M,
            (proxy.origin?.[1] ?? 0) * MM_TO_M,
            (proxy.origin?.[2] ?? 0) * MM_TO_M
          )
          .setFriction(0.7)
          .setMass(Math.max(0.001, (Number(link.massKg) || 0.001) / Math.max(1, link.collisionProxies.length)));
        this.world.createCollider(collider, body);
      }
    }

    for (const joint of design.joints) {
      const parent = this.bodies.get(joint.parentLinkId);
      const child = this.bodies.get(joint.childLinkId);
      if (!parent || !child) continue;
      this.joints.push(this.world.createImpulseJoint(jointData(joint, this.rapier), parent, child, true));
    }

    return this.status();
  }

  step(count = 1) {
    if (!this.world) return this.status();
    for (let index = 0; index < count; index += 1) {
      this.world.step();
      this.steps += 1;
    }
    return this.status();
  }

  status() {
    return {
      ready: Boolean(this.world),
      steps: this.steps,
      bodies: this.bodies.size,
      joints: this.joints.length,
      gravityEnabled: this.gravityEnabled,
      timestep: this.timestep
    };
  }

  bodySnapshots() {
    const snapshots = [];
    for (const [linkId, body] of this.bodies.entries()) {
      const translation = body.translation();
      const rotation = body.rotation();
      snapshots.push({
        linkId,
        position: [translation.x / MM_TO_M, translation.y / MM_TO_M, translation.z / MM_TO_M],
        quaternion: [rotation.x, rotation.y, rotation.z, rotation.w]
      });
    }
    return snapshots;
  }
}
