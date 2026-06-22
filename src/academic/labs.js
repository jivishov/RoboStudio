export const LAB_SPEC_VERSION = 1;

export const DEFAULT_UNDERGRAD_LAB = Object.freeze({
  version: LAB_SPEC_VERSION,
  id: "undergrad-robot-modeling",
  title: "Robot Modeling And Evidence Lab",
  level: "undergraduate",
  durationMinutes: 90,
  learningObjectives: [
    "Build a link and joint model from visual robot geometry.",
    "Use mass, center of mass, collision proxies, and actuator margins as engineering evidence.",
    "Solve and explain an inverse-kinematics target.",
    "Export a reproducible design package and lab report."
  ],
  checkpoints: [
    { id: "model-minimum", label: "Model at least three links and two joints.", kind: "model-minimum", minLinks: 3, minJoints: 2 },
    { id: "mass-com", label: "Define positive mass and COM data for every link.", kind: "mass-defined" },
    { id: "ik-solved", label: "Solve an IK target within 10 mm.", kind: "ik-solved", maxErrorMm: 10 },
    { id: "actuator-sizing", label: "Assign actuators with no risk-level torque findings.", kind: "actuator-margins" },
    { id: "experiment-run", label: "Capture at least one experiment run.", kind: "experiment-runs", minRuns: 1 },
    { id: "urdf-ready", label: "Reach URDF preflight with no blocking risks.", kind: "export-ready" }
  ],
  deliverables: ["RoboStudio project JSON", "Experiment CSV", "HTML lab report", "URDF readiness notes"],
  hints: [
    "Use the Model tab to confirm links own the correct visual parts.",
    "Use Analyze to solve a reachable target before collecting a run.",
    "Use Actuators to compare recommended torque against continuous torque."
  ]
});

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createDefaultLabSpec(overrides = {}) {
  return {
    ...DEFAULT_UNDERGRAD_LAB,
    ...overrides,
    learningObjectives: overrides.learningObjectives ?? [...DEFAULT_UNDERGRAD_LAB.learningObjectives],
    checkpoints: overrides.checkpoints ?? DEFAULT_UNDERGRAD_LAB.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    deliverables: overrides.deliverables ?? [...DEFAULT_UNDERGRAD_LAB.deliverables],
    hints: overrides.hints ?? [...DEFAULT_UNDERGRAD_LAB.hints]
  };
}

export function normalizeLabSpec(input = {}) {
  if (!input || typeof input !== "object") return createDefaultLabSpec();
  const defaults = createDefaultLabSpec();
  return {
    version: LAB_SPEC_VERSION,
    id: String(input.id ?? defaults.id),
    title: String(input.title ?? defaults.title),
    level: String(input.level ?? defaults.level),
    durationMinutes: Math.max(5, finiteNumber(input.durationMinutes, defaults.durationMinutes)),
    learningObjectives: Array.isArray(input.learningObjectives)
      ? input.learningObjectives.map(String).filter(Boolean)
      : [...defaults.learningObjectives],
    checkpoints: Array.isArray(input.checkpoints) && input.checkpoints.length
      ? input.checkpoints.map((checkpoint, index) => ({
          id: String(checkpoint.id ?? `checkpoint_${index + 1}`),
          label: String(checkpoint.label ?? checkpoint.id ?? `Checkpoint ${index + 1}`),
          kind: String(checkpoint.kind ?? "custom"),
          ...checkpoint
        }))
      : defaults.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    deliverables: Array.isArray(input.deliverables) ? input.deliverables.map(String) : [...defaults.deliverables],
    hints: Array.isArray(input.hints) ? input.hints.map(String) : [...defaults.hints]
  };
}

function checkpointResult(checkpoint, passed, evidence, action = "") {
  return {
    id: checkpoint.id,
    label: checkpoint.label,
    kind: checkpoint.kind,
    passed,
    evidence,
    action
  };
}

export function evaluateLabCheckpoint(checkpoint, context = {}) {
  const design = context.design ?? {};
  const analysis = context.analysis ?? {};
  const experimentRuns = context.experimentRuns ?? [];
  const links = design.links ?? [];
  const joints = design.joints ?? [];
  const movableJoints = joints.filter((joint) => joint.type !== "fixed");

  if (checkpoint.kind === "model-minimum") {
    const minLinks = checkpoint.minLinks ?? 1;
    const minJoints = checkpoint.minJoints ?? 0;
    const passed = links.length >= minLinks && joints.length >= minJoints && (design.endEffectors?.length ?? 0) >= 1;
    return checkpointResult(
      checkpoint,
      passed,
      `${links.length}/${minLinks} links, ${joints.length}/${minJoints} joints, ${design.endEffectors?.length ?? 0} tools`,
      "Create links, joints, and an end effector before submitting."
    );
  }

  if (checkpoint.kind === "mass-defined") {
    const missing = links.filter((link) => !(link.massKg > 0) || !Array.isArray(link.com));
    return checkpointResult(
      checkpoint,
      missing.length === 0 && links.length > 0,
      missing.length ? `${missing.length} links still need mass/COM values` : `Total mass ${analysis.mass?.totalMassKg ?? "-"} kg`,
      "Estimate or enter mass and COM for each link."
    );
  }

  if (checkpoint.kind === "ik-solved") {
    const maxErrorMm = checkpoint.maxErrorMm ?? 10;
    const result = context.ikResult;
    return checkpointResult(
      checkpoint,
      Boolean(result?.ok) && finiteNumber(result?.errorMm, Infinity) <= maxErrorMm,
      result ? `${finiteNumber(result.errorMm, Infinity).toFixed(2)} mm error` : "No IK result captured",
      "Set a reachable target in Analyze mode and solve IK."
    );
  }

  if (checkpoint.kind === "actuator-margins") {
    const actuatorResults = analysis.actuatorResults ?? [];
    const risks = actuatorResults.filter((item) => item.state === "risk");
    const unassigned = movableJoints.filter((joint) => !joint.actuatorId);
    return checkpointResult(
      checkpoint,
      actuatorResults.length > 0 && risks.length === 0 && unassigned.length === 0,
      `${risks.length} risk findings, ${unassigned.length} unassigned movable joints`,
      "Assign drives or reduce payload/speed assumptions until risk findings clear."
    );
  }

  if (checkpoint.kind === "experiment-runs") {
    const minRuns = checkpoint.minRuns ?? 1;
    return checkpointResult(
      checkpoint,
      experimentRuns.length >= minRuns,
      `${experimentRuns.length}/${minRuns} experiment runs captured`,
      "Capture an experiment run after refreshing analysis."
    );
  }

  if (checkpoint.kind === "export-ready") {
    const issues = analysis.urdf?.issues ?? [];
    const blockers = issues.filter((item) => item.level === "risk");
    return checkpointResult(
      checkpoint,
      Boolean(analysis.urdf?.ready) && blockers.length === 0,
      blockers.length ? `${blockers.length} URDF blockers` : "URDF preflight has no blockers",
      "Review Export findings and fix blockers."
    );
  }

  return checkpointResult(checkpoint, false, "Unknown checkpoint kind", "Review the lab specification.");
}

export function evaluateLabSpec(labSpec, context = {}) {
  const lab = normalizeLabSpec(labSpec);
  return lab.checkpoints.map((checkpoint) => evaluateLabCheckpoint(checkpoint, context));
}

export function labProgress(results = []) {
  const passed = results.filter((result) => result.passed).length;
  return {
    passed,
    total: results.length,
    percent: results.length ? Math.round((passed / results.length) * 100) : 0
  };
}

export function createLabReportJson({ labSpec, checkpointResults, experimentRuns = [], design, analysis, manifest }) {
  const lab = normalizeLabSpec(labSpec);
  const progress = labProgress(checkpointResults);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    lab: {
      id: lab.id,
      title: lab.title,
      level: lab.level,
      learningObjectives: lab.learningObjectives,
      deliverables: lab.deliverables
    },
    progress,
    checkpoints: checkpointResults,
    experimentRuns,
    designSummary: {
      name: design?.name ?? "RobotDesign",
      links: design?.links?.length ?? 0,
      joints: design?.joints?.length ?? 0,
      actuators: design?.actuators?.length ?? 0
    },
    analysisSummary: {
      totalMassKg: analysis?.mass?.totalMassKg ?? null,
      collisions: analysis?.collisions?.length ?? 0,
      actuatorRisks: analysis?.actuatorResults?.filter((item) => item.state === "risk").length ?? 0,
      urdfReady: Boolean(analysis?.urdf?.ready)
    },
    manifestSummary: {
      assets: manifest?.assets?.length ?? 0,
      warnings: manifest?.warnings?.length ?? 0
    }
  };
}

export function createLabReportHtml(input) {
  const report = createLabReportJson(input);
  const checkpointRows = report.checkpoints
    .map(
      (checkpoint) =>
        `<tr><td>${escapeHtml(checkpoint.label)}</td><td>${checkpoint.passed ? "Pass" : "Needs work"}</td><td>${escapeHtml(checkpoint.evidence)}</td><td>${escapeHtml(checkpoint.action)}</td></tr>`
    )
    .join("");
  const objectiveItems = report.lab.learningObjectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const runRows = report.experimentRuns.length
    ? report.experimentRuns
        .map(
          (run) =>
            `<tr><td>${escapeHtml(run.label)}</td><td>${escapeHtml(run.createdAt)}</td><td>${escapeHtml(run.metrics?.totalMassKg ?? "-")}</td><td>${escapeHtml(run.metrics?.ikErrorMm ?? "-")}</td><td>${escapeHtml(run.metrics?.collisionCount ?? 0)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="5">No experiment runs captured.</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.lab.title)} Report</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; margin: 32px; color: #111827; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    h2 { margin-top: 28px; font-size: 16px; }
    p, li, td, th { font-size: 13px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 18px; }
    .summary div { border: 1px solid #d1d5db; padding: 10px; }
    .summary span { display: block; color: #4b5563; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .summary strong { font-size: 18px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(report.lab.title)}</h1>
  <p>${escapeHtml(report.lab.level)} lab report generated ${escapeHtml(report.generatedAt)}</p>
  <div class="summary">
    <div><span>Progress</span><strong>${report.progress.passed}/${report.progress.total}</strong></div>
    <div><span>Links</span><strong>${report.designSummary.links}</strong></div>
    <div><span>Joints</span><strong>${report.designSummary.joints}</strong></div>
    <div><span>URDF</span><strong>${report.analysisSummary.urdfReady ? "Ready" : "Blocked"}</strong></div>
  </div>
  <h2>Learning Objectives</h2>
  <ul>${objectiveItems}</ul>
  <h2>Checkpoints</h2>
  <table><thead><tr><th>Checkpoint</th><th>Status</th><th>Evidence</th><th>Next action</th></tr></thead><tbody>${checkpointRows}</tbody></table>
  <h2>Experiment Runs</h2>
  <table><thead><tr><th>Run</th><th>Created</th><th>Mass kg</th><th>IK error mm</th><th>Collisions</th></tr></thead><tbody>${runRows}</tbody></table>
</body>
</html>`;
}
