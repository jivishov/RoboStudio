export const ACTION_SAFETY = Object.freeze({
  AUTO: "auto",
  GUARDED: "guarded"
});

export const ASSISTANT_PAGES = Object.freeze({
  STUDIO: "studio",
  WORKBENCH: "workbench"
});

const emptyObjectSchema = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

const stringSchema = (description, options = {}) => ({
  type: "string",
  description,
  ...options
});

const numberSchema = (description, options = {}) => ({
  type: "number",
  description,
  ...options
});

const booleanSchema = (description) => ({
  type: "boolean",
  description
});

const vector3Schema = (description) => ({
  type: "array",
  description,
  minItems: 3,
  maxItems: 3,
  items: { type: "number" }
});

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

function defineAction(page, name, description, parameters, options = {}) {
  return Object.freeze({
    page,
    name,
    description,
    parameters,
    safety: options.safety ?? ACTION_SAFETY.AUTO,
    confirmation: options.confirmation ?? null
  });
}

const studioActions = [
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_set_mode",
    "Switch the Assembly Studio interaction mode.",
    objectSchema({ mode: stringSchema("Mode to activate.", { enum: ["select", "move", "rotate", "hinge"] }) }, ["mode"])
  ),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_search_parts",
    "Filter the parts panel by a search query.",
    objectSchema({ query: stringSchema("Search query. Use an empty string to show all parts.", { maxLength: 120 }) }, ["query"])
  ),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_clear_search", "Clear the parts search filter.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_select_part",
    "Select a visible part by id, or clear selection with partId set to none.",
    objectSchema({ partId: stringSchema("Part id to select, or none.", { maxLength: 120 }) }, ["partId"])
  ),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_frame_assembly", "Frame the assembly in the viewport.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_set_camera_controls",
    "Enable or disable camera orbit and zoom controls.",
    objectSchema({
      orbit: booleanSchema("Whether orbit rotation is enabled."),
      zoom: booleanSchema("Whether wheel/pinch zoom is enabled.")
    })
  ),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_set_grid_visible",
    "Show or hide the viewport grid.",
    objectSchema({ visible: booleanSchema("Whether the grid should be visible.") }, ["visible"])
  ),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_set_part_visibility",
    "Show or hide a part.",
    objectSchema({
      partId: stringSchema("Part id.", { maxLength: 120 }),
      visible: booleanSchema("Whether the part should be visible.")
    }, ["partId", "visible"])
  ),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_set_part_opacity",
    "Set a part opacity percentage.",
    objectSchema({
      partId: stringSchema("Part id.", { maxLength: 120 }),
      opacityPercent: numberSchema("Opacity percent from 15 to 100.", { minimum: 15, maximum: 100 })
    }, ["partId", "opacityPercent"])
  ),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_set_joint_angle",
    "Set a rigged joint angle in degrees.",
    objectSchema({
      jointId: stringSchema("Joint id.", { maxLength: 80 }),
      angleDeg: numberSchema("Angle in degrees.")
    }, ["jointId", "angleDeg"])
  ),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_reset_current_joint", "Reset the selected joint to its default angle.", emptyObjectSchema),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_reset_pose", "Reset the whole pose to default values.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_set_selected_transform",
    "Set the selected part transform offset. Provide only values that should change.",
    objectSchema({
      partId: stringSchema("Optional part id to select before applying the transform.", { maxLength: 120 }),
      position: vector3Schema("Optional local position offset in millimeters."),
      rotationDeg: vector3Schema("Optional local XYZ rotation offset in degrees."),
      scale: vector3Schema("Optional local XYZ scale; values must be positive.")
    })
  ),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_duplicate_selected_part", "Duplicate the selected part.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Duplicate the selected part."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_remove_selected_part", "Remove the selected imported part.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Remove the selected imported part."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_save_pose_json", "Download the current layout JSON.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Download the current layout JSON."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_load_pose_json", "Open a file picker to import a layout JSON.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Open the layout JSON file picker."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_export_glb", "Download the assembly GLB.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Export and download the assembly GLB."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_open_physics_workbench", "Save the current assembly snapshot and navigate to the Physics Workbench.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Prepare the assembly and open the Physics Workbench."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_import_stl_picker", "Open a file picker to import STL files.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Open the STL import file picker."
  })
];

const workbenchActions = [
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_set_mode",
    "Switch the Robotics Workbench mode.",
    objectSchema({ mode: stringSchema("Mode to activate.", { enum: ["model", "analyze", "actuators", "simulate", "audit"] }) }, ["mode"])
  ),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_frame_assembly", "Frame the robot assembly in the viewport.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_select_link",
    "Select a robot link by id.",
    objectSchema({ linkId: stringSchema("Link id.", { maxLength: 120 }) }, ["linkId"])
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_select_joint",
    "Select a robot joint by id.",
    objectSchema({ jointId: stringSchema("Joint id.", { maxLength: 120 }) }, ["jointId"])
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_select_proxy",
    "Select a collision proxy on the selected or provided link.",
    objectSchema({
      linkId: stringSchema("Optional link id.", { maxLength: 120 }),
      proxyId: stringSchema("Proxy id.", { maxLength: 120 })
    }, ["proxyId"])
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_select_effector",
    "Select an end effector by id.",
    objectSchema({ effectorId: stringSchema("End effector id.", { maxLength: 120 }) }, ["effectorId"])
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_select_actuator",
    "Select an actuator by id.",
    objectSchema({ actuatorId: stringSchema("Actuator id.", { maxLength: 120 }) }, ["actuatorId"])
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_set_link_properties",
    "Edit the selected or provided link name, mass, and center of mass.",
    objectSchema({
      linkId: stringSchema("Optional link id.", { maxLength: 120 }),
      name: stringSchema("Optional link name.", { maxLength: 120 }),
      massKg: numberSchema("Optional link mass in kilograms.", { minimum: 0, maximum: 1000 }),
      com: vector3Schema("Optional center of mass in millimeters.")
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_estimate_link_mass_com",
    "Estimate the selected or provided link mass, center of mass, and inertia from bounds.",
    objectSchema({ linkId: stringSchema("Optional link id.", { maxLength: 120 }) })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_set_proxy",
    "Edit a collision proxy on the selected or provided link.",
    objectSchema({
      linkId: stringSchema("Optional link id.", { maxLength: 120 }),
      proxyId: stringSchema("Optional proxy id.", { maxLength: 120 }),
      type: stringSchema("Optional proxy type.", { enum: ["box", "sphere", "capsule", "cylinder"] }),
      origin: vector3Schema("Optional proxy origin in millimeters."),
      dimensions: vector3Schema("Optional proxy dimensions in millimeters."),
      enabled: booleanSchema("Optional enabled state.")
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_add_proxy",
    "Add a collision proxy to a link.",
    objectSchema({
      linkId: stringSchema("Optional link id.", { maxLength: 120 }),
      type: stringSchema("Proxy type.", { enum: ["box", "sphere", "capsule", "cylinder"] })
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_reset_proxy_from_bounds",
    "Reset a proxy shape from its link bounds.",
    objectSchema({
      linkId: stringSchema("Optional link id.", { maxLength: 120 }),
      proxyId: stringSchema("Optional proxy id.", { maxLength: 120 })
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_set_effector",
    "Edit an end effector.",
    objectSchema({
      effectorId: stringSchema("Optional end effector id.", { maxLength: 120 }),
      name: stringSchema("Optional end effector name.", { maxLength: 120 }),
      linkId: stringSchema("Optional link id.", { maxLength: 120 }),
      position: vector3Schema("Optional tool-frame position in millimeters."),
      rotation: vector3Schema("Optional tool-frame rotation in degrees.")
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_add_effector",
    "Add an end effector.",
    objectSchema({
      name: stringSchema("Optional end effector name.", { maxLength: 120 }),
      linkId: stringSchema("Optional link id.", { maxLength: 120 }),
      position: vector3Schema("Optional tool-frame position in millimeters."),
      rotation: vector3Schema("Optional tool-frame rotation in degrees.")
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_set_joint",
    "Edit a joint.",
    objectSchema({
      jointId: stringSchema("Optional joint id.", { maxLength: 120 }),
      name: stringSchema("Optional joint name.", { maxLength: 120 }),
      type: stringSchema("Optional joint type.", { enum: ["fixed", "revolute", "prismatic"] }),
      parentLinkId: stringSchema("Optional parent link id.", { maxLength: 120 }),
      childLinkId: stringSchema("Optional child link id.", { maxLength: 120 }),
      origin: vector3Schema("Optional joint origin in millimeters."),
      axis: vector3Schema("Optional joint axis."),
      min: numberSchema("Optional minimum joint limit."),
      max: numberSchema("Optional maximum joint limit."),
      damping: numberSchema("Optional damping.", { minimum: 0 }),
      friction: numberSchema("Optional friction.", { minimum: 0 }),
      actuatorId: stringSchema("Optional actuator id, or none to unassign.", { maxLength: 120 })
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_add_joint",
    "Add a joint.",
    objectSchema({
      name: stringSchema("Joint name.", { maxLength: 120 }),
      type: stringSchema("Optional joint type.", { enum: ["fixed", "revolute", "prismatic"] }),
      parentLinkId: stringSchema("Parent link id.", { maxLength: 120 }),
      childLinkId: stringSchema("Child link id.", { maxLength: 120 }),
      origin: vector3Schema("Optional joint origin in millimeters."),
      axis: vector3Schema("Optional joint axis."),
      min: numberSchema("Optional minimum joint limit."),
      max: numberSchema("Optional maximum joint limit."),
      damping: numberSchema("Optional damping.", { minimum: 0 }),
      friction: numberSchema("Optional friction.", { minimum: 0 }),
      actuatorId: stringSchema("Optional actuator id.", { maxLength: 120 })
    }, ["name", "parentLinkId", "childLinkId"])
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_set_ik_target",
    "Set the inverse-kinematics target.",
    objectSchema({
      effectorId: stringSchema("Optional end effector id.", { maxLength: 120 }),
      target: vector3Schema("Target XYZ in millimeters.")
    }, ["target"])
  ),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_solve_ik", "Solve IK for the current target and selected end effector.", emptyObjectSchema),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_reset_chain_pose", "Reset the selected end-effector joint chain pose.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_assign_actuator",
    "Assign an actuator to a joint, or unassign with actuatorId set to none.",
    objectSchema({
      jointId: stringSchema("Joint id.", { maxLength: 120 }),
      actuatorId: stringSchema("Actuator id, or none.", { maxLength: 120 })
    }, ["jointId", "actuatorId"])
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_upsert_actuator",
    "Create or edit an actuator.",
    objectSchema({
      actuatorId: stringSchema("Optional actuator id to edit.", { maxLength: 120 }),
      name: stringSchema("Optional actuator name.", { maxLength: 120 }),
      continuousTorqueNm: numberSchema("Optional continuous torque in N.m.", { minimum: 0 }),
      peakTorqueNm: numberSchema("Optional peak torque in N.m.", { minimum: 0 }),
      maxSpeedDegS: numberSchema("Optional maximum speed in degrees per second.", { minimum: 0 }),
      voltage: numberSchema("Optional voltage.", { minimum: 0 }),
      massKg: numberSchema("Optional actuator mass in kg.", { minimum: 0 }),
      gearRatio: numberSchema("Optional gear ratio.", { minimum: 1 }),
      efficiency: numberSchema("Optional efficiency from 0.01 to 1.", { minimum: 0.01, maximum: 1 }),
      notes: stringSchema("Optional notes.", { maxLength: 600 })
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_allow_collision_pair",
    "Allow an intentional collision pair.",
    objectSchema({
      pair: stringSchema("Optional preformatted pair key.", { maxLength: 240 }),
      linkA: stringSchema("Optional first link id.", { maxLength: 120 }),
      linkB: stringSchema("Optional second link id.", { maxLength: 120 })
    })
  ),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_remove_allowed_collision_pair",
    "Remove an allowed collision pair.",
    objectSchema({ pair: stringSchema("Collision pair key.", { maxLength: 240 }) }, ["pair"])
  ),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_run_audit", "Run readiness analysis and refresh audit results.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.WORKBENCH,
    "workbench_set_simulation_options",
    "Set simulation options. Re-initialization may be required.",
    objectSchema({
      gravityEnabled: booleanSchema("Optional gravity enabled state."),
      timestep: numberSchema("Optional timestep in seconds.", { minimum: 0.004, maximum: 0.067 })
    })
  ),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_initialize_simulation", "Initialize or reset the Rapier proxy simulation.", emptyObjectSchema),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_step_simulation", "Advance the simulation by one timestep.", emptyObjectSchema),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_delete_proxy", "Delete the selected or provided collision proxy.", objectSchema({
    linkId: stringSchema("Optional link id.", { maxLength: 120 }),
    proxyId: stringSchema("Optional proxy id.", { maxLength: 120 })
  }), {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Delete the selected collision proxy."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_delete_effector", "Delete the selected or provided end effector.", objectSchema({
    effectorId: stringSchema("Optional end effector id.", { maxLength: 120 })
  }), {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Delete the selected end effector."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_delete_actuator", "Delete the selected or provided actuator.", objectSchema({
    actuatorId: stringSchema("Optional actuator id.", { maxLength: 120 })
  }), {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Delete the selected actuator."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_save_design", "Save the current RobotDesign to browser storage.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Save the current RobotDesign."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_import_design_picker", "Open a file picker to import RobotDesign JSON.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Open the RobotDesign import file picker."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_export_design_json", "Download the current RobotDesign JSON.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Download the current RobotDesign JSON."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_export_urdf", "Download a URDF-like robot description.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Download the URDF robot description."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_toggle_simulation_run", "Start or pause continuous simulation.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Start or pause continuous simulation."
  })
];

export const ASSISTANT_ACTIONS = Object.freeze([...studioActions, ...workbenchActions]);

const ACTION_BY_PAGE_AND_NAME = new Map(
  ASSISTANT_ACTIONS.map((action) => [`${action.page}:${action.name}`, action])
);

export function getActionsForPage(pageId) {
  return ASSISTANT_ACTIONS.filter((action) => action.page === pageId);
}

export function getActionDefinition(pageId, actionName) {
  return ACTION_BY_PAGE_AND_NAME.get(`${pageId}:${actionName}`) ?? null;
}

export function toolsForPage(pageId) {
  return getActionsForPage(pageId).map((action) => ({
    type: "function",
    name: action.name,
    description: action.description,
    parameters: action.parameters
  }));
}

function validateValue(schema, value, path, errors) {
  if (!schema) return;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties?.[key]) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value && value[key] !== undefined) validateValue(childSchema, value[key], `${path}.${key}`, errors);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return;
    }
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s)`);
    }
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s)`);
    }
    value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`, errors));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path} must be a string`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${path} must be ${schema.maxLength} characters or fewer`);
    }
    return;
  }
  if (schema.type === "number") {
    if (!Number.isFinite(Number(value))) {
      errors.push(`${path} must be a finite number`);
      return;
    }
    const numeric = Number(value);
    if (Number.isFinite(schema.minimum) && numeric < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && numeric > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

export function validateActionArguments(pageId, actionName, args = {}) {
  const action = getActionDefinition(pageId, actionName);
  if (!action) {
    return { ok: false, errors: [`Unknown action ${actionName} for page ${pageId}`] };
  }
  const errors = [];
  validateValue(action.parameters, args ?? {}, "arguments", errors);
  return { ok: errors.length === 0, errors };
}
