import * as THREE from "three";

const degToRad = (value) => (value * Math.PI) / 180;
const radToDeg = (value) => (value * 180) / Math.PI;

export function clampJointValue(joint, value) {
  if (joint.type === "fixed") return 0;
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.min(joint.max, Math.max(joint.min, numeric));
}

export function getJointAngle(design, jointId, pose = design.pose) {
  const joint = design.joints.find((item) => item.id === jointId);
  return joint ? clampJointValue(joint, pose?.jointAngles?.[jointId] ?? 0) : 0;
}

export function getRootLinkIds(design) {
  const children = new Set(design.joints.map((joint) => joint.childLinkId));
  return design.links.map((link) => link.id).filter((linkId) => !children.has(linkId));
}

export function analyzeTopology(design) {
  const linkIds = new Set(design.links.map((link) => link.id));
  const parentsByChild = new Map();
  const childrenByParent = new Map();

  for (const joint of design.joints) {
    if (!linkIds.has(joint.parentLinkId) || !linkIds.has(joint.childLinkId)) continue;
    if (!parentsByChild.has(joint.childLinkId)) parentsByChild.set(joint.childLinkId, []);
    parentsByChild.get(joint.childLinkId).push({ linkId: joint.parentLinkId, jointId: joint.id });
    if (!childrenByParent.has(joint.parentLinkId)) childrenByParent.set(joint.parentLinkId, []);
    childrenByParent.get(joint.parentLinkId).push(joint.childLinkId);
  }

  const multipleParents = [...parentsByChild.entries()]
    .filter(([, parents]) => parents.length > 1)
    .map(([linkId, parents]) => ({
      linkId,
      parentLinkIds: parents.map((parent) => parent.linkId),
      jointIds: parents.map((parent) => parent.jointId)
    }));

  const visitState = new Map();
  const stack = [];
  const cycles = [];
  const cycleKeys = new Set();

  function visit(linkId) {
    visitState.set(linkId, 1);
    stack.push(linkId);
    for (const childId of childrenByParent.get(linkId) ?? []) {
      const state = visitState.get(childId) ?? 0;
      if (state === 1) {
        const start = stack.indexOf(childId);
        const cycle = [...stack.slice(start), childId];
        const key = cycle.join(">");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push(cycle);
        }
      } else if (state === 0) {
        visit(childId);
      }
    }
    stack.pop();
    visitState.set(linkId, 2);
  }

  for (const link of design.links) {
    if (!visitState.has(link.id)) visit(link.id);
  }

  return {
    roots: getRootLinkIds(design),
    multipleParents,
    cycles,
    unsupportedClosedLoop: multipleParents.length > 0 || cycles.length > 0
  };
}

function jointLocalMatrix(joint, valueDeg) {
  const origin = new THREE.Vector3().fromArray(joint.origin ?? [0, 0, 0]);
  const axis = new THREE.Vector3().fromArray(joint.axis ?? [0, 0, 1]).normalize();
  const matrix = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);

  if (joint.type === "revolute") {
    matrix.multiply(new THREE.Matrix4().makeRotationAxis(axis, degToRad(valueDeg)));
  } else if (joint.type === "prismatic") {
    matrix.multiply(new THREE.Matrix4().makeTranslation(axis.x * valueDeg, axis.y * valueDeg, axis.z * valueDeg));
  }

  return matrix;
}

export function computeForwardKinematics(design, pose = design.pose) {
  const transforms = new Map();
  const roots = getRootLinkIds(design);

  for (const rootId of roots) {
    transforms.set(rootId, new THREE.Matrix4());
  }

  let changed = true;
  let guard = 0;
  while (changed && guard < design.joints.length + 2) {
    changed = false;
    guard += 1;
    for (const joint of design.joints) {
      if (transforms.has(joint.childLinkId) || !transforms.has(joint.parentLinkId)) continue;
      const parentMatrix = transforms.get(joint.parentLinkId);
      const childMatrix = parentMatrix.clone().multiply(jointLocalMatrix(joint, getJointAngle(design, joint.id, pose)));
      transforms.set(joint.childLinkId, childMatrix);
      changed = true;
    }
  }

  for (const link of design.links) {
    if (!transforms.has(link.id)) transforms.set(link.id, new THREE.Matrix4());
  }

  return transforms;
}

export function transformPoint(matrix, point) {
  return new THREE.Vector3().fromArray(point ?? [0, 0, 0]).applyMatrix4(matrix);
}

export function transformDirection(matrix, direction) {
  const normal = new THREE.Matrix3().setFromMatrix4(matrix);
  return new THREE.Vector3().fromArray(direction ?? [0, 0, 1]).normalize().applyMatrix3(normal).normalize();
}

export function getEndEffectorPosition(design, endEffectorId, transforms = computeForwardKinematics(design)) {
  const endEffector = design.endEffectors.find((item) => item.id === endEffectorId) ?? design.endEffectors[0];
  if (!endEffector) return new THREE.Vector3();
  const matrix = transforms.get(endEffector.linkId) ?? new THREE.Matrix4();
  return transformPoint(matrix, endEffector.toolFrame?.position ?? [0, 0, 0]);
}

export function getJointWorldFrame(design, joint, transforms = computeForwardKinematics(design)) {
  const parentMatrix = transforms.get(joint.parentLinkId) ?? new THREE.Matrix4();
  return {
    origin: transformPoint(parentMatrix, joint.origin),
    axis: transformDirection(parentMatrix, joint.axis),
    parentMatrix
  };
}

export function findJointChainToLink(design, linkId) {
  const jointsByChild = new Map(design.joints.map((joint) => [joint.childLinkId, joint]));
  const chain = [];
  let current = linkId;
  const seen = new Set();

  while (jointsByChild.has(current) && !seen.has(current)) {
    seen.add(current);
    const joint = jointsByChild.get(current);
    chain.unshift(joint);
    current = joint.parentLinkId;
  }

  return chain;
}

export function collectChildLinks(design, linkId) {
  const childrenByParent = new Map();
  for (const joint of design.joints) {
    if (!childrenByParent.has(joint.parentLinkId)) childrenByParent.set(joint.parentLinkId, []);
    childrenByParent.get(joint.parentLinkId).push(joint.childLinkId);
  }

  const result = new Set([linkId]);
  const stack = [...(childrenByParent.get(linkId) ?? [])];
  while (stack.length) {
    const current = stack.pop();
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...(childrenByParent.get(current) ?? []));
  }

  return result;
}

export function solveIKCCD(design, endEffectorId, targetPosition, options = {}) {
  const endEffector = design.endEffectors.find((item) => item.id === endEffectorId) ?? design.endEffectors[0];
  if (!endEffector) {
    return { ok: false, reason: "No end effector is defined.", jointAngles: {}, errorMm: Infinity, iterations: 0, chain: [], clampedJoints: [] };
  }

  const topology = analyzeTopology(design);
  if (topology.unsupportedClosedLoop) {
    return {
      ok: false,
      reason: "Closed-loop or multiple-parent topology is unsupported in V1.",
      jointAngles: {},
      errorMm: Infinity,
      iterations: 0,
      chain: [],
      clampedJoints: [],
      topology
    };
  }

  const chain = findJointChainToLink(design, endEffector.linkId).filter((joint) => joint.type === "revolute");
  if (!chain.length) {
    return { ok: false, reason: "No open revolute chain reaches this end effector.", jointAngles: {}, errorMm: Infinity, iterations: 0, chain: [], clampedJoints: [] };
  }

  const target = new THREE.Vector3().fromArray(targetPosition);
  const toleranceMm = options.toleranceMm ?? 2.5;
  const maxIterations = options.maxIterations ?? 80;
  const jointAngles = {
    ...Object.fromEntries(design.joints.map((joint) => [joint.id, getJointAngle(design, joint.id)])),
    ...(options.initialJointAngles ?? {})
  };

  let errorMm = Infinity;
  let iterations = 0;
  const stepScale = options.stepScale ?? 0.82;
  const clampedJoints = new Set();

  for (iterations = 0; iterations < maxIterations; iterations += 1) {
    let transforms = computeForwardKinematics(design, { jointAngles });
    let endPosition = getEndEffectorPosition(design, endEffector.id, transforms);
    errorMm = endPosition.distanceTo(target);
    if (errorMm <= toleranceMm) break;

    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const joint = chain[index];
      transforms = computeForwardKinematics(design, { jointAngles });
      endPosition = getEndEffectorPosition(design, endEffector.id, transforms);
      const frame = getJointWorldFrame(design, joint, transforms);
      const toEnd = endPosition.clone().sub(frame.origin);
      const toTarget = target.clone().sub(frame.origin);
      if (toEnd.lengthSq() < 1e-6 || toTarget.lengthSq() < 1e-6) continue;

      const axis = frame.axis.normalize();
      const endProjected = toEnd.clone().sub(axis.clone().multiplyScalar(toEnd.dot(axis)));
      const targetProjected = toTarget.clone().sub(axis.clone().multiplyScalar(toTarget.dot(axis)));
      if (endProjected.lengthSq() < 1e-8 || targetProjected.lengthSq() < 1e-8) continue;
      endProjected.normalize();
      targetProjected.normalize();
      const cross = new THREE.Vector3().crossVectors(endProjected, targetProjected);
      const signed = Math.atan2(cross.dot(axis), endProjected.dot(targetProjected));
      const next = jointAngles[joint.id] + radToDeg(signed) * stepScale;
      const clamped = clampJointValue(joint, next);
      if (Math.abs(clamped - next) > 1e-6) clampedJoints.add(joint.id);
      jointAngles[joint.id] = clamped;
    }
  }

  const finalTransforms = computeForwardKinematics(design, { jointAngles });
  const finalPosition = getEndEffectorPosition(design, endEffector.id, finalTransforms);
  errorMm = finalPosition.distanceTo(target);

  return {
    ok: errorMm <= toleranceMm,
    reason: errorMm <= toleranceMm ? "Target solved within tolerance." : "Target is unreachable or constrained by joint limits.",
    jointAngles,
    errorMm,
    iterations,
    chain: chain.map((joint) => joint.id),
    clampedJoints: [...clampedJoints],
    targetPosition: target.toArray().map((value) => Number(value.toFixed(3))),
    currentPosition: finalPosition.toArray().map((value) => Number(value.toFixed(3))),
    topology
  };
}
