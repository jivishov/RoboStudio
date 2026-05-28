import { validateRobotDesign } from "./model.js";
import { preflightUrdfExport } from "./exporters.js";

const CATEGORY_ORDER = ["Model", "Kinematics", "Collision", "Mass/COM", "Actuators", "Simulation", "Export"];

const CATEGORY_BY_CODE = {
  "empty-link": "Model",
  "duplicate-part-assignment": "Model",
  "bad-joint-link": "Kinematics",
  "self-parent-joint": "Kinematics",
  "multiple-parent-link": "Kinematics",
  "closed-loop-topology": "Kinematics",
  "bad-limits": "Kinematics",
  "missing-tool": "Kinematics",
  "missing-mass": "Mass/COM",
  "missing-proxy": "Collision",
  "missing-actuator": "Actuators",
  ik: "Kinematics",
  collision: "Collision",
  actuator: "Actuators",
  stability: "Mass/COM",
  "simulation-proxies": "Simulation",
  "urdf-ready": "Export",
  ready: "Model"
};

const ACTION_BY_CODE = {
  "empty-link": "Assign at least one visual part to this link or remove the link.",
  "duplicate-part-assignment": "Move the duplicated part to exactly one link.",
  "bad-joint-link": "Select existing parent and child links for the joint.",
  "self-parent-joint": "Choose different parent and child links.",
  "multiple-parent-link": "Remove the extra parent joint or split the model into an open chain.",
  "closed-loop-topology": "Break the cycle; closed-loop solving is unsupported in V1.",
  "bad-limits": "Set finite min/max limits where min is lower than max.",
  "missing-tool": "Add an end effector on the terminal link.",
  "missing-mass": "Enter a positive mass or estimate mass from link bounds.",
  "missing-proxy": "Add or enable a collision proxy for this link.",
  "missing-actuator": "Assign an actuator to this movable joint.",
  ik: "Adjust the target, joint limits, or chain topology and solve again.",
  collision: "Edit proxy dimensions/origins or allow the pair if the adjacency is intentional.",
  actuator: "Assign a stronger actuator or reduce payload/speed assumptions.",
  stability: "Move mass inward, reduce payload, or enlarge the root box proxy.",
  "simulation-proxies": "Enable at least one collision proxy before initializing simulation.",
  "urdf-ready": "Download the URDF when the export warnings are acceptable.",
  ready: "No action needed."
};

export { CATEGORY_ORDER };

function enrichAuditItem(item) {
  const category = item.category ?? CATEGORY_BY_CODE[item.code] ?? "Model";
  const action = item.action ?? ACTION_BY_CODE[item.code] ?? "Review and correct this item in the model editor.";
  return {
    ...item,
    category,
    action
  };
}

export function runDesignAudit(design, analysis = {}) {
  const items = validateRobotDesign(design).map(enrichAuditItem);

  if (analysis.ikResult) {
    items.push(enrichAuditItem({
      level: analysis.ikResult.ok ? "ok" : "warn",
      code: "ik",
      message: analysis.ikResult.ok
        ? `IK solved in ${analysis.ikResult.iterations} iterations with ${analysis.ikResult.errorMm.toFixed(2)} mm error.`
        : `IK target not solved: ${analysis.ikResult.reason}`
    }));
  }

  for (const collision of analysis.collisions ?? []) {
    const pairKey = [collision.linkA, collision.linkB].sort().join("|");
    items.push(enrichAuditItem({
      level: "risk",
      code: "collision",
      message: `${collision.linkA} collides with ${collision.linkB} (${collision.overlapMm} mm overlap).`,
      action: `Allow ${pairKey} if intentional, otherwise resize or move ${collision.proxyA} / ${collision.proxyB}.`
    }));
  }

  for (const actuator of analysis.actuatorResults ?? []) {
    if (actuator.state === "ok") continue;
    items.push(enrichAuditItem({
      level: actuator.state,
      code: "actuator",
      message: `${actuator.jointName}: ${actuator.message}`
    }));
  }

  if (analysis.stability) {
    items.push(enrichAuditItem({
      level: analysis.stability.ok ? "ok" : "warn",
      code: "stability",
      message: analysis.stability.message
    }));
  }

  const enabledProxyCount = design.links.reduce(
    (count, link) => count + (link.collisionProxies ?? []).filter((proxy) => proxy.enabled !== false).length,
    0
  );
  items.push(enrichAuditItem({
    level: enabledProxyCount > 0 ? "ok" : "warn",
    code: "simulation-proxies",
    message: enabledProxyCount > 0
      ? `${enabledProxyCount} enabled collision proxies are available for proxy simulation.`
      : "Simulation cannot initialize without enabled collision proxies."
  }));

  const urdfIssues = preflightUrdfExport(design, analysis.partRecords ?? []);
  items.push(...urdfIssues.map(enrichAuditItem));
  const urdfRisks = urdfIssues.filter((item) => item.level === "risk");
  const urdfWarnings = urdfIssues.filter((item) => item.level === "warn");
  items.push(enrichAuditItem({
    level: urdfRisks.length ? "risk" : urdfWarnings.length ? "warn" : "ok",
    code: "urdf-ready",
    message: urdfRisks.length
      ? `URDF export has ${urdfRisks.length} blocking issue${urdfRisks.length === 1 ? "" : "s"}.`
      : urdfWarnings.length
        ? `URDF export is available with ${urdfWarnings.length} warning${urdfWarnings.length === 1 ? "" : "s"}.`
        : "URDF export is ready with links, joints, inertials, visuals, collisions, limits, dynamics, and tool frames."
  }));

  return items;
}
