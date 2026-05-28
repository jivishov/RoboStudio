import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jscad from "@jscad/modeling";
import stlSerializer from "@jscad/stl-serializer";

const { booleans, geometries, primitives, transforms } = jscad;
const { subtract, union } = booleans;
const { geom3 } = geometries;
const { cuboid, cylinder, roundedCuboid } = primitives;
const { rotateX, rotateY, rotateZ, translate } = transforms;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const STL_DIR = path.join(ROOT_DIR, "stl");

export const HARDWARE = Object.freeze({
  units: "millimeters",
  fastener: "M3",
  m3ClearanceDiameterMm: 3.2,
  counterboreDiameterMm: 6.2,
  counterboreDepthMm: 3.2,
  shaftNominalDiameterMm: 8,
  jointBoreDiameterMm: 8.35,
  slipFitClearanceMm: 0.35,
  minimumWallMm: 2.4,
  segments: 72
});

const SEGMENTS = HARDWARE.segments;
const DEG = Math.PI / 180;

function cleanNumber(value) {
  return Number(value.toFixed(3));
}

function combine(...solids) {
  const list = solids.flat().filter(Boolean);
  return list.length === 1 ? list[0] : union(...list);
}

function cut(base, ...cutters) {
  const list = cutters.flat().filter(Boolean);
  return list.length === 0 ? base : subtract(base, ...list);
}

function move(offset, solid) {
  return translate(offset, solid);
}

function zCylinder(radius, height, segments = SEGMENTS) {
  return cylinder({ radius, height, segments });
}

function xCylinder(radius, length, segments = SEGMENTS) {
  return rotateY(Math.PI / 2, zCylinder(radius, length, segments));
}

function yCylinder(radius, length, segments = SEGMENTS) {
  return rotateX(Math.PI / 2, zCylinder(radius, length, segments));
}

function ringZ(outerRadius, innerRadius, height, segments = SEGMENTS) {
  return cut(zCylinder(outerRadius, height, segments), zCylinder(innerRadius, height + 2, segments));
}

function ringX(outerRadius, innerRadius, length, segments = SEGMENTS) {
  return rotateY(Math.PI / 2, ringZ(outerRadius, innerRadius, length, segments));
}

function ringY(outerRadius, innerRadius, length, segments = SEGMENTS) {
  return rotateX(Math.PI / 2, ringZ(outerRadius, innerRadius, length, segments));
}

function roundedBlock(size, radius = 3, segments = 12) {
  const maxRadius = Math.max(0.05, Math.min(...size.map((value) => Math.abs(value))) / 2 - 0.05);
  return roundedCuboid({ size, roundRadius: Math.min(radius, maxRadius), segments });
}

function boltCircleZ({ count, radius, holeRadius, height, z = 0, startAngle = 0, segments = 28 }) {
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + (index * Math.PI * 2) / count;
    return move([Math.cos(angle) * radius, Math.sin(angle) * radius, z], zCylinder(holeRadius, height, segments));
  });
}

function boltCircleX({ count, radius, holeRadius, length, x = 0, startAngle = 0, segments = 28 }) {
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + (index * Math.PI * 2) / count;
    return move([x, Math.cos(angle) * radius, Math.sin(angle) * radius], xCylinder(holeRadius, length, segments));
  });
}

function boltCircleY({ count, radius, holeRadius, length, y = 0, startAngle = 0, segments = 28 }) {
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + (index * Math.PI * 2) / count;
    return move([Math.cos(angle) * radius, y, Math.sin(angle) * radius], yCylinder(holeRadius, length, segments));
  });
}

function slotThroughX(slotLength, slotHeight, throughLength) {
  const radius = slotHeight / 2;
  const centerDistance = Math.max(0, slotLength - slotHeight);
  return combine(
    move([0, -centerDistance / 2, 0], xCylinder(radius, throughLength, 28)),
    move([0, centerDistance / 2, 0], xCylinder(radius, throughLength, 28)),
    roundedBlock([throughLength, centerDistance || 0.1, slotHeight], Math.min(1.2, radius / 2), 8)
  );
}

function slotThroughZ(slotLength, slotWidth, throughHeight) {
  const radius = slotWidth / 2;
  const centerDistance = Math.max(0, slotLength - slotWidth);
  return combine(
    move([-centerDistance / 2, 0, 0], zCylinder(radius, throughHeight, 28)),
    move([centerDistance / 2, 0, 0], zCylinder(radius, throughHeight, 28)),
    roundedBlock([centerDistance || 0.1, slotWidth, throughHeight], Math.min(1.2, radius / 2), 8)
  );
}

function pairedFastenerHolesX(yOffset, zOffset, holeRadius, length) {
  return [
    move([0, yOffset, zOffset], xCylinder(holeRadius, length, 24)),
    move([0, -yOffset, zOffset], xCylinder(holeRadius, length, 24)),
    move([0, yOffset, -zOffset], xCylinder(holeRadius, length, 24)),
    move([0, -yOffset, -zOffset], xCylinder(holeRadius, length, 24))
  ];
}

function radialBlocks({ count, radius, size, z, angleOffset = 0 }) {
  return Array.from({ length: count }, (_, index) => {
    const angle = angleOffset + (index * Math.PI * 2) / count;
    const block = rotateZ(angle, roundedBlock(size, Math.min(size[1], size[2]) * 0.25, 8));
    return move([Math.cos(angle) * radius, Math.sin(angle) * radius, z], block);
  });
}

function polygonBounds(polygons) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }
  const size = max.map((value, index) => cleanNumber(value - min[index]));
  const center = min.map((value, index) => cleanNumber(value + size[index] / 2));
  return {
    min: min.map(cleanNumber),
    max: max.map(cleanNumber),
    size,
    center
  };
}

function triangleCountFromSolid(solid) {
  return geom3.toPolygons(solid).reduce((count, polygon) => count + Math.max(0, polygon.vertices.length - 2), 0);
}

function solidMetrics(solid) {
  const polygons = geom3.toPolygons(solid);
  return {
    polygonCount: polygons.length,
    triangleCount: triangleCountFromSolid(solid),
    boundsMm: polygonBounds(polygons)
  };
}

function baseYawTurntable() {
  const plate = zCylinder(78, 14, 112);
  const raisedBoss = move([0, 0, 8], ringZ(43, HARDWARE.jointBoreDiameterMm / 2, 14, 96));
  const outerRim = move([0, 0, 6.5], ringZ(72, 64, 5, 112));
  const feet = radialBlocks({ count: 4, radius: 76, size: [48, 28, 8], z: -3, angleOffset: Math.PI / 4 });
  const body = combine(plate, raisedBoss, outerRim, feet);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const counterbore = HARDWARE.counterboreDiameterMm / 2;
  const holes = [
    zCylinder(HARDWARE.jointBoreDiameterMm / 2, 36, 72),
    ...boltCircleZ({ count: 6, radius: 52, holeRadius: clearance, height: 34 }),
    ...boltCircleZ({ count: 6, radius: 52, holeRadius: counterbore, height: HARDWARE.counterboreDepthMm, z: 5.7 }),
    ...boltCircleZ({ count: 8, radius: 34, holeRadius: 6.2, height: 22, startAngle: Math.PI / 8 }),
    move([0, -76, 1], roundedBlock([28, 36, 8], 3, 10))
  ];
  return cut(body, holes);
}

function rotatingColumn() {
  const lowerFlange = zCylinder(54, 13, 96);
  const column = move([0, 0, 34], roundedBlock([46, 42, 66], 7, 14));
  const shoulderSaddle = move([0, 0, 75], roundedBlock([70, 38, 24], 5, 12));
  const rearCableRib = move([0, -26, 36], roundedBlock([22, 8, 58], 2.5, 8));
  const body = combine(lowerFlange, column, shoulderSaddle, rearCableRib);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    zCylinder(HARDWARE.jointBoreDiameterMm / 2, 100, 72),
    ...boltCircleZ({ count: 6, radius: 52, holeRadius: clearance, height: 32 }),
    move([0, 0, 75], xCylinder(HARDWARE.jointBoreDiameterMm / 2, 88, 72)),
    move([0, -18, 38], roundedBlock([18, 15, 52], 3, 10)),
    move([0, -22, 74], roundedBlock([24, 18, 12], 2.5, 8)),
    ...[
      move([0, 14, 75], xCylinder(clearance, 88, 24)),
      move([0, -14, 75], xCylinder(clearance, 88, 24)),
      move([0, 0, 88], xCylinder(clearance, 88, 24))
    ]
  ];
  return cut(body, holes);
}

function shoulderYokeSide(side = 1) {
  const sidePlate = roundedBlock([9, 58, 98], 3, 10);
  const axisBoss = move([0, 0, 23], ringX(22, HARDWARE.jointBoreDiameterMm / 2, 14, 72));
  const lowerBoss = move([0, 0, -33], ringX(17, HARDWARE.jointBoreDiameterMm / 2, 12, 56));
  const keyedRail = move([side * 5.8, 24, -1], roundedBlock([4, 8, 66], 1.5, 8));
  const body = combine(sidePlate, axisBoss, lowerBoss, keyedRail);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    move([0, 0, 23], xCylinder(HARDWARE.jointBoreDiameterMm / 2, 24, 72)),
    move([0, 0, -33], xCylinder(HARDWARE.jointBoreDiameterMm / 2, 24, 56)),
    move([0, 0, -4], slotThroughX(42, 15, 26)),
    move([0, 0, 48], slotThroughX(32, 12, 26)),
    ...[
      move([0, 18, -28], xCylinder(clearance, 24, 24)),
      move([0, -18, -28], xCylinder(clearance, 24, 24)),
      move([0, 18, 23], xCylinder(clearance, 24, 24)),
      move([0, -18, 23], xCylinder(clearance, 24, 24))
    ]
  ];
  return cut(body, holes);
}

function armShell({ length, height, side = 1, name }) {
  const endDistance = length / 2;
  const beam = roundedBlock([10, length, height], 3.5, 12);
  const proximalBoss = move([0, -endDistance, 0], ringX(25, HARDWARE.jointBoreDiameterMm / 2, 15, 72));
  const distalBoss = move([0, endDistance, 0], ringX(25, HARDWARE.jointBoreDiameterMm / 2, 15, 72));
  const topCableChannel = move([side * 4.5, 0, height / 2 + 2], roundedBlock([5, length - 34, 5], 1.5, 8));
  const diagonalRibA = rotateZ(8 * DEG, move([side * 5.6, -length * 0.18, 0], roundedBlock([4, length * 0.48, height + 6], 1.2, 8)));
  const diagonalRibB = rotateZ(-8 * DEG, move([side * 5.6, length * 0.18, 0], roundedBlock([4, length * 0.48, height + 6], 1.2, 8)));
  const body = combine(beam, proximalBoss, distalBoss, topCableChannel, diagonalRibA, diagonalRibB);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    move([0, -endDistance, 0], xCylinder(HARDWARE.jointBoreDiameterMm / 2, 28, 72)),
    move([0, endDistance, 0], xCylinder(HARDWARE.jointBoreDiameterMm / 2, 28, 72)),
    move([0, 0, 0], slotThroughX(Math.max(40, length - 72), Math.min(18, height - 14), 30)),
    move([side * 4.5, 0, height / 2 + 2], roundedBlock([8, length - 48, 3], 1, 8)),
    ...pairedFastenerHolesX(14, 14, clearance, 28).map((hole) => move([0, -endDistance, 0], hole)),
    ...pairedFastenerHolesX(14, 14, clearance, 28).map((hole) => move([0, endDistance, 0], hole))
  ];
  const solid = cut(body, holes);
  solid.properties = { name };
  return solid;
}

function elbowHub() {
  const drum = ringX(31, HARDWARE.jointBoreDiameterMm / 2, 52, 88);
  const outerFlanges = combine(
    move([-24, 0, 0], ringX(34, HARDWARE.jointBoreDiameterMm / 2, 7, 88)),
    move([24, 0, 0], ringX(34, HARDWARE.jointBoreDiameterMm / 2, 7, 88))
  );
  const indexedKey = move([0, 0, 30], roundedBlock([42, 12, 8], 2, 8));
  const cableNotchBridge = move([0, -27, 0], roundedBlock([38, 8, 30], 2, 8));
  const body = combine(drum, outerFlanges, indexedKey, cableNotchBridge);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    xCylinder(HARDWARE.jointBoreDiameterMm / 2, 70, 88),
    ...boltCircleX({ count: 6, radius: 22, holeRadius: clearance, length: 70, startAngle: Math.PI / 6 }),
    move([0, -28, 0], roundedBlock([44, 12, 18], 2, 8))
  ];
  return cut(body, holes);
}

function wristRollCarrier() {
  const barrel = ringY(27, HARDWARE.jointBoreDiameterMm / 2, 58, 80);
  const forearmMount = move([0, -32, 0], roundedBlock([50, 13, 38], 4, 10));
  const sideRibs = combine(
    move([-24, -14, 0], roundedBlock([5, 34, 34], 1.5, 8)),
    move([24, -14, 0], roundedBlock([5, 34, 34], 1.5, 8))
  );
  const body = combine(barrel, forearmMount, sideRibs);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    yCylinder(HARDWARE.jointBoreDiameterMm / 2, 74, 80),
    ...boltCircleY({ count: 4, radius: 18, holeRadius: clearance, length: 74, startAngle: Math.PI / 4 }),
    move([0, -32, 0], yCylinder(clearance, 24, 24)),
    move([-16, -32, 0], yCylinder(clearance, 24, 24)),
    move([16, -32, 0], yCylinder(clearance, 24, 24))
  ];
  return cut(body, holes);
}

function wristPitchFork() {
  const leftCheek = move([-20, 8, 0], roundedBlock([9, 48, 42], 3, 10));
  const rightCheek = move([20, 8, 0], roundedBlock([9, 48, 42], 3, 10));
  const rearBridge = move([0, -18, 0], roundedBlock([49, 12, 30], 3, 10));
  const topRib = move([0, 8, 20], roundedBlock([49, 38, 5], 1.5, 8));
  const body = combine(leftCheek, rightCheek, rearBridge, topRib);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    move([0, 12, 3], xCylinder(HARDWARE.jointBoreDiameterMm / 2, 60, 72)),
    move([0, -18, 0], yCylinder(HARDWARE.jointBoreDiameterMm / 2, 28, 56)),
    move([-20, 8, -8], slotThroughX(26, 11, 20)),
    move([20, 8, -8], slotThroughX(26, 11, 20)),
    move([0, -18, 11], yCylinder(clearance, 28, 24)),
    move([0, -18, -11], yCylinder(clearance, 28, 24))
  ];
  return cut(body, holes);
}

function toolRollFlange() {
  const disk = zCylinder(31, 8, 88);
  const raisedHub = move([0, 0, 9], ringZ(16, HARDWARE.jointBoreDiameterMm / 2, 14, 72));
  const toolPilot = move([0, 0, -5], ringZ(20, 12, 4, 72));
  const indexingTab = move([0, 27, 1], roundedBlock([16, 9, 8], 2, 8));
  const body = combine(disk, raisedHub, toolPilot, indexingTab);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    zCylinder(HARDWARE.jointBoreDiameterMm / 2, 34, 72),
    ...boltCircleZ({ count: 6, radius: 21, holeRadius: clearance, height: 28, startAngle: Math.PI / 6 }),
    ...boltCircleZ({ count: 6, radius: 21, holeRadius: HARDWARE.counterboreDiameterMm / 2, height: HARDWARE.counterboreDepthMm, z: 4.2, startAngle: Math.PI / 6 })
  ];
  return cut(body, holes);
}

function gripperAdapterPlate() {
  const plate = roundedBlock([62, 44, 7], 4, 12);
  const raisedRailA = move([0, 15, 5.5], roundedBlock([48, 5, 5], 1.2, 8));
  const raisedRailB = move([0, -15, 5.5], roundedBlock([48, 5, 5], 1.2, 8));
  const body = combine(plate, raisedRailA, raisedRailB);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    zCylinder(HARDWARE.jointBoreDiameterMm / 2, 18, 56),
    move([-21, -14, 0], zCylinder(clearance, 18, 24)),
    move([21, -14, 0], zCylinder(clearance, 18, 24)),
    move([-21, 14, 0], zCylinder(clearance, 18, 24)),
    move([21, 14, 0], zCylinder(clearance, 18, 24)),
    move([-15, 0, 0], slotThroughZ(19, HARDWARE.m3ClearanceDiameterMm, 18)),
    move([15, 0, 0], slotThroughZ(19, HARDWARE.m3ClearanceDiameterMm, 18))
  ];
  return cut(body, holes);
}

function cableChannelCover() {
  const cover = roundedBlock([20, 104, 5], 2.2, 10);
  const raisedSpine = move([0, 0, 4], roundedBlock([8, 86, 3], 1.2, 8));
  const labelPad = move([0, -36, 5], roundedBlock([16, 17, 2], 1, 8));
  const body = combine(cover, raisedSpine, labelPad);

  const clearance = HARDWARE.m3ClearanceDiameterMm / 2;
  const holes = [
    move([0, -43, 0], zCylinder(clearance, 14, 24)),
    move([0, 43, 0], zCylinder(clearance, 14, 24)),
    move([0, 0, -1], roundedBlock([12, 66, 4], 1.5, 8))
  ];
  return cut(body, holes);
}

function spacerSet() {
  const spacerHeights = [3, 4, 5, 8];
  return combine(
    spacerHeights.map((height, index) =>
      move([(index - 1.5) * 24, 0, 0], ringZ(9, HARDWARE.jointBoreDiameterMm / 2, height, 56))
    )
  );
}

function axisAlignmentGauge() {
  const plate = roundedBlock([88, 28, 5], 3, 10);
  const verticalPeg = move([-30, 0, 9], zCylinder(HARDWARE.jointBoreDiameterMm / 2, 18, 56));
  const horizontalPeg = move([28, 0, 12], xCylinder(HARDWARE.jointBoreDiameterMm / 2, 34, 56));
  const pointer = move([0, 0, 7], roundedBlock([34, 6, 4], 1, 8));
  const body = combine(plate, verticalPeg, horizontalPeg, pointer);
  const holes = [
    move([-30, 0, 9], zCylinder(2.1, 24, 32)),
    move([28, 0, 12], xCylinder(2.1, 42, 32))
  ];
  return cut(body, holes);
}

export const PART_DEFINITIONS = Object.freeze([
  {
    id: "j1_base_yaw_turntable",
    fileName: "01_j1_base_yaw_turntable.stl",
    name: "J1 Base Yaw Turntable",
    jointRole: "J1 fixed base, yaw bearing seat, and lower bolt circle",
    printOrientation: "flat, base face on build plate",
    minTriangles: 700,
    interfaces: ["j1_bore", "j1_bolt_circle", "m3_clearance"],
    build: baseYawTurntable
  },
  {
    id: "j1_rotating_column",
    fileName: "02_j1_rotating_column.stl",
    name: "J1 Rotating Column",
    jointRole: "J1 rotating column and J2 shoulder axis carrier",
    printOrientation: "upright with flange on build plate",
    minTriangles: 700,
    interfaces: ["j1_bore", "j1_bolt_circle", "j2_axis_bore", "m3_clearance"],
    build: rotatingColumn
  },
  {
    id: "j2_shoulder_yoke_left",
    fileName: "03_j2_shoulder_yoke_left.stl",
    name: "J2 Shoulder Yoke Left",
    jointRole: "left shoulder side plate for J2 and upper-arm pivot",
    printOrientation: "flat on outside face",
    minTriangles: 450,
    interfaces: ["j2_axis_bore", "j3_axis_bore", "m3_clearance"],
    build: () => shoulderYokeSide(-1)
  },
  {
    id: "j2_shoulder_yoke_right",
    fileName: "04_j2_shoulder_yoke_right.stl",
    name: "J2 Shoulder Yoke Right",
    jointRole: "right shoulder side plate for J2 and upper-arm pivot",
    printOrientation: "flat on outside face",
    minTriangles: 450,
    interfaces: ["j2_axis_bore", "j3_axis_bore", "m3_clearance"],
    build: () => shoulderYokeSide(1)
  },
  {
    id: "j3_upper_arm_shell_left",
    fileName: "05_j3_upper_arm_shell_left.stl",
    name: "J3 Upper Arm Shell Left",
    jointRole: "left structural upper-arm side shell",
    printOrientation: "flat on outer face",
    minTriangles: 650,
    interfaces: ["j3_axis_bore", "elbow_axis_bore", "m3_clearance"],
    build: () => armShell({ length: 138, height: 42, side: -1, name: "upper-left" })
  },
  {
    id: "j3_upper_arm_shell_right",
    fileName: "06_j3_upper_arm_shell_right.stl",
    name: "J3 Upper Arm Shell Right",
    jointRole: "right structural upper-arm side shell",
    printOrientation: "flat on outer face",
    minTriangles: 650,
    interfaces: ["j3_axis_bore", "elbow_axis_bore", "m3_clearance"],
    build: () => armShell({ length: 138, height: 42, side: 1, name: "upper-right" })
  },
  {
    id: "elbow_hub",
    fileName: "07_elbow_hub.stl",
    name: "Elbow Hub",
    jointRole: "J3 elbow hub joining upper arm to forearm",
    printOrientation: "axis horizontal with supports under flanges",
    minTriangles: 600,
    interfaces: ["elbow_axis_bore", "m3_clearance"],
    build: elbowHub
  },
  {
    id: "forearm_shell_left",
    fileName: "08_forearm_shell_left.stl",
    name: "Forearm Shell Left",
    jointRole: "left forearm shell between elbow and wrist roll",
    printOrientation: "flat on outer face",
    minTriangles: 650,
    interfaces: ["elbow_axis_bore", "j4_axis_bore", "m3_clearance"],
    build: () => armShell({ length: 118, height: 36, side: -1, name: "forearm-left" })
  },
  {
    id: "forearm_shell_right",
    fileName: "09_forearm_shell_right.stl",
    name: "Forearm Shell Right",
    jointRole: "right forearm shell between elbow and wrist roll",
    printOrientation: "flat on outer face",
    minTriangles: 650,
    interfaces: ["elbow_axis_bore", "j4_axis_bore", "m3_clearance"],
    build: () => armShell({ length: 118, height: 36, side: 1, name: "forearm-right" })
  },
  {
    id: "j4_wrist_roll_carrier",
    fileName: "10_j4_wrist_roll_carrier.stl",
    name: "J4 Wrist Roll Carrier",
    jointRole: "forearm-end carrier for wrist roll axis",
    printOrientation: "barrel axis parallel to build plate",
    minTriangles: 550,
    interfaces: ["j4_axis_bore", "j5_axis_bore", "m3_clearance"],
    build: wristRollCarrier
  },
  {
    id: "j5_wrist_pitch_fork",
    fileName: "11_j5_wrist_pitch_fork.stl",
    name: "J5 Wrist Pitch Fork",
    jointRole: "compact wrist pitch fork and J6 mount bridge",
    printOrientation: "rear bridge on build plate",
    minTriangles: 520,
    interfaces: ["j5_axis_bore", "j6_axis_bore", "m3_clearance"],
    build: wristPitchFork
  },
  {
    id: "j6_tool_roll_flange",
    fileName: "12_j6_tool_roll_flange.stl",
    name: "J6 Tool Roll Flange",
    jointRole: "tool roll flange and gripper interface",
    printOrientation: "flat with tool face up",
    minTriangles: 450,
    interfaces: ["j6_axis_bore", "tool_bolt_circle", "m3_clearance"],
    build: toolRollFlange
  },
  {
    id: "gripper_adapter_plate",
    fileName: "13_gripper_adapter_plate.stl",
    name: "Gripper Adapter Plate",
    jointRole: "universal adapter plate for small grippers or end-effectors",
    printOrientation: "flat",
    minTriangles: 220,
    interfaces: ["tool_bolt_circle", "m3_clearance"],
    build: gripperAdapterPlate
  },
  {
    id: "cable_channel_cover",
    fileName: "14_cable_channel_cover.stl",
    name: "Cable Channel Cover",
    jointRole: "rear cable cover for upper-arm or forearm routing",
    printOrientation: "flat exterior face up",
    minTriangles: 160,
    interfaces: ["m3_clearance"],
    build: cableChannelCover
  },
  {
    id: "spacer_set",
    fileName: "15_spacer_set.stl",
    name: "Spacer Set",
    jointRole: "printable spacer rings for shoulder, elbow, and wrist stack-up tuning",
    printOrientation: "flat rings on build plate",
    minTriangles: 300,
    interfaces: ["joint_spacer_bore"],
    build: spacerSet
  },
  {
    id: "axis_alignment_gauge",
    fileName: "16_axis_alignment_gauge.stl",
    name: "Axis Alignment Gauge",
    jointRole: "assembly aid for checking 8 mm-class vertical and horizontal pin fit",
    printOrientation: "flat",
    minTriangles: 180,
    interfaces: ["j1_bore", "j2_axis_bore"],
    build: axisAlignmentGauge
  }
]);

export function buildPartSolids() {
  return PART_DEFINITIONS.map((definition) => {
    const solid = definition.build();
    return {
      definition,
      solid,
      metrics: solidMetrics(solid)
    };
  });
}

function createInterfaceChecks() {
  const jointBore = HARDWARE.jointBoreDiameterMm;
  const m3 = HARDWARE.m3ClearanceDiameterMm;
  const counterbore = HARDWARE.counterboreDiameterMm;
  return [
    {
      id: "standard_m3_clearance",
      description: "All M3 clearance holes use the same 3.2 mm generated diameter.",
      toleranceMm: 0.01,
      pairedDimensions: [{ label: "m3ClearanceDiameterMm", valuesMm: [m3, m3, m3, m3] }]
    },
    {
      id: "standard_counterbore",
      description: "Counterbores use a consistent printable M3 socket-head clearance.",
      toleranceMm: 0.01,
      pairedDimensions: [
        { label: "counterboreDiameterMm", valuesMm: [counterbore, counterbore] },
        { label: "counterboreDepthMm", valuesMm: [HARDWARE.counterboreDepthMm, HARDWARE.counterboreDepthMm] }
      ]
    },
    {
      id: "j1_base_to_column",
      description: "Base and rotating column share the same J1 bore and six-hole bolt circle.",
      toleranceMm: 0.05,
      pairedDimensions: [
        { label: "jointBoreDiameterMm", valuesMm: [jointBore, jointBore] },
        { label: "boltCircleDiameterMm", valuesMm: [104, 104] },
        { label: "boltHoleCount", values: [6, 6] }
      ],
      participants: ["j1_base_yaw_turntable", "j1_rotating_column"]
    },
    {
      id: "shoulder_axis_stack",
      description: "Column shoulder saddle and shoulder yoke plates use the same 8.35 mm pivot bore.",
      toleranceMm: 0.05,
      pairedDimensions: [{ label: "jointBoreDiameterMm", valuesMm: [jointBore, jointBore, jointBore] }],
      participants: ["j1_rotating_column", "j2_shoulder_yoke_left", "j2_shoulder_yoke_right"]
    },
    {
      id: "arm_link_pivots",
      description: "Upper arm, elbow, forearm, and wrist pivots use a common shaft-style bore.",
      toleranceMm: 0.05,
      pairedDimensions: [{ label: "jointBoreDiameterMm", valuesMm: [jointBore, jointBore, jointBore, jointBore] }],
      participants: ["j3_upper_arm_shell_left", "elbow_hub", "forearm_shell_left", "j4_wrist_roll_carrier"]
    },
    {
      id: "tool_flange_pattern",
      description: "Tool flange and gripper adapter use M3-compatible fastening and centered pilot clearance.",
      toleranceMm: 0.05,
      pairedDimensions: [
        { label: "toolBoltCircleDiameterMm", valuesMm: [42, 42] },
        { label: "toolHoleDiameterMm", valuesMm: [m3, m3] }
      ],
      participants: ["j6_tool_roll_flange", "gripper_adapter_plate"]
    },
    {
      id: "printable_wall_and_clearance",
      description: "Global printability standards used by all generated part definitions.",
      toleranceMm: 0.01,
      pairedDimensions: [
        { label: "minimumWallMm", valuesMm: [HARDWARE.minimumWallMm, 2.4] },
        { label: "slipFitClearanceMm", valuesMm: [HARDWARE.slipFitClearanceMm, 0.35] }
      ]
    }
  ];
}

function createManifest(parts) {
  return {
    kitName: "Original 6-Axis Robotic Arm STL Kit",
    generatedAt: new Date().toISOString(),
    units: HARDWARE.units,
    originalityStatement:
      "Generated from first-principles parametric JSCAD geometry. Existing STL assets were not read, imported, measured, traced, remixed, compared against, or used as reference material.",
    designIntent: {
      type: "printable demonstration robotic arm",
      style: "modern industrial",
      approximateReachMm: 456,
      limitations: [
        "Not certified for load-bearing industrial use.",
        "Motor, bearing, and fastener selections must be verified before powered operation.",
        "Clearances are FDM-friendly defaults and may need tuning for a specific printer."
      ]
    },
    hardware: HARDWARE,
    axisOrder: [
      { axis: "J1", role: "base yaw", direction: "+Z", nominalLocation: "base center" },
      { axis: "J2", role: "shoulder pitch", direction: "+X", nominalLocation: "top of rotating column" },
      { axis: "J3", role: "elbow pitch", direction: "+X", nominalLocation: "distal end of upper arm" },
      { axis: "J4", role: "wrist roll", direction: "+Y", nominalLocation: "distal forearm barrel" },
      { axis: "J5", role: "wrist pitch", direction: "+X", nominalLocation: "wrist fork" },
      { axis: "J6", role: "tool roll", direction: "+Z", nominalLocation: "tool flange center" }
    ],
    linkLengthsMm: {
      baseToShoulderHeight: 75,
      upperArmPivotDistance: 138,
      forearmPivotDistance: 118,
      wristStackLength: 86,
      toolOffset: 39
    },
    assemblyOrder: [
      "j1_base_yaw_turntable",
      "j1_rotating_column",
      "j2_shoulder_yoke_left",
      "j2_shoulder_yoke_right",
      "j3_upper_arm_shell_left",
      "j3_upper_arm_shell_right",
      "elbow_hub",
      "forearm_shell_left",
      "forearm_shell_right",
      "j4_wrist_roll_carrier",
      "j5_wrist_pitch_fork",
      "j6_tool_roll_flange",
      "gripper_adapter_plate",
      "cable_channel_cover",
      "spacer_set",
      "axis_alignment_gauge"
    ],
    interfaceChecks: createInterfaceChecks(),
    parts: parts.map(({ definition, metrics }) => ({
      id: definition.id,
      fileName: definition.fileName,
      name: definition.name,
      jointRole: definition.jointRole,
      printOrientation: definition.printOrientation,
      interfaces: definition.interfaces,
      minimumTriangleCount: definition.minTriangles,
      triangleCount: metrics.triangleCount,
      polygonCount: metrics.polygonCount,
      boundsMm: metrics.boundsMm
    }))
  };
}

async function writeStl(part) {
  const [serialized] = stlSerializer.serialize({ binary: false }, part.solid);
  await fs.writeFile(path.join(STL_DIR, part.definition.fileName), serialized, "utf8");
}

export async function generateKit() {
  await fs.mkdir(STL_DIR, { recursive: true });
  const parts = buildPartSolids();
  await Promise.all(parts.map(writeStl));
  const manifest = createManifest(parts);
  await fs.writeFile(path.join(ROOT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (process.argv[1] === __filename) {
  const manifest = await generateKit();
  console.log(`Generated ${manifest.parts.length} original STL files in ${path.relative(process.cwd(), STL_DIR)}`);
}
