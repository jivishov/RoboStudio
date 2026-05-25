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

function collisionGeometry(proxy) {
  const dimensions = proxy.dimensions ?? [10, 10, 10];
  if (proxy.type === "sphere") return `<sphere radius="${xmlNumber(dimensions[0] * 0.001)}" />`;
  if (proxy.type === "capsule") {
    return `<cylinder radius="${xmlNumber(dimensions[0] * 0.001)}" length="${xmlNumber(dimensions[1] * 0.001)}" />`;
  }
  if (proxy.type === "cylinder") {
    return `<cylinder radius="${xmlNumber(dimensions[0] * 0.001)}" length="${xmlNumber(dimensions[1] * 0.001)}" />`;
  }
  return `<box size="${xyz(dimensions.map((value) => value * 0.001))}" />`;
}

export function serializeUrdfLike(design, partRecords = []) {
  const parts = new Map(partRecords.map((part) => [part.id, part]));
  const actuators = new Map((design.actuators ?? []).map((actuator) => [actuator.id, actuator]));
  const linkXml = design.links
    .map((link) => {
      const visuals = link.partIds
        .map((partId) => {
          const part = parts.get(partId);
          return `    <visual name="${escapeXml(partId)}">\n      <geometry><mesh filename="${escapeXml(part?.file ?? part?.name ?? partId)}" /></geometry>\n    </visual>`;
        })
        .join("\n");
      const collisions = link.collisionProxies
        .filter((proxy) => proxy.enabled !== false)
        .map(
          (proxy) =>
            `    <collision name="${escapeXml(proxy.id)}">\n      <origin xyz="${xyz((proxy.origin ?? [0, 0, 0]).map((value) => value * 0.001))}" rpy="0 0 0" />\n      <geometry>${collisionGeometry(proxy)}</geometry>\n    </collision>`
        )
        .join("\n");
      return `  <link name="${escapeXml(link.id)}">\n    <inertial>\n      <origin xyz="${xyz((link.com ?? [0, 0, 0]).map((value) => value * 0.001))}" rpy="0 0 0" />\n      <mass value="${link.massKg}" />\n      <inertia ixx="${link.inertia?.[0] ?? 0}" ixy="0" ixz="0" iyy="${link.inertia?.[1] ?? 0}" iyz="0" izz="${link.inertia?.[2] ?? 0}" />\n    </inertial>\n${visuals}\n${collisions}\n  </link>`;
    })
    .join("\n");

  const jointXml = design.joints
    .map((joint) => {
      const type = joint.type === "fixed" ? "fixed" : joint.type === "prismatic" ? "prismatic" : "revolute";
      const actuator = actuators.get(joint.actuatorId);
      const lower = type === "revolute" ? (joint.min * Math.PI) / 180 : joint.min * 0.001;
      const upper = type === "revolute" ? (joint.max * Math.PI) / 180 : joint.max * 0.001;
      const velocity = type === "revolute" ? ((actuator?.maxSpeedDegS ?? 0) * Math.PI) / 180 : (actuator?.maxSpeedDegS ?? 0) * 0.001;
      const effort = actuator?.peakTorqueNm ?? actuator?.continuousTorqueNm ?? 0;
      const limit = type === "fixed"
        ? ""
        : `\n    <limit lower="${xmlNumber(lower)}" upper="${xmlNumber(upper)}" effort="${xmlNumber(effort)}" velocity="${xmlNumber(velocity)}" />`;
      return `  <joint name="${escapeXml(joint.id)}" type="${type}">\n    <parent link="${escapeXml(joint.parentLinkId)}" />\n    <child link="${escapeXml(joint.childLinkId)}" />\n    <origin xyz="${xyz((joint.origin ?? [0, 0, 0]).map((value) => value * 0.001))}" rpy="0 0 0" />\n    <axis xyz="${xyz(joint.axis ?? [0, 0, 1])}" />${limit}\n  </joint>`;
    })
    .join("\n");

  return `<?xml version="1.0"?>\n<robot name="${escapeXml(design.name)}">\n${linkXml}\n${jointXml}\n</robot>\n`;
}
