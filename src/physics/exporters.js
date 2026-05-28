import { MM_TO_M } from "./constants.js";
import { analyzeTopology } from "./kinematics.js";

const EPSILON = 1e-9;
const URDF_MESH_SCALE = "0.001 0.001 0.001";
const URDF_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const CAPSULE_APPROXIMATION = "capsule-as-cylinder";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xyz(values) {
  return (values ?? [0, 0, 0]).map((value) => Number(value || 0).toFixed(5)).join(" ");
}

function xmlNumber(value, digits = 6) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  return numeric.toFixed(digits).replace(/\.?0+$/, "") || "0";
}

export function serializeRobotDesign(design) {
  return JSON.stringify(
    {
      ...design,
      exportedAt: new Date().toISOString()
    },
    null,
    2
  );
}

function radians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

function meters(valueMm) {
  return Number(valueMm || 0) * MM_TO_M;
}

function metersVector(values) {
  return (values ?? [0, 0, 0]).map(meters);
}

function rpyFromDegrees(values) {
  return (values ?? [0, 0, 0]).map(radians);
}

function vectorLength(values) {
  return Math.hypot(...(values ?? [0, 0, 0]).map((value) => Number(value) || 0));
}

function normalizedAxis(values) {
  const length = vectorLength(values);
  if (length <= EPSILON) return [0, 0, 1];
  return (values ?? [0, 0, 1]).map((value) => Number(value || 0) / length);
}

function isFiniteVector(values, length = 3) {
  return Array.isArray(values) && values.length === length && values.every((value) => Number.isFinite(Number(value)));
}

function isPositiveMass(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isUsableInertia(inertia) {
  return (
    isFiniteVector(inertia) &&
    inertia.every((value) => Number(value) >= 0) &&
    inertia.some((value) => Number(value) > 0)
  );
}

function hasPortableName(value) {
  return URDF_NAME_PATTERN.test(String(value ?? ""));
}

function baseFileName(fileName) {
  const value = String(fileName ?? "").replace(/\\/g, "/").trim();
  return value.split("/").filter(Boolean).at(-1) ?? "";
}

function hasPathSegments(fileName) {
  return /[\\/:]/.test(String(fileName ?? ""));
}

function issue(level, code, message, action) {
  return { level, code, category: "Export", message, action };
}

function collectDuplicateNames(items, label, issues) {
  const seen = new Set();
  for (const item of items) {
    const name = item?.id ?? item?.name;
    if (!hasPortableName(name)) {
      issues.push(issue(
        "risk",
        "urdf-invalid-name",
        `${label} "${name ?? ""}" is not a portable URDF name.`,
        "Use letters, numbers, underscores, periods, or hyphens; start names with a letter or underscore."
      ));
    }
    if (seen.has(name)) {
      issues.push(issue(
        "risk",
        "urdf-duplicate-name",
        `${label} "${name}" is duplicated.`,
        "Rename duplicated links, joints, tools, or generated frame names before exporting URDF."
      ));
    }
    seen.add(name);
  }
}

function partForId(partRecords, partId) {
  return partRecords.find((part) => part.id === partId) ?? null;
}

export function preflightUrdfExport(design, partRecords = []) {
  const issues = [];
  if (!design || !Array.isArray(design.links) || !design.links.length) {
    return [
      issue(
        "risk",
        "urdf-empty-design",
        "URDF export needs at least one robot link.",
        "Create or import a RobotDesign with at least one link before exporting."
      )
    ];
  }

  if (!hasPortableName(design.name ?? "robot")) {
    issues.push(issue(
      "warn",
      "urdf-robot-name",
      "Robot name contains characters some URDF tools reject.",
      "Use a simple robot name with letters, numbers, underscores, periods, or hyphens."
    ));
  }

  collectDuplicateNames(design.links, "Link", issues);
  collectDuplicateNames(design.joints ?? [], "Joint", issues);

  const reservedLinkNames = new Set(design.links.map((link) => link.id));
  const reservedJointNames = new Set((design.joints ?? []).map((joint) => joint.id));
  const toolFrameNames = new Set();
  for (const effector of design.endEffectors ?? []) {
    const toolLinkName = `${effector.id}_link`;
    const toolJointName = `${effector.id}_fixed_joint`;
    if (
      toolFrameNames.has(toolLinkName) ||
      toolFrameNames.has(toolJointName) ||
      reservedLinkNames.has(toolLinkName) ||
      reservedJointNames.has(toolJointName)
    ) {
      issues.push(issue(
        "risk",
        "urdf-duplicate-tool-frame",
        `Tool frame "${effector.id}" produces duplicate URDF frame names.`,
        "Rename duplicate end effectors before exporting."
      ));
    }
    toolFrameNames.add(toolLinkName);
    toolFrameNames.add(toolJointName);
    if (!hasPortableName(toolLinkName) || !hasPortableName(toolJointName)) {
      issues.push(issue(
        "risk",
        "urdf-invalid-tool-frame",
        `Tool frame "${effector.id}" is not portable as a URDF link or joint name.`,
        "Rename the end effector with a simple id before exporting."
      ));
    }
  }

  const linkIds = new Set(design.links.map((link) => link.id));
  for (const link of design.links) {
    if (!isPositiveMass(link.massKg)) {
      issues.push(issue(
        "risk",
        "urdf-invalid-mass",
        `${link.name ?? link.id} needs a positive mass for URDF inertial export.`,
        "Enter or estimate a positive mass for this link."
      ));
    }
    if (!isUsableInertia(link.inertia)) {
      issues.push(issue(
        "risk",
        "urdf-invalid-inertia",
        `${link.name ?? link.id} needs non-zero finite inertia values for credible URDF export.`,
        "Estimate mass properties from link bounds or enter realistic inertia values."
      ));
    }

    const visualParts = (link.partIds ?? []).map((partId) => partForId(partRecords, partId)).filter(Boolean);
    if (!visualParts.length) {
      issues.push(issue(
        "warn",
        "urdf-missing-visual",
        `${link.name ?? link.id} has no visual parts for URDF visual geometry.`,
        "Assign at least one visual part or accept a collision-only URDF link."
      ));
    }
    for (const partId of link.partIds ?? []) {
      const part = partForId(partRecords, partId);
      if (!part?.file) {
        issues.push(issue(
          "warn",
          "urdf-missing-visual-mesh",
          `${partId} does not have an STL filename for URDF visual export.`,
          "Retain or regenerate mesh assets before expecting portable visual import in external tools."
        ));
      } else if (hasPathSegments(part.file)) {
        issues.push(issue(
          "warn",
          "urdf-nonportable-mesh-path",
          `${partId} uses a mesh path; URDF export will keep only the basename.`,
          "Use portable mesh filenames or wait for package export to bundle assets."
        ));
      }
    }

    const enabledProxies = (link.collisionProxies ?? []).filter((proxy) => proxy.enabled !== false);
    if (!enabledProxies.length) {
      issues.push(issue(
        "warn",
        "urdf-missing-collision",
        `${link.name ?? link.id} has no enabled collision proxy for URDF collision geometry.`,
        "Add or enable a simplified collision proxy for this link."
      ));
    }
    for (const proxy of enabledProxies) {
      if (!isFiniteVector(proxy.origin) || !isFiniteVector(proxy.dimensions) || proxy.dimensions.some((value) => Number(value) <= 0)) {
        issues.push(issue(
          "risk",
          "urdf-invalid-collision",
          `${proxy.id} has invalid collision origin or dimensions.`,
          "Reset or edit the collision proxy before exporting."
        ));
      }
      if (proxy.type === "capsule") {
        issues.push(issue(
          "warn",
          "urdf-capsule-approximation",
          `${proxy.id} is a capsule; URDF will export it as a cylinder approximation.`,
          "Use a sphere, box, or cylinder proxy when exact URDF primitive matching matters."
        ));
      }
    }
  }

  for (const joint of design.joints ?? []) {
    if (!linkIds.has(joint.parentLinkId) || !linkIds.has(joint.childLinkId)) {
      issues.push(issue(
        "risk",
        "urdf-bad-joint-link",
        `${joint.name ?? joint.id} references a missing parent or child link.`,
        "Choose existing parent and child links for every joint."
      ));
    }
    if (joint.parentLinkId === joint.childLinkId) {
      issues.push(issue(
        "risk",
        "urdf-self-joint",
        `${joint.name ?? joint.id} cannot connect a link to itself in URDF.`,
        "Choose different parent and child links."
      ));
    }
    if (joint.type !== "fixed" && vectorLength(joint.axis) <= EPSILON) {
      issues.push(issue(
        "risk",
        "urdf-zero-axis",
        `${joint.name ?? joint.id} has a zero-length joint axis.`,
        "Set a non-zero axis vector for movable joints."
      ));
    }
    if (joint.type !== "fixed" && !(Number.isFinite(joint.min) && Number.isFinite(joint.max) && joint.min < joint.max)) {
      issues.push(issue(
        "risk",
        "urdf-bad-limits",
        `${joint.name ?? joint.id} needs finite min/max limits for URDF export.`,
        "Set valid lower and upper limits before exporting."
      ));
    }
    if (joint.type !== "fixed" && !joint.actuatorId) {
      issues.push(issue(
        "warn",
        "urdf-missing-actuator-limit",
        `${joint.name ?? joint.id} has no actuator, so effort and velocity limits export as zero.`,
        "Assign an actuator if downstream tools need meaningful effort and velocity limits."
      ));
    }
  }

  const topology = analyzeTopology(design);
  for (const item of topology.multipleParents) {
    issues.push(issue(
      "risk",
      "urdf-multiple-parent-link",
      `${item.linkId} has multiple parent joints (${item.jointIds.join(", ")}).`,
      "URDF requires a tree; remove extra parent joints or split the model."
    ));
  }
  for (const cycle of topology.cycles) {
    issues.push(issue(
      "risk",
      "urdf-closed-loop-topology",
      `Closed-loop topology detected (${cycle.join(" -> ")}).`,
      "URDF export requires an open tree; break the closed loop before exporting."
    ));
  }
  if (topology.roots.length > 1) {
    issues.push(issue(
      "risk",
      "urdf-multiple-roots",
      `URDF export found ${topology.roots.length} root links (${topology.roots.join(", ")}).`,
      "Connect the robot into one rooted tree before exporting URDF."
    ));
  }

  return issues;
}

function collisionGeometry(proxy) {
  const dimensions = proxy.dimensions ?? [10, 10, 10];
  if (proxy.type === "sphere") return `<sphere radius="${xmlNumber(meters(dimensions[0]))}" />`;
  if (proxy.type === "capsule") {
    return `<cylinder radius="${xmlNumber(meters(dimensions[0]))}" length="${xmlNumber(meters(dimensions[1]))}" />`;
  }
  if (proxy.type === "cylinder") {
    return `<cylinder radius="${xmlNumber(meters(dimensions[0]))}" length="${xmlNumber(meters(dimensions[1]))}" />`;
  }
  return `<box size="${xyz(dimensions.map(meters))}" />`;
}

function meshReference(part) {
  const fileName = baseFileName(part?.file);
  return fileName ? fileName : null;
}

export function buildUrdfModel(design, partRecords = []) {
  const partMap = new Map(partRecords.map((part) => [part.id, part]));
  const actuators = new Map((design.actuators ?? []).map((actuator) => [actuator.id, actuator]));
  const links = design.links.map((link) => ({
    name: link.id,
    inertial: {
      origin: metersVector(link.com),
      massKg: Number(link.massKg) || 0,
      inertia: link.inertia ?? [0, 0, 0]
    },
    visuals: (link.partIds ?? [])
      .map((partId) => {
        const part = partMap.get(partId);
        const filename = meshReference(part);
        if (!filename) return null;
        return {
          name: partId,
          origin: [0, 0, 0],
          rpy: [0, 0, 0],
          filename,
          scale: URDF_MESH_SCALE
        };
      })
      .filter(Boolean),
    collisions: (link.collisionProxies ?? [])
      .filter((proxy) => proxy.enabled !== false)
      .map((proxy) => ({
        name: proxy.id,
        origin: metersVector(proxy.origin),
        rpy: [0, 0, 0],
        geometry: collisionGeometry(proxy),
        approximation: proxy.type === "capsule" ? CAPSULE_APPROXIMATION : null
      }))
  }));

  const joints = (design.joints ?? []).map((joint) => {
      const type = joint.type === "fixed" ? "fixed" : joint.type === "prismatic" ? "prismatic" : "revolute";
      const actuator = actuators.get(joint.actuatorId);
      const lower = type === "revolute" ? radians(joint.min) : meters(joint.min);
      const upper = type === "revolute" ? radians(joint.max) : meters(joint.max);
      const velocity = type === "revolute" ? radians(actuator?.maxSpeedDegS ?? 0) : meters(actuator?.maxSpeedDegS ?? 0);
      const effort = actuator?.peakTorqueNm ?? actuator?.continuousTorqueNm ?? 0;
      return {
        name: joint.id,
        type,
        parent: joint.parentLinkId,
        child: joint.childLinkId,
        origin: metersVector(joint.origin),
        rpy: [0, 0, 0],
        axis: normalizedAxis(joint.axis),
        limit: type === "fixed" ? null : { lower, upper, effort, velocity },
        dynamics: type === "fixed"
          ? null
          : {
              damping: Number(joint.damping) || 0,
              friction: Number(joint.friction) || 0
            }
      };
    });

  for (const effector of design.endEffectors ?? []) {
    links.push({
      name: `${effector.id}_link`,
      inertial: null,
      visuals: [],
      collisions: []
    });
    joints.push({
      name: `${effector.id}_fixed_joint`,
      type: "fixed",
      parent: effector.linkId,
      child: `${effector.id}_link`,
      origin: metersVector(effector.toolFrame?.position),
      rpy: rpyFromDegrees(effector.toolFrame?.rotation),
      axis: null,
      limit: null,
      dynamics: null
    });
  }

  return {
    robotName: design.name ?? "robot",
    links,
    joints,
    limitations: [
      "Visual mesh references use existing STL filenames and meter scale; portable ZIP/ROS package export is not available yet.",
      "Collision geometry uses simplified proxies instead of raw STL mesh physics.",
      "Capsule collision proxies export as cylinder approximations because URDF has no capsule primitive."
    ]
  };
}

function visualXml(visual) {
  return `    <visual name="${escapeXml(visual.name)}">\n      <origin xyz="${xyz(visual.origin)}" rpy="${xyz(visual.rpy)}" />\n      <geometry><mesh filename="${escapeXml(visual.filename)}" scale="${visual.scale}" /></geometry>\n    </visual>`;
}

function collisionXml(collision) {
  const approximation = collision.approximation
    ? `\n      <!-- approximation: ${escapeXml(collision.approximation)} -->`
    : "";
  return `    <collision name="${escapeXml(collision.name)}">\n      <origin xyz="${xyz(collision.origin)}" rpy="${xyz(collision.rpy)}" />\n      <geometry>${collision.geometry}</geometry>${approximation}\n    </collision>`;
}

function linkXml(link) {
  const inertial = link.inertial
    ? `    <inertial>\n      <origin xyz="${xyz(link.inertial.origin)}" rpy="0 0 0" />\n      <mass value="${xmlNumber(link.inertial.massKg)}" />\n      <inertia ixx="${xmlNumber(link.inertial.inertia?.[0])}" ixy="0" ixz="0" iyy="${xmlNumber(link.inertial.inertia?.[1])}" iyz="0" izz="${xmlNumber(link.inertial.inertia?.[2])}" />\n    </inertial>`
    : "";
  return `  <link name="${escapeXml(link.name)}">\n${[inertial, ...link.visuals.map(visualXml), ...link.collisions.map(collisionXml)].filter(Boolean).join("\n")}\n  </link>`;
}

function jointXml(joint) {
  const axis = joint.axis ? `\n    <axis xyz="${xyz(joint.axis)}" />` : "";
  const limit = joint.limit
    ? `\n    <limit lower="${xmlNumber(joint.limit.lower)}" upper="${xmlNumber(joint.limit.upper)}" effort="${xmlNumber(joint.limit.effort)}" velocity="${xmlNumber(joint.limit.velocity)}" />`
    : "";
  const dynamics = joint.dynamics && (joint.dynamics.damping > 0 || joint.dynamics.friction > 0)
    ? `\n    <dynamics damping="${xmlNumber(joint.dynamics.damping)}" friction="${xmlNumber(joint.dynamics.friction)}" />`
    : "";
  return `  <joint name="${escapeXml(joint.name)}" type="${joint.type}">\n    <parent link="${escapeXml(joint.parent)}" />\n    <child link="${escapeXml(joint.child)}" />\n    <origin xyz="${xyz(joint.origin)}" rpy="${xyz(joint.rpy)}" />${axis}${limit}${dynamics}\n  </joint>`;
}

export function serializeUrdf(design, partRecords = []) {
  const model = buildUrdfModel(design, partRecords);
  const limitations = model.limitations
    .map((limitation) => `  <!-- ${escapeXml(limitation)} -->`)
    .join("\n");
  const links = model.links.map(linkXml).join("\n");
  const joints = model.joints.map(jointXml).join("\n");
  return `<?xml version="1.0"?>\n<robot name="${escapeXml(model.robotName)}">\n${limitations}\n${links}\n${joints}\n</robot>\n`;
}

export function createUrdfExport(design, partRecords = []) {
  const issues = preflightUrdfExport(design, partRecords);
  const risks = issues.filter((item) => item.level === "risk");
  const model = design?.links?.length
    ? buildUrdfModel(design, partRecords)
    : {
        robotName: design?.name ?? "robot",
        links: [],
        joints: [],
        limitations: [
          "Visual mesh references use existing STL filenames and meter scale; portable ZIP/ROS package export is not available yet.",
          "Collision geometry uses simplified proxies instead of raw STL mesh physics.",
          "Capsule collision proxies export as cylinder approximations because URDF has no capsule primitive."
        ]
      };
  return {
    ready: risks.length === 0,
    issues,
    model,
    xml: risks.length === 0 ? serializeUrdf(design, partRecords) : null
  };
}

export function serializeUrdfLike(design, partRecords = []) {
  return serializeUrdf(design, partRecords);
}
