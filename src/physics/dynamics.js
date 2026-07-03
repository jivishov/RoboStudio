import * as THREE from "three";
import { MM_TO_M, SIM_BODY_ANGULAR_DAMPING_FLOOR, SIM_BODY_LINEAR_DAMPING_FLOOR } from "./constants.js";
import { clampJointValue } from "./kinematics.js";

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
  motorsEnabled: false,
  timestep: 1 / 60
});

const degToRad = (value) => (value * Math.PI) / 180;

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

function linkMassProperties(link) {
  const massKg = Math.max(0.001, Number(link.massKg) || 0.001);
  const [cx = 0, cy = 0, cz = 0] = link.com ?? [0, 0, 0];
  const [ix = 0, iy = 0, iz = 0] = link.inertia ?? [0, 0, 0];
  return {
    massKg,
    centerOfMass: {
      x: cx * MM_TO_M,
      y: cy * MM_TO_M,
      z: cz * MM_TO_M
    },
    inertia: {
      x: Math.max(1e-9, Number(ix) || 0),
      y: Math.max(1e-9, Number(iy) || 0),
      z: Math.max(1e-9, Number(iz) || 0)
    }
  };
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

function jointLimits(joint) {
  if (joint.type === "fixed") return null;
  if (!(Number.isFinite(joint.min) && Number.isFinite(joint.max) && joint.min < joint.max)) return null;
  return joint.type === "prismatic"
    ? [joint.min * MM_TO_M, joint.max * MM_TO_M]
    : [degToRad(joint.min), degToRad(joint.max)];
}

function jointPoseTarget(joint, design) {
  const value = clampJointValue(joint, design.pose?.jointAngles?.[joint.id] ?? 0);
  return joint.type === "prismatic" ? value * MM_TO_M : degToRad(value);
}

function configureJointMotor(impulseJoint, joint, design, actuators, rapier, options) {
  if (joint.type === "fixed" || typeof impulseJoint.configureMotorVelocity !== "function") return;

  const actuator = actuators.get(joint.actuatorId);
  if (options.motorsEnabled && actuator && typeof impulseJoint.configureMotorPosition === "function") {
    impulseJoint.configureMotorModel?.(rapier.MotorModel.ForceBased);
    const peakTorqueNm = Math.max(0.01, Number(actuator.peakTorqueNm) || Number(actuator.continuousTorqueNm) || 0.01);
    const maxSpeedRadS = Math.max(0.1, degToRad(Number(actuator.maxSpeedDegS) || 60));
    impulseJoint.configureMotorPosition(jointPoseTarget(joint, design), peakTorqueNm, peakTorqueNm / maxSpeedRadS);
    return;
  }

  const damping = Math.max(0, Number(joint.damping) || 0);
  if (damping > 0) impulseJoint.configureMotorVelocity(0, damping);
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
    const actuators = new Map((design.actuators ?? []).map((actuator) => [actuator.id, actuator]));
    for (const link of design.links) {
      const matrix = transforms.get(link.id) ?? new THREE.Matrix4();
      const { position, quaternion } = decomposeMatrix(matrix);
      const massProperties = linkMassProperties(link);
      const desc = childLinks.has(link.id) ? this.rapier.RigidBodyDesc.dynamic() : this.rapier.RigidBodyDesc.fixed();
      desc
        .setTranslation(position.x * MM_TO_M, position.y * MM_TO_M, position.z * MM_TO_M)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
        .setAdditionalMassProperties(massProperties.massKg, massProperties.centerOfMass, massProperties.inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(SIM_BODY_LINEAR_DAMPING_FLOOR)
        .setAngularDamping(SIM_BODY_ANGULAR_DAMPING_FLOOR)
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
          .setDensity(0);
        this.world.createCollider(collider, body);
      }
      body.recomputeMassPropertiesFromColliders?.();
    }

    for (const joint of design.joints) {
      const parent = this.bodies.get(joint.parentLinkId);
      const child = this.bodies.get(joint.childLinkId);
      if (!parent || !child) continue;
      const impulseJoint = this.world.createImpulseJoint(jointData(joint, this.rapier), parent, child, true);
      const limits = jointLimits(joint);
      if (limits && typeof impulseJoint.setLimits === "function") impulseJoint.setLimits(limits[0], limits[1]);
      configureJointMotor(impulseJoint, joint, design, actuators, this.rapier, options);
      this.joints.push(impulseJoint);
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
