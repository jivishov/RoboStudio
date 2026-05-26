import { ASSISTANT_PAGES } from "./actionCatalog.js";

export const ASSISTANT_EVAL_MODEL = "gpt-5.4-mini";
export const ASSISTANT_EVAL_REASONING_EFFORT = "high";
export const ASSISTANT_EVAL_STORAGE_KEY = "robotic-arm-assistant-eval-v1";

function near(actual, expected, tolerance = 0.75) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= tolerance;
}

function vectorNear(actual, expected, tolerance = 0.75) {
  return Array.isArray(actual)
    && actual.length >= expected.length
    && expected.every((value, index) => near(actual[index], value, tolerance));
}

function findJoint(context, jointId) {
  return context?.joints?.find((joint) => joint.id === jointId)
    ?? context?.design?.joints?.find((joint) => joint.id === jointId)
    ?? null;
}

function findLink(context, linkId) {
  return context?.design?.links?.find((link) => link.id === linkId) ?? null;
}

function findProxy(context, linkId, proxyId) {
  return findLink(context, linkId)?.proxies?.find((proxy) => proxy.id === proxyId) ?? null;
}

function findBody(context, bodyId) {
  return context?.bodies?.find((body) => body.id === bodyId)
    ?? context?.project?.bodies?.find((body) => body.id === bodyId)
    ?? null;
}

function requireState(condition, message) {
  return condition ? [] : [message];
}

export function isAssistantEvalEnabled(locationLike) {
  const currentLocation = locationLike ?? (typeof window !== "undefined" ? window.location : "http://127.0.0.1/");
  const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1";
  const url = new URL(currentLocation.href ?? String(currentLocation), origin);
  return url.searchParams.get("assistantEval") === "1";
}

export function requiredCallsMissing(actualCalls = [], requiredCalls = []) {
  const names = actualCalls.map((call) => call.name ?? call);
  return requiredCalls.filter((name) => !names.includes(name));
}

export function evaluateScenarioResult(scenario, runResult, finalContext) {
  const failedAssertions = [];
  const missingCalls = requiredCallsMissing(runResult.toolCalls, scenario.requiredCalls);
  for (const name of missingCalls) failedAssertions.push(`Missing required call: ${name}`);
  const missingGuardedCalls = requiredCallsMissing(runResult.guardedCalls, scenario.requiredGuardedCalls);
  for (const name of missingGuardedCalls) failedAssertions.push(`Missing guarded staged call: ${name}`);
  failedAssertions.push(...(scenario.assert?.(finalContext, runResult) ?? []));
  if (runResult.stoppedForMaxRounds) failedAssertions.push("Stopped at the tool-round limit.");
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    pageId: scenario.pageId,
    prompt: scenario.prompt,
    requiredCalls: scenario.requiredCalls,
    requiredGuardedCalls: scenario.requiredGuardedCalls,
    actualCalls: runResult.toolCalls.map((call) => call.name),
    guardedCalls: runResult.guardedCalls.map((call) => call.name),
    pass: failedAssertions.length === 0,
    failedAssertions,
    latencyMs: runResult.latencyMs,
    usage: runResult.usage,
    finalText: runResult.finalText
  };
}

export const ASSISTANT_EVAL_SCENARIOS = Object.freeze([
  {
    id: "studio-part-setup",
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Studio Part Setup",
    prompt: "Switch to rotate mode, search for upper, select upper_arm, and set its opacity to 55 percent.",
    requiredCalls: ["studio_set_mode", "studio_search_parts", "studio_select_part", "studio_set_part_opacity"],
    requiredGuardedCalls: [],
    setupActions: [
      { name: "studio_reset_pose", args: {} },
      { name: "studio_clear_search", args: {} },
      { name: "studio_select_part", args: { partId: "none" } },
      { name: "studio_set_part_opacity", args: { partId: "upper_arm", opacityPercent: 100 } },
      { name: "studio_set_mode", args: { mode: "select" } }
    ],
    assert: (context) => [
      ...requireState(context?.mode === "rotate", "Expected Studio mode to be rotate."),
      ...requireState(context?.search === "upper", "Expected part search to be upper."),
      ...requireState(context?.selection?.id === "upper_arm", "Expected selected part to be upper_arm."),
      ...requireState(near(context?.selection?.opacityPercent, 55), "Expected upper_arm opacity near 55%.")
    ]
  },
  {
    id: "studio-pose-view",
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Studio Pose And View Prep",
    prompt: "Switch to hinge mode, set elbow to 30 degrees, hide the grid, and frame the assembly.",
    requiredCalls: ["studio_set_mode", "studio_set_joint_angle", "studio_set_grid_visible", "studio_frame_assembly"],
    requiredGuardedCalls: [],
    setupActions: [
      { name: "studio_reset_pose", args: {} },
      { name: "studio_set_grid_visible", args: { visible: true } },
      { name: "studio_set_mode", args: { mode: "select" } }
    ],
    assert: (context) => {
      const elbow = findJoint(context, "elbow");
      return [
        ...requireState(context?.mode === "hinge", "Expected Studio mode to be hinge."),
        ...requireState(near(elbow?.currentDeg, 30), "Expected elbow angle near 30 degrees."),
        ...requireState(context?.controls?.gridVisible === false, "Expected grid visibility to be false.")
      ];
    }
  },
  {
    id: "parts-template-edit",
    pageId: ASSISTANT_PAGES.PARTS,
    title: "Part Studio Template Edit",
    prompt: "Add a link bar template body, select it, rename it Test link, set color to #ff0000, set extrusion depth to 7 mm, and move it to [5, 0, 0].",
    requiredCalls: ["parts_add_template_body", "parts_select_body", "parts_set_body_properties"],
    requiredGuardedCalls: [],
    setupActions: [
      { name: "parts_new_project", args: {} }
    ],
    assert: (context) => {
      const body = context?.selection;
      return [
        ...requireState(context?.page === "Robotic Part Studio", "Expected Part Studio context."),
        ...requireState(body?.id === "link_bar", "Expected link_bar to be selected."),
        ...requireState(body?.name === "Test link", "Expected selected body to be renamed Test link."),
        ...requireState(body?.color === "#ff0000", "Expected selected body color to be #ff0000."),
        ...requireState(near(body?.extrudeDepthMm, 7), "Expected selected body extrusion depth near 7 mm."),
        ...requireState(vectorNear(body?.transform?.position, [5, 0, 0]), "Expected selected body position to be [5, 0, 0].")
      ];
    }
  },
  {
    id: "parts-cuts-and-advanced",
    pageId: ASSISTANT_PAGES.PARTS,
    title: "Part Studio Cuts And Advanced Bodies",
    prompt: "Add a base plate, add a circular hole, add a bolt circle, set the lathe preset to wheel, add the lathe body, and add a spur gear.",
    requiredCalls: [
      "parts_add_template_body",
      "parts_add_cut_profile",
      "parts_add_circular_pattern",
      "parts_set_revolve_preset",
      "parts_add_revolve_body",
      "parts_add_spur_gear"
    ],
    requiredGuardedCalls: [],
    setupActions: [
      { name: "parts_new_project", args: {} }
    ],
    assert: (context) => {
      const base = findBody(context, "base_plate");
      return [
        ...requireState((context?.counts?.bodies ?? 0) >= 3, "Expected at least three bodies."),
        ...requireState((base?.cutProfiles?.length ?? 0) >= 11, "Expected base plate to contain the original cuts, added hole, and bolt circle."),
        ...requireState(context?.bodies?.some((body) => body.sourceKind === "revolve"), "Expected a revolve body."),
        ...requireState(context?.bodies?.some((body) => body.sourceKind === "spurGear"), "Expected a spur gear body.")
      ];
    }
  },
  {
    id: "parts-boolean-guarded-staging",
    pageId: ASSISTANT_PAGES.PARTS,
    title: "Part Studio Boolean And Guarded Staging",
    prompt: "Create a subtract boolean body, export the selected STL, and delete the selected body.",
    requiredCalls: ["parts_set_boolean_operation", "parts_add_boolean_body"],
    requiredGuardedCalls: ["parts_export_selected_stl", "parts_delete_body"],
    setupActions: [
      { name: "parts_new_project", args: {} },
      { name: "parts_add_template_body", args: { templateId: "base_plate" } },
      { name: "parts_add_template_body", args: { templateId: "spacer_standoff" } }
    ],
    assert: (context) => [
      ...requireState(context?.bodies?.some((body) => body.sourceKind === "booleanOperation"), "Expected a boolean operation body."),
      ...requireState((context?.counts?.bodies ?? 0) === 3, "Expected guarded delete to leave the body count unchanged.")
    ]
  },
  {
    id: "workbench-ik-solve",
    pageId: ASSISTANT_PAGES.WORKBENCH,
    title: "Workbench IK Solve",
    prompt: "Switch to Analyze, select tool0, set the IK target to [120, 250, 0], then solve IK.",
    requiredCalls: ["workbench_set_mode", "workbench_set_ik_target", "workbench_solve_ik"],
    requiredGuardedCalls: [],
    setupActions: [
      { name: "workbench_select_effector", args: { effectorId: "tool0" } },
      { name: "workbench_reset_chain_pose", args: {} },
      { name: "workbench_set_mode", args: { mode: "model" } }
    ],
    assert: (context) => [
      ...requireState(context?.mode === "analyze", "Expected Workbench mode to be analyze."),
      ...requireState(vectorNear(context?.ik?.target, [120, 250, 0]), "Expected IK target to be [120, 250, 0]."),
      ...requireState(Boolean(context?.ik?.lastResult), "Expected IK result to exist.")
    ]
  },
  {
    id: "workbench-audit-step",
    pageId: ASSISTANT_PAGES.WORKBENCH,
    title: "Workbench Audit And Step",
    prompt: "Run the audit, summarize findings, turn gravity off, initialize simulation, and step once.",
    requiredCalls: [
      "workbench_run_audit",
      "workbench_set_simulation_options",
      "workbench_initialize_simulation",
      "workbench_step_simulation"
    ],
    requiredGuardedCalls: [],
    setupActions: [
      { name: "workbench_set_mode", args: { mode: "simulate" } },
      { name: "workbench_set_simulation_options", args: { gravityEnabled: true, timestep: 0.016666666666666666 } }
    ],
    assert: (context) => [
      ...requireState(context?.simulation?.gravityEnabled === false, "Expected gravity to be off."),
      ...requireState(context?.simulation?.dynamics?.ready === true, "Expected simulation dynamics to be ready."),
      ...requireState((context?.simulation?.dynamics?.steps ?? 0) >= 1, "Expected simulation to step at least once.")
    ]
  },
  {
    id: "workbench-guarded-staging",
    pageId: ASSISTANT_PAGES.WORKBENCH,
    title: "Workbench Guarded Staging",
    prompt: "Export the RobotDesign JSON and delete the selected proxy.",
    requiredCalls: [],
    requiredGuardedCalls: ["workbench_export_design_json", "workbench_delete_proxy"],
    setupActions: [
      { name: "workbench_set_mode", args: { mode: "model" } },
      { name: "workbench_select_proxy", args: { linkId: "upper_arm", proxyId: "upper_arm_box_proxy" } }
    ],
    assert: (context) => [
      ...requireState(
        Boolean(findProxy(context, "upper_arm", "upper_arm_box_proxy")),
        "Expected upper_arm_box_proxy to still exist after guarded staging."
      )
    ]
  }
]);

export function getAssistantEvalScenarios(pageId) {
  return ASSISTANT_EVAL_SCENARIOS.filter((scenario) => scenario.pageId === pageId);
}
