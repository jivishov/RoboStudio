import assert from "node:assert/strict";
import test from "node:test";
import { deleteActuator, evaluateActuators, upsertActuator } from "../../src/physics/actuators.js";
import { runDesignAudit } from "../../src/physics/audit.js";
import { checkCollisionProxies, collisionPairKey } from "../../src/physics/collision.js";
import { DynamicsRunner } from "../../src/physics/dynamics.js";
import { serializeRobotDesign, serializeUrdfLike } from "../../src/physics/exporters.js";
import { analyzeTopology, computeForwardKinematics, getEndEffectorPosition, getJointAngle, solveIKCCD } from "../../src/physics/kinematics.js";
import { baseStability, computeMassProperties, estimateJointLoads } from "../../src/physics/mass.js";
import { createRobotDesign, normalizeRobotDesign, validateRobotDesign } from "../../src/physics/model.js";

function twoLinkDesign() {
  return {
    version: 1,
    units: "mm",
    name: "Two link test",
    assumptions: { payloadKg: 0.1, safetyFactor: 2, targetSpeedDegS: 45 },
    links: [
      {
        id: "base",
        name: "Base",
        partIds: ["base"],
        massKg: 1,
        com: [0, 0, 0],
        inertia: [0, 0, 0],
        collisionProxies: [{ id: "base_box", type: "box", origin: [0, 0, 0], dimensions: [80, 40, 80], enabled: true }]
      },
      {
        id: "upper",
        name: "Upper",
        partIds: ["upper"],
        massKg: 0.4,
        com: [50, 0, 0],
        inertia: [0, 0, 0],
        collisionProxies: [{ id: "upper_box", type: "box", origin: [50, 0, 0], dimensions: [100, 20, 20], enabled: true }]
      },
      {
        id: "forearm",
        name: "Forearm",
        partIds: ["forearm"],
        massKg: 0.3,
        com: [50, 0, 0],
        inertia: [0, 0, 0],
        collisionProxies: [{ id: "forearm_box", type: "box", origin: [50, 0, 0], dimensions: [100, 20, 20], enabled: true }]
      }
    ],
    joints: [
      {
        id: "shoulder",
        name: "Shoulder",
        type: "revolute",
        parentLinkId: "base",
        childLinkId: "upper",
        origin: [0, 0, 0],
        axis: [0, 0, 1],
        min: -180,
        max: 180,
        damping: 0.1,
        friction: 0.05,
        actuatorId: "weak"
      },
      {
        id: "elbow",
        name: "Elbow",
        type: "revolute",
        parentLinkId: "upper",
        childLinkId: "forearm",
        origin: [100, 0, 0],
        axis: [0, 0, 1],
        min: -120,
        max: 120,
        damping: 0.1,
        friction: 0.05,
        actuatorId: "strong"
      }
    ],
    endEffectors: [{ id: "tool0", name: "Tool", linkId: "forearm", toolFrame: { position: [100, 0, 0], rotation: [0, 0, 0] } }],
    actuators: [
      { id: "weak", name: "Weak", continuousTorqueNm: 0.01, peakTorqueNm: 0.02, maxSpeedDegS: 20 },
      { id: "strong", name: "Strong", continuousTorqueNm: 20, peakTorqueNm: 30, maxSpeedDegS: 360 }
    ],
    allowedCollisions: ["base|upper", "forearm|upper"],
    pose: { jointAngles: { shoulder: 0, elbow: 0 } }
  };
}

function samplePartRecords() {
  return [
    "base",
    "waist",
    "lower_arm",
    "upper_arm",
    "wrist_yoke",
    "gripper_base",
    "inferred_wrist_axle",
    "inferred_gripper_mount_axle"
  ].map((id, index) => ({
    id,
    name: id,
    bounds: {
      min: [index * 20, 0, 0],
      max: [index * 20 + 10, 10, 10],
      size: [10, 10, 10],
      center: [index * 20 + 5, 5, 5]
    }
  }));
}

test("validates a complete robot design", () => {
  assert.deepEqual(validateRobotDesign(twoLinkDesign()), []);
});

test("computes forward kinematics and clamps joint angles", () => {
  const design = twoLinkDesign();
  design.pose.jointAngles.elbow = 999;
  assert.equal(getJointAngle(design, "elbow"), 120);

  design.pose.jointAngles.elbow = 0;
  const transforms = computeForwardKinematics(design);
  const tool = getEndEffectorPosition(design, "tool0", transforms);
  assert.equal(Math.round(tool.x), 200);
  assert.equal(Math.round(tool.y), 0);
});

test("solves reachable IK targets and reports unreachable targets", () => {
  const design = twoLinkDesign();
  const solved = solveIKCCD(design, "tool0", [0, 200, 0], { toleranceMm: 5, maxIterations: 120 });
  assert.equal(solved.ok, true);
  assert.ok(solved.errorMm <= 5);
  assert.deepEqual(solved.chain, ["shoulder", "elbow"]);
  assert.deepEqual(solved.clampedJoints, []);
  assert.deepEqual(solved.targetPosition, [0, 200, 0]);
  assert.equal(solved.currentPosition.length, 3);

  const unreachable = solveIKCCD(design, "tool0", [800, 0, 0], { toleranceMm: 5, maxIterations: 40 });
  assert.equal(unreachable.ok, false);
});

test("reports clamped joints during constrained IK", () => {
  const design = twoLinkDesign();
  design.joints[0].max = 15;
  const result = solveIKCCD(design, "tool0", [0, 200, 0], { toleranceMm: 5, maxIterations: 80 });

  assert.equal(result.ok, false);
  assert.ok(result.clampedJoints.includes("shoulder"));
});

test("detects proxy collisions outside allowed pairs", () => {
  const design = twoLinkDesign();
  design.allowedCollisions = [];
  const collisions = checkCollisionProxies(design, computeForwardKinematics(design));
  assert.ok(collisions.some((item) => item.linkA === "base" && item.linkB === "upper"));

  design.allowedCollisions = [collisionPairKey("base", "upper")];
  const allowed = checkCollisionProxies(design, computeForwardKinematics(design));
  assert.equal(allowed.some((item) => collisionPairKey(item.linkA, item.linkB) === "base|upper"), false);
});

test("aggregates mass and evaluates actuator margins", () => {
  const design = twoLinkDesign();
  const transforms = computeForwardKinematics(design);
  const mass = computeMassProperties(design, transforms, 0.2);
  assert.equal(mass.totalMassKg, 1.9);

  const loads = estimateJointLoads(design, transforms, design.assumptions);
  assert.equal(loads.length, 2);
  assert.ok(loads.find((item) => item.jointId === "shoulder").recommendedTorqueNm > loads.find((item) => item.jointId === "shoulder").staticTorqueNm);
  const actuatorResults = evaluateActuators(design, loads);
  assert.equal(actuatorResults.find((item) => item.jointId === "shoulder").state, "risk");
});

test("manages actuator CRUD and clears deleted joint assignments", () => {
  const design = twoLinkDesign();
  const actuator = upsertActuator(design, {
    id: "custom",
    name: "Custom drive",
    continuousTorqueNm: "3.5",
    peakTorqueNm: "6",
    maxSpeedDegS: "90",
    voltage: "24",
    massKg: "0.22",
    gearRatio: "12",
    efficiency: "1.2",
    notes: "Bench candidate"
  });

  assert.equal(actuator.efficiency, 1);
  assert.equal(actuator.gearRatio, 12);
  assert.equal(design.actuators.some((item) => item.id === "custom"), true);

  const updated = upsertActuator(design, { ...actuator, continuousTorqueNm: 4 });
  assert.equal(updated.continuousTorqueNm, 4);
  assert.equal(design.actuators.filter((item) => item.id === "custom").length, 1);

  design.joints[0].actuatorId = "custom";
  assert.equal(deleteActuator(design, "custom"), true);
  assert.equal(design.joints[0].actuatorId, null);
  assert.equal(deleteActuator(design, "missing"), false);
});

test("warns when actuator speed margin is below the target speed", () => {
  const design = twoLinkDesign();
  design.assumptions.targetSpeedDegS = 240;
  design.joints[0].actuatorId = "slow";
  design.actuators.push({
    id: "slow",
    name: "Slow high torque",
    continuousTorqueNm: 100,
    peakTorqueNm: 150,
    maxSpeedDegS: 60,
    voltage: 24,
    massKg: 1,
    gearRatio: 80,
    efficiency: 0.75,
    notes: ""
  });

  const loads = estimateJointLoads(design, computeForwardKinematics(design), design.assumptions);
  const result = evaluateActuators(design, loads).find((item) => item.jointId === "shoulder");

  assert.equal(result.state, "warn");
  assert.equal(result.speedMargin, 0.25);
  assert.equal(result.targetSpeedDegS, 240);
});

test("computes COM aggregation and base stability margin", () => {
  const design = twoLinkDesign();
  const transforms = computeForwardKinematics(design);
  const mass = computeMassProperties(design, transforms, 0);
  assert.equal(mass.totalMassKg, 1.7);
  assert.deepEqual(mass.centerOfMass, [38.24, 0, 0]);

  const stable = baseStability(design, mass);
  assert.equal(stable.ok, true);
  assert.equal(stable.marginMm, 1.8);
  assert.deepEqual(stable.baseProjectionMm, [38.2, 0]);

  design.links[0].collisionProxies[0].dimensions = [20, 40, 20];
  const unstable = baseStability(design, mass);
  assert.equal(unstable.ok, false);
  assert.ok(unstable.marginMm < 0);
});

test("creates a valid sample model with wrist roll", () => {
  const design = createRobotDesign(samplePartRecords(), { sample: true });
  const wristRoll = design.joints.find((joint) => joint.id === "wrist_roll");

  assert.ok(wristRoll);
  assert.equal(wristRoll.parentLinkId, "wrist");
  assert.equal(wristRoll.childLinkId, "hand_mount");
  assert.deepEqual(design.pose.jointAngles.wrist_roll, 0);
  assert.deepEqual(design.links.find((link) => link.id === "wrist")?.partIds, ["inferred_wrist_axle"]);
  assert.deepEqual(design.links.find((link) => link.id === "hand_mount")?.partIds, [
    "wrist_yoke",
    "inferred_gripper_mount_axle"
  ]);
  assert.deepEqual(validateRobotDesign(design), []);
});

test("normalizes proxy shapes and unique part assignments", () => {
  const partRecords = [
    { id: "base", name: "Base", bounds: { min: [0, 0, 0], max: [20, 20, 20], size: [20, 20, 20], center: [10, 10, 10] } },
    { id: "tool", name: "Tool", bounds: { min: [20, 0, 0], max: [50, 10, 10], size: [30, 10, 10], center: [35, 5, 5] } }
  ];
  const normalized = normalizeRobotDesign(
    {
      ...twoLinkDesign(),
      links: [
        {
          id: "base",
          name: "Base",
          partIds: ["base"],
          massKg: 1,
          com: [0, 0, 0],
          inertia: [0, 0, 0],
          collisionProxies: [{ id: "proxy", type: "sphere", origin: ["1", "bad", 3], dimensions: [12, 99, 88], enabled: true }]
        },
        {
          id: "tool_link",
          name: "Tool link",
          partIds: ["base", "tool"],
          massKg: 1,
          com: [0, 0, 0],
          inertia: [0, 0, 0],
          collisionProxies: [{ id: "proxy", type: "cylinder", origin: [0, 0, 0], dimensions: [5, 40, 9], enabled: true }]
        }
      ],
      joints: [
        { id: "bad", name: "Bad", type: "revolute", parentLinkId: "base", childLinkId: "base", origin: [0, 0, 0], axis: [0, 0, 1], min: -90, max: 90 },
        { id: "ok", name: "Ok", type: "fixed", parentLinkId: "base", childLinkId: "tool_link", origin: [0, 0, 0], axis: [0, 0, 1], min: 0, max: 0 }
      ]
    },
    partRecords
  );

  assert.deepEqual(normalized.links[0].partIds, ["base"]);
  assert.deepEqual(normalized.links[1].partIds, ["tool"]);
  assert.deepEqual(normalized.links[0].collisionProxies[0].origin, [1, 0, 3]);
  assert.deepEqual(normalized.links[0].collisionProxies[0].dimensions, [12, 12, 12]);
  assert.deepEqual(normalized.links[1].collisionProxies[0].dimensions, [5, 40, 5]);
  assert.deepEqual(normalized.joints.map((joint) => joint.id), ["ok"]);
});

test("flags duplicate part assignment and self-parent joints", () => {
  const design = twoLinkDesign();
  design.links[1].partIds.push("base");
  design.joints[0].childLinkId = "base";
  const codes = validateRobotDesign(design).map((issue) => issue.code);

  assert.ok(codes.includes("duplicate-part-assignment"));
  assert.ok(codes.includes("self-parent-joint"));
});

test("normalizes duplicate ids and filters stale pose angles", () => {
  const design = twoLinkDesign();
  design.joints = [
    { ...design.joints[0], id: "joint" },
    { ...design.joints[1], id: "joint" }
  ];
  design.endEffectors = [
    { ...design.endEffectors[0], id: "tool" },
    { ...design.endEffectors[0], id: "tool" }
  ];
  design.actuators = [
    { ...design.actuators[0], id: "actuator" },
    { ...design.actuators[1], id: "actuator" }
  ];
  design.pose.jointAngles = { joint: 42, stale: 99 };

  const normalized = normalizeRobotDesign(design);

  assert.deepEqual(normalized.joints.map((joint) => joint.id), ["joint", "joint_2"]);
  assert.deepEqual(normalized.endEffectors.map((effector) => effector.id), ["tool", "tool_2"]);
  assert.deepEqual(normalized.actuators.map((actuator) => actuator.id), ["actuator", "actuator_2"]);
  assert.deepEqual(normalized.pose.jointAngles, { joint: 42, joint_2: 0 });
});

test("normalizes full persisted RobotDesign fields", () => {
  const design = twoLinkDesign();
  design.assumptions = { payloadKg: "0.4", safetyFactor: "2.5", targetSpeedDegS: "120" };
  design.allowedCollisions = ["upper|base", "base|upper", "missing|base"];
  design.actuators = [
    {
      id: "Drive A",
      name: "Drive",
      continuousTorqueNm: "5",
      peakTorqueNm: "8",
      maxSpeedDegS: "180",
      voltage: "24",
      massKg: "0.4",
      gearRatio: "20",
      efficiency: "0.82",
      notes: "Persist me"
    },
    {
      id: "Drive A",
      name: "Duplicate drive",
      continuousTorqueNm: "6",
      peakTorqueNm: "9",
      maxSpeedDegS: "160",
      voltage: "24",
      massKg: "0.42",
      gearRatio: "25",
      efficiency: "0.8",
      notes: "Duplicate id should not steal the joint assignment"
    }
  ];
  design.joints[0].actuatorId = "Drive A";
  design.pose.jointAngles = { shoulder: "12.5", elbow: "-8", stale: 99 };

  const normalized = normalizeRobotDesign(JSON.parse(serializeRobotDesign(design)));

  assert.equal(normalized.exportedAt, undefined);
  assert.deepEqual(normalized.assumptions, { payloadKg: 0.4, safetyFactor: 2.5, targetSpeedDegS: 120 });
  assert.deepEqual(normalized.allowedCollisions, ["base|upper"]);
  assert.equal(normalized.links[0].collisionProxies[0].id, "base_box");
  assert.equal(normalized.endEffectors[0].toolFrame.position[0], 100);
  assert.equal(normalized.actuators[0].gearRatio, 20);
  assert.equal(normalized.actuators[0].id, "drive_a");
  assert.equal(normalized.actuators[1].id, "drive_a_2");
  assert.equal(normalized.joints[0].actuatorId, "drive_a");
  assert.deepEqual(normalized.pose.jointAngles, { shoulder: 12.5, elbow: -8 });
});

test("detects multiple-parent links and closed-loop topology", () => {
  const multipleParent = twoLinkDesign();
  multipleParent.joints.push({
    id: "parallel_parent",
    name: "Parallel parent",
    type: "revolute",
    parentLinkId: "base",
    childLinkId: "forearm",
    origin: [0, 0, 0],
    axis: [0, 0, 1],
    min: -90,
    max: 90,
    damping: 0.1,
    friction: 0.05,
    actuatorId: "strong"
  });
  const parentTopology = analyzeTopology(multipleParent);
  assert.equal(parentTopology.unsupportedClosedLoop, true);
  assert.deepEqual(parentTopology.multipleParents[0].linkId, "forearm");
  assert.ok(validateRobotDesign(multipleParent).some((issue) => issue.code === "multiple-parent-link"));

  const closedLoop = twoLinkDesign();
  closedLoop.joints.push({
    id: "return",
    name: "Return",
    type: "revolute",
    parentLinkId: "forearm",
    childLinkId: "base",
    origin: [0, 0, 0],
    axis: [0, 0, 1],
    min: -90,
    max: 90,
    damping: 0.1,
    friction: 0.05,
    actuatorId: "strong"
  });
  const loopTopology = analyzeTopology(closedLoop);
  assert.equal(loopTopology.unsupportedClosedLoop, true);
  assert.ok(loopTopology.cycles.some((cycle) => cycle.includes("base") && cycle.includes("forearm")));
  assert.ok(validateRobotDesign(closedLoop).some((issue) => issue.code === "closed-loop-topology"));
});

test("groups audit findings and gives actions for risks", () => {
  const design = twoLinkDesign();
  design.allowedCollisions = [];
  design.links[1].massKg = 0;
  const transforms = computeForwardKinematics(design);
  const audit = runDesignAudit(design, {
    collisions: checkCollisionProxies(design, transforms),
    actuatorResults: evaluateActuators(design, estimateJointLoads(design, transforms, design.assumptions)),
    stability: baseStability(design, computeMassProperties(design, transforms, 0))
  });

  assert.ok(audit.some((item) => item.category === "Collision" && item.code === "collision"));
  assert.ok(audit.some((item) => item.category === "Mass/COM" && item.code === "missing-mass"));
  assert.ok(audit.some((item) => item.category === "Simulation" && item.code === "simulation-proxies"));
  for (const item of audit.filter((entry) => entry.level === "warn" || entry.level === "risk")) {
    assert.ok(item.action.length > 12);
  }
});

test("exports RobotDesign JSON and URDF-style structure", () => {
  const design = twoLinkDesign();
  const partRecords = [
    { id: "base", name: "Base mesh", file: "Base.STL" },
    { id: "upper", name: "Upper mesh", file: "Upper.STL" },
    { id: "forearm", name: "Forearm mesh", file: "Forearm.STL" }
  ];

  const parsed = JSON.parse(serializeRobotDesign(design));
  assert.equal(parsed.links.length, design.links.length);
  assert.equal(parsed.joints.length, design.joints.length);
  assert.equal(parsed.exportedAt.length > 0, true);

  const urdf = serializeUrdfLike(design, partRecords);
  assert.match(urdf, /<robot name="Two link test">/);
  assert.match(urdf, /<link name="base">/);
  assert.match(urdf, /<inertial>/);
  assert.match(urdf, /<visual name="base">/);
  assert.match(urdf, /filename="Base.STL"/);
  assert.match(urdf, /<collision name="base_box">/);
  assert.match(urdf, /<joint name="shoulder" type="revolute">/);
  assert.match(urdf, /<limit lower="-3.141593" upper="3.141593" effort="0.02" velocity="0.349066" \/>/);
});

test("reports uninitialized simulation status without loading Rapier", () => {
  const runner = new DynamicsRunner();
  const status = runner.status();

  assert.equal(status.ready, false);
  assert.equal(status.steps, 0);
  assert.equal(status.bodies, 0);
  assert.equal(status.joints, 0);
  assert.equal(status.gravityEnabled, true);
});
