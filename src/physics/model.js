import * as THREE from "three";
import { JOINT_DEFINITIONS } from "../studio/jointRig.js";
import { normalizeActuator } from "./actuators.js";
import { DEFAULT_ACTUATORS, DEFAULT_ASSUMPTIONS, ROBOT_DESIGN_VERSION } from "./constants.js";
import { analyzeTopology } from "./kinematics.js";

const SAMPLE_LINK_GROUPS = [
  {
    id: "base",
    name: "Base",
    partIds: [
      "base",
      "inferred_support_front",
      "inferred_support_back",
      "inferred_support_left",
      "inferred_support_right"
    ]
  },
  { id: "waist", name: "Waist", partIds: ["waist", "inferred_turntable_pin"] },
  { id: "lower_arm", name: "Lower arm", partIds: ["lower_arm", "inferred_shoulder_axle"] },
  { id: "upper_arm", name: "Upper arm", partIds: ["upper_arm", "inferred_elbow_axle"] },
  { id: "wrist", name: "Wrist pitch frame", partIds: ["inferred_wrist_axle"] },
  { id: "hand_mount", name: "Wrist roll / hand mount", partIds: ["wrist_yoke", "inferred_gripper_mount_axle"] },
  {
    id: "gripper",
    name: "Gripper",
    partIds: [
      "gripper_base",
      "gear_left",
      "gear_right",
      "gripper_finger_left",
      "gripper_finger_right",
      "grip_link_left_lower",
      "grip_link_left_upper",
      "grip_link_right_lower",
      "grip_link_right_upper",
      "inferred_left_gear_axle",
      "inferred_right_gear_axle"
    ]
  }
];

const SAMPLE_JOINT_LINKS = {
  turntable: ["base", "waist"],
  shoulder: ["waist", "lower_arm"],
  elbow: ["lower_arm", "upper_arm"],
  wrist: ["upper_arm", "wrist"],
  wrist_roll: ["wrist", "hand_mount"],
  gripper_mount: ["hand_mount", "gripper"]
};

export function sanitizeId(value, fallback = "item") {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

export function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function round(value, digits = 5) {
  return Number(finiteNumber(value).toFixed(digits));
}

export function roundVector(values, digits = 5) {
  return normalizeVector3(values).map((value) => round(value, digits));
}

export function normalizeVector3(values, fallback = [0, 0, 0]) {
  if (!Array.isArray(values) || values.length !== 3) return [...fallback];
  return values.map((value, index) => finiteNumber(value, fallback[index]));
}

function uniqueId(base, existingIds) {
  const clean = sanitizeId(base);
  let id = clean;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${clean}_${suffix}`;
    suffix += 1;
  }
  existingIds.add(id);
  return id;
}

function triangleCount(mesh) {
  const geometry = mesh?.geometry;
  if (!geometry) return 0;
  return Math.round((geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3);
}

function boxToRecord(box) {
  const min = box.min.toArray();
  const max = box.max.toArray();
  const size = box.getSize(new THREE.Vector3()).toArray();
  const center = box.getCenter(new THREE.Vector3()).toArray();
  return {
    min: roundVector(min),
    max: roundVector(max),
    size: roundVector(size),
    center: roundVector(center)
  };
}

function recordToBox(bounds) {
  if (!bounds?.min || !bounds?.max) return null;
  return new THREE.Box3(
    new THREE.Vector3().fromArray(bounds.min),
    new THREE.Vector3().fromArray(bounds.max)
  );
}

function unionBounds(records) {
  const box = new THREE.Box3();
  let hasBounds = false;
  for (const record of records) {
    const partBox = recordToBox(record.bounds);
    if (!partBox) continue;
    box.union(partBox);
    hasBounds = true;
  }

  if (!hasBounds) {
    box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(40, 40, 40));
  }

  return boxToRecord(box);
}

function estimateMassKg(bounds) {
  const size = normalizeVector3(bounds?.size, [40, 40, 40]);
  const volumeM3 = Math.max(1, size[0] * size[1] * size[2]) * 1e-9;
  return round(Math.min(6, Math.max(0.05, volumeM3 * 950)), 3);
}

function inertiaFromBounds(massKg, bounds) {
  const [x, y, z] = normalizeVector3(bounds?.size, [40, 40, 40]).map((value) => value * 0.001);
  return [
    round((massKg * (y * y + z * z)) / 12, 6),
    round((massKg * (x * x + z * z)) / 12, 6),
    round((massKg * (x * x + y * y)) / 12, 6)
  ];
}

function createDefaultProxy(linkId, bounds) {
  const size = normalizeVector3(bounds?.size, [40, 40, 40]).map((value) => Math.max(6, value));
  return {
    id: `${linkId}_box_proxy`,
    type: "box",
    origin: roundVector(bounds?.center ?? [0, 0, 0]),
    dimensions: roundVector(size),
    enabled: true
  };
}

function createLink(id, name, partIds, partRecords) {
  const selectedRecords = partRecords.filter((part) => partIds.includes(part.id));
  const bounds = unionBounds(selectedRecords);
  const massKg = estimateMassKg(bounds);
  return {
    id,
    name,
    partIds: [...partIds],
    massKg,
    com: roundVector(bounds.center),
    inertia: inertiaFromBounds(massKg, bounds),
    collisionProxies: [createDefaultProxy(id, bounds)]
  };
}

function createSampleJoints() {
  return JOINT_DEFINITIONS.filter((joint) => SAMPLE_JOINT_LINKS[joint.id]).map((joint) => {
    const [parentLinkId, childLinkId] = SAMPLE_JOINT_LINKS[joint.id];
    return {
      id: joint.id,
      name: joint.label,
      type: "revolute",
      parentLinkId,
      childLinkId,
      origin: roundVector(joint.pivot),
      axis: roundVector(joint.axis),
      min: joint.minDeg,
      max: joint.maxDeg,
      damping: 0.18,
      friction: 0.05,
      actuatorId: joint.id === "shoulder" || joint.id === "elbow" ? "harmonic_14nm" : "servo_35kg"
    };
  });
}

export function collectAssemblyPartRecords(assemblyRoot, snapshotParts = []) {
  const byId = new Map((snapshotParts ?? []).filter((part) => part?.id).map((part) => [part.id, part]));
  const records = [];
  const usedIds = new Set();

  assemblyRoot?.updateMatrixWorld(true);
  assemblyRoot?.traverse((object) => {
    if (!object.isMesh) return;
    object.updateMatrixWorld(true);
    const fallback = sanitizeId(object.name, "part");
    const metadata = byId.get(object.userData?.id) ?? byId.get(object.name);
    const id = uniqueId(object.userData?.id ?? metadata?.id ?? fallback, usedIds);
    const box = new THREE.Box3().setFromObject(object);
    records.push({
      id,
      name: metadata?.label ?? object.userData?.label ?? object.name ?? id,
      type: metadata?.type ?? object.userData?.type ?? "assembly",
      file: metadata?.file ?? object.userData?.file ?? null,
      visible: object.visible,
      triangles: metadata?.triangles ?? triangleCount(object),
      bounds: boxToRecord(box)
    });
  });

  for (const metadata of snapshotParts ?? []) {
    if (!metadata?.id || records.some((record) => record.id === metadata.id)) continue;
    const id = uniqueId(metadata.id, usedIds);
    records.push({
      id,
      name: metadata.label ?? id,
      type: metadata.type ?? "assembly",
      file: metadata.file ?? null,
      visible: metadata.visible ?? true,
      triangles: metadata.triangles ?? 0,
      bounds: boxToRecord(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(40, 40, 40)))
    });
  }

  return records;
}

export function isSampleAssembly(partRecords) {
  const ids = new Set(partRecords.map((part) => part.id));
  return ["base", "waist", "lower_arm", "upper_arm", "wrist_yoke", "gripper_base"].every((id) =>
    ids.has(id)
  );
}

export function createRobotDesign(partRecords, options = {}) {
  const sample = options.sample ?? isSampleAssembly(partRecords);
  const links = sample
    ? SAMPLE_LINK_GROUPS.map((group) =>
        createLink(
          group.id,
          group.name,
          group.partIds.filter((partId) => partRecords.some((part) => part.id === partId)),
          partRecords
        )
      )
    : partRecords.map((part) => createLink(part.id, part.name, [part.id], partRecords));

  const joints = sample ? createSampleJoints() : [];
  const pose = {
    jointAngles: Object.fromEntries(joints.map((joint) => [joint.id, 0]))
  };

  return {
    version: ROBOT_DESIGN_VERSION,
    units: "mm",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: sample ? "Sample robotic arm model" : "STL robot model",
    source: sample ? "sample-prerigged" : "manual",
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    links,
    joints,
    endEffectors: [
      {
        id: "tool0",
        name: "Tool center",
        linkId: sample ? "gripper" : links.at(-1)?.id ?? links[0]?.id ?? "base",
        toolFrame: { position: [0, 80, 0], rotation: [0, 0, 0] }
      }
    ],
    actuators: DEFAULT_ACTUATORS.map((actuator) => ({ ...actuator })),
    allowedCollisions: joints.map((joint) => [joint.parentLinkId, joint.childLinkId].sort().join("|")),
    pose
  };
}

function normalizePartAssignments(links, partRecords) {
  const knownPartIds = new Set((partRecords ?? []).map((part) => part.id));
  const assigned = new Set();

  for (const link of links) {
    const nextPartIds = [];
    for (const partId of link.partIds ?? []) {
      const normalizedPartId = String(partId);
      if (knownPartIds.size && !knownPartIds.has(normalizedPartId)) continue;
      if (assigned.has(normalizedPartId)) continue;
      assigned.add(normalizedPartId);
      nextPartIds.push(normalizedPartId);
    }
    link.partIds = nextPartIds;
  }

  return links;
}

function normalizeProxyDimensions(proxyType, dimensions) {
  const [a, b, c] = normalizeVector3(dimensions, [10, 10, 10]).map((value) => Math.max(0.001, round(value)));
  if (proxyType === "sphere") return [a, a, a];
  if (proxyType === "capsule" || proxyType === "cylinder") return [a, b, a];
  return [a, b, c];
}

function normalizeAssumptions(assumptions = {}) {
  return {
    payloadKg: Math.max(0, finiteNumber(assumptions.payloadKg, DEFAULT_ASSUMPTIONS.payloadKg)),
    safetyFactor: Math.max(1, finiteNumber(assumptions.safetyFactor, DEFAULT_ASSUMPTIONS.safetyFactor)),
    targetSpeedDegS: Math.max(1, finiteNumber(assumptions.targetSpeedDegS, DEFAULT_ASSUMPTIONS.targetSpeedDegS))
  };
}

function normalizeAllowedCollisions(allowedCollisions, knownLinks) {
  const pairs = new Set();
  if (!Array.isArray(allowedCollisions)) return [];
  for (const pair of allowedCollisions) {
    const [a, b] = String(pair).split("|");
    if (!a || !b || a === b || !knownLinks.has(a) || !knownLinks.has(b)) continue;
    pairs.add([a, b].sort().join("|"));
  }
  return [...pairs];
}

export function normalizeRobotDesign(input, partRecords = []) {
  if (!input || typeof input !== "object" || input.version !== ROBOT_DESIGN_VERSION) {
    return createRobotDesign(partRecords);
  }
  const { exportedAt: _exportedAt, ...inputDesign } = input;

  const linkIds = new Set();
  const links = Array.isArray(inputDesign.links)
    ? normalizePartAssignments(inputDesign.links.map((link, index) => {
        const id = uniqueId(link.id ?? `link_${index + 1}`, linkIds);
        const massKg = Math.max(0, finiteNumber(link.massKg, 0.1));
        const fallbackBounds = unionBounds(partRecords.filter((part) => (link.partIds ?? []).includes(part.id)));
        const proxyIds = new Set();
        return {
          id,
          name: String(link.name ?? id),
          partIds: Array.isArray(link.partIds) ? link.partIds.map(String) : [],
          massKg,
          com: roundVector(link.com ?? fallbackBounds.center),
          inertia: Array.isArray(link.inertia) ? link.inertia.map((value) => finiteNumber(value, 0)) : inertiaFromBounds(massKg, fallbackBounds),
          collisionProxies: Array.isArray(link.collisionProxies) && link.collisionProxies.length
              ? link.collisionProxies.map((proxy, proxyIndex) => {
                  const type = ["box", "sphere", "capsule", "cylinder"].includes(proxy.type) ? proxy.type : "box";
                  return {
                    id: uniqueId(proxy.id ?? `${id}_proxy_${proxyIndex + 1}`, proxyIds),
                    type,
                    origin: roundVector(proxy.origin),
                    dimensions: normalizeProxyDimensions(type, proxy.dimensions),
                    enabled: proxy.enabled !== false
                  };
                })
              : [createDefaultProxy(id, fallbackBounds)]
        };
      }), partRecords)
    : createRobotDesign(partRecords).links;

  const knownLinks = new Set(links.map((link) => link.id));
  const actuatorIds = new Set();
  const actuatorIdMap = new Map();
  const actuators = Array.isArray(inputDesign.actuators) && inputDesign.actuators.length
    ? inputDesign.actuators.map((actuator, index) => {
        const originalId = String(actuator.id ?? `actuator_${index + 1}`);
        const normalizedId = uniqueId(originalId, actuatorIds);
        if (!actuatorIdMap.has(originalId)) actuatorIdMap.set(originalId, normalizedId);
        return normalizeActuator({ ...actuator, id: normalizedId }, `actuator_${index + 1}`);
      })
    : DEFAULT_ACTUATORS.map((actuator) => ({ ...actuator }));
  const knownActuators = new Set(actuators.map((actuator) => actuator.id));
  const jointIds = new Set();
  const joints = Array.isArray(inputDesign.joints)
    ? inputDesign.joints
        .filter((joint) => knownLinks.has(joint.parentLinkId) && knownLinks.has(joint.childLinkId) && joint.parentLinkId !== joint.childLinkId)
        .map((joint) => ({
          id: uniqueId(joint.id ?? "joint", jointIds),
          name: String(joint.name ?? joint.id ?? "Joint"),
          type: ["fixed", "revolute", "prismatic"].includes(joint.type) ? joint.type : "revolute",
          parentLinkId: joint.parentLinkId,
          childLinkId: joint.childLinkId,
          origin: roundVector(joint.origin),
          axis: roundVector(joint.axis ?? [0, 0, 1]),
          min: finiteNumber(joint.min, -180),
          max: finiteNumber(joint.max, 180),
          damping: Math.max(0, finiteNumber(joint.damping, 0.1)),
          friction: Math.max(0, finiteNumber(joint.friction, 0.05)),
          actuatorId: knownActuators.has(joint.actuatorId)
            ? joint.actuatorId
            : actuatorIdMap.get(String(joint.actuatorId)) ?? null
        }))
    : [];
  const knownJoints = new Set(joints.map((joint) => joint.id));
  const effectorIds = new Set();
  const poseJointAngles = {};
  for (const joint of joints) {
    poseJointAngles[joint.id] = finiteNumber(inputDesign.pose?.jointAngles?.[joint.id], 0);
  }

  return {
    ...createRobotDesign(partRecords, { sample: false }),
    ...inputDesign,
    version: ROBOT_DESIGN_VERSION,
    units: "mm",
    updatedAt: new Date().toISOString(),
    assumptions: normalizeAssumptions(inputDesign.assumptions),
    links,
    joints,
    endEffectors: Array.isArray(inputDesign.endEffectors) && inputDesign.endEffectors.length
      ? inputDesign.endEffectors.map((effector) => ({
          id: uniqueId(effector.id ?? "tool", effectorIds),
          name: String(effector.name ?? effector.id ?? "Tool"),
          linkId: knownLinks.has(effector.linkId) ? effector.linkId : links[0]?.id,
          toolFrame: {
            position: roundVector(effector.toolFrame?.position),
            rotation: roundVector(effector.toolFrame?.rotation)
          }
        }))
      : [{ id: "tool0", name: "Tool center", linkId: links.at(-1)?.id ?? links[0]?.id, toolFrame: { position: [0, 80, 0], rotation: [0, 0, 0] } }],
    actuators,
    allowedCollisions: normalizeAllowedCollisions(inputDesign.allowedCollisions, knownLinks),
    pose: {
      jointAngles: Object.fromEntries(Object.entries(poseJointAngles).filter(([jointId]) => knownJoints.has(jointId)))
    }
  };
}

export function validateRobotDesign(design) {
  const issues = [];
  const linkIds = new Set(design.links.map((link) => link.id));
  const assignedParts = new Map();

  for (const link of design.links) {
    if (!link.partIds.length) issues.push({ level: "warn", code: "empty-link", message: `${link.name} has no visual parts.` });
    for (const partId of link.partIds) {
      if (assignedParts.has(partId)) {
        issues.push({
          level: "risk",
          code: "duplicate-part-assignment",
          message: `${partId} is assigned to both ${assignedParts.get(partId)} and ${link.id}.`
        });
      } else {
        assignedParts.set(partId, link.id);
      }
    }
    if (!(link.massKg > 0)) issues.push({ level: "risk", code: "missing-mass", message: `${link.name} needs a positive mass.` });
    if (!link.collisionProxies.some((proxy) => proxy.enabled)) {
      issues.push({ level: "warn", code: "missing-proxy", message: `${link.name} has no enabled collision proxy.` });
    }
  }

  for (const joint of design.joints) {
    if (!linkIds.has(joint.parentLinkId) || !linkIds.has(joint.childLinkId)) {
      issues.push({ level: "risk", code: "bad-joint-link", message: `${joint.name} references a missing link.` });
    }
    if (joint.parentLinkId === joint.childLinkId) {
      issues.push({ level: "risk", code: "self-parent-joint", message: `${joint.name} cannot use the same parent and child link.` });
    }
    if (joint.type !== "fixed" && !(Number.isFinite(joint.min) && Number.isFinite(joint.max) && joint.min < joint.max)) {
      issues.push({ level: "risk", code: "bad-limits", message: `${joint.name} needs valid min/max limits.` });
    }
    if (joint.type !== "fixed" && !joint.actuatorId) {
      issues.push({ level: "warn", code: "missing-actuator", message: `${joint.name} has no actuator assigned.` });
    }
  }

  const topology = analyzeTopology(design);
  for (const item of topology.multipleParents) {
    issues.push({
      level: "risk",
      code: "multiple-parent-link",
      message: `${item.linkId} has multiple parent joints (${item.jointIds.join(", ")}); closed-loop solving is unsupported in V1.`
    });
  }
  for (const cycle of topology.cycles) {
    issues.push({
      level: "risk",
      code: "closed-loop-topology",
      message: `Closed-loop topology detected (${cycle.join(" -> ")}); V1 supports open serial chains only.`
    });
  }

  if (!design.endEffectors.length) {
    issues.push({ level: "warn", code: "missing-tool", message: "Define at least one end effector for IK." });
  }

  return issues;
}

export function cloneRobotDesign(design) {
  return JSON.parse(JSON.stringify(design));
}

export function findLinkForPart(design, partId) {
  return design.links.find((link) => link.partIds.includes(partId)) ?? null;
}

export function getLinkBounds(link, partRecords) {
  return unionBounds(partRecords.filter((part) => link.partIds.includes(part.id)));
}
