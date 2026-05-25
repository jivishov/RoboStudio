import * as THREE from "three";
import { GRAVITY } from "./constants.js";
import { collectChildLinks, getJointWorldFrame, transformPoint } from "./kinematics.js";

export function computeMassProperties(design, transforms, payloadKg = 0) {
  let totalMassKg = Math.max(0, Number(payloadKg) || 0);
  const weighted = new THREE.Vector3();
  const linkProperties = [];

  for (const link of design.links) {
    const massKg = Math.max(0, Number(link.massKg) || 0);
    const matrix = transforms.get(link.id) ?? new THREE.Matrix4();
    const worldCom = transformPoint(matrix, link.com ?? [0, 0, 0]);
    totalMassKg += massKg;
    weighted.addScaledVector(worldCom, massKg);
    linkProperties.push({
      linkId: link.id,
      name: link.name,
      massKg,
      worldCom: worldCom.toArray().map((value) => Number(value.toFixed(2)))
    });
  }

  if (payloadKg > 0 && design.endEffectors[0]) {
    const toolLink = design.links.find((link) => link.id === design.endEffectors[0].linkId);
    const matrix = transforms.get(toolLink?.id) ?? new THREE.Matrix4();
    const payloadPoint = transformPoint(matrix, design.endEffectors[0].toolFrame?.position ?? [0, 0, 0]);
    weighted.addScaledVector(payloadPoint, payloadKg);
  }

  const centerOfMass = totalMassKg > 0 ? weighted.multiplyScalar(1 / totalMassKg) : new THREE.Vector3();

  return {
    totalMassKg: Number(totalMassKg.toFixed(3)),
    centerOfMass: centerOfMass.toArray().map((value) => Number(value.toFixed(2))),
    linkProperties
  };
}

function subtreeMassAndCom(design, transforms, rootLinkId, payloadKg) {
  const childLinks = collectChildLinks(design, rootLinkId);
  const weighted = new THREE.Vector3();
  let mass = 0;

  for (const link of design.links) {
    if (!childLinks.has(link.id)) continue;
    const linkMass = Math.max(0, Number(link.massKg) || 0);
    const worldCom = transformPoint(transforms.get(link.id) ?? new THREE.Matrix4(), link.com ?? [0, 0, 0]);
    weighted.addScaledVector(worldCom, linkMass);
    mass += linkMass;
  }

  const effector = design.endEffectors[0];
  if (effector && childLinks.has(effector.linkId) && payloadKg > 0) {
    const payloadPoint = transformPoint(
      transforms.get(effector.linkId) ?? new THREE.Matrix4(),
      effector.toolFrame?.position ?? [0, 0, 0]
    );
    weighted.addScaledVector(payloadPoint, payloadKg);
    mass += payloadKg;
  }

  return {
    mass,
    com: mass > 0 ? weighted.multiplyScalar(1 / mass) : new THREE.Vector3()
  };
}

export function estimateJointLoads(design, transforms, options = {}) {
  const payloadKg = Math.max(0, Number(options.payloadKg) || 0);
  const safetyFactor = Math.max(1, Number(options.safetyFactor) || 1);
  const targetSpeedDegS = Math.max(1, Number(options.targetSpeedDegS) || 1);
  const speedMultiplier = 1 + targetSpeedDegS / 360;

  return design.joints.map((joint) => {
    const subtree = subtreeMassAndCom(design, transforms, joint.childLinkId, payloadKg);
    const frame = getJointWorldFrame(design, joint, transforms);
    const leverMm = Math.hypot(subtree.com.x - frame.origin.x, subtree.com.z - frame.origin.z);
    const staticTorqueNm = subtree.mass * GRAVITY * (leverMm / 1000);
    const recommendedTorqueNm = staticTorqueNm * safetyFactor * speedMultiplier;
    return {
      jointId: joint.id,
      jointName: joint.name,
      carriedMassKg: Number(subtree.mass.toFixed(3)),
      leverMm: Number(leverMm.toFixed(1)),
      staticTorqueNm: Number(staticTorqueNm.toFixed(3)),
      recommendedTorqueNm: Number(recommendedTorqueNm.toFixed(3))
    };
  });
}

export function baseStability(design, massProperties) {
  const base = design.links[0];
  const proxy = base?.collisionProxies?.find((item) => item.enabled !== false);
  if (!proxy || proxy.type !== "box") {
    return {
      ok: false,
      marginMm: 0,
      baseProjectionMm: [0, 0],
      supportCenterMm: [0, 0],
      supportHalfExtentsMm: [0, 0],
      message: "Base stability needs a box proxy on the root link."
    };
  }

  const [width = 1, , depth = 1] = proxy.dimensions;
  const [originXRaw = 0, , originZRaw = 0] = proxy.origin ?? [0, 0, 0];
  const originX = Number.isFinite(Number(originXRaw)) ? Number(originXRaw) : 0;
  const originZ = Number.isFinite(Number(originZRaw)) ? Number(originZRaw) : 0;
  const [x, , z] = massProperties.centerOfMass;
  const marginX = width / 2 - Math.abs(x - originX);
  const marginZ = depth / 2 - Math.abs(z - originZ);
  const marginMm = Math.min(marginX, marginZ);
  return {
    ok: marginMm >= 0,
    marginMm: Number(marginMm.toFixed(1)),
    baseProjectionMm: [Number(x.toFixed(1)), Number(z.toFixed(1))],
    supportCenterMm: [Number(originX.toFixed(1)), Number(originZ.toFixed(1))],
    supportHalfExtentsMm: [Number((width / 2).toFixed(1)), Number((depth / 2).toFixed(1))],
    message: marginMm >= 0 ? "Center of mass projects inside the base proxy." : "Center of mass projects outside the base proxy."
  };
}
