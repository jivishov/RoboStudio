export const ACTION_SAFETY = Object.freeze({
  AUTO: "auto",
  GUARDED: "guarded"
});

export const ASSISTANT_PAGES = Object.freeze({
  STUDIO: "studio",
  PARTS: "parts",
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

const vector2Schema = (description) => ({
  type: "array",
  description,
  minItems: 2,
  maxItems: 2,
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
    objectSchema({ mode: stringSchema("Mode to activate.", { enum: ["select", "move", "rotate", "resize", "hinge"] }) }, ["mode"])
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
  defineAction(
    ASSISTANT_PAGES.STUDIO,
    "studio_resize_selected_part",
    "Resize the selected or provided Assembly Studio part to a target bounding-box size in millimeters.",
    objectSchema({
      partId: stringSchema("Optional part id to select before resizing.", { maxLength: 120 }),
      targetSizeMm: vector3Schema("Target bounding-box size in millimeters."),
      uniform: booleanSchema("Whether to preserve proportions while resizing.")
    }, ["targetSizeMm"])
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
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_open_physics_workbench", "Save the current assembly snapshot and navigate to the Robotics Design Workbench.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Prepare the assembly and open the Robotics Design Workbench."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_import_stl_picker", "Open a file picker to import STL files.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Open the STL import file picker."
  }),
  defineAction(ASSISTANT_PAGES.STUDIO, "studio_clear_scene", "Remove every currently loaded part from the Assembly Studio scene.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Clear every part from the scene."
  })
];

const partTemplateIds = Object.freeze([
  "base_plate",
  "link_bar",
  "servo_mount_plate",
  "l_bracket",
  "u_bracket",
  "spacer_standoff",
  "axle_shaft",
  "gripper_finger"
]);

const revolvePresetIds = Object.freeze(["shaft", "pulley", "bushing", "wheel", "collar", "knob", "spacer"]);
const booleanOperations = Object.freeze(["union", "subtract", "intersect"]);
const sketchProfileTypes = Object.freeze(["rectangle", "circle", "roundedSlot", "polyline"]);
const hexColorSchema = stringSchema("Optional body color as a six-digit hex value.", {
  maxLength: 7,
  pattern: "^#[0-9a-fA-F]{6}$"
});
const customSketchProfileSchema = objectSchema({
  id: stringSchema("Optional stable profile id.", { maxLength: 80 }),
  type: stringSchema("Supported V1 profile type.", { enum: sketchProfileTypes }),
  x: numberSchema("Optional profile center X in millimeters."),
  z: numberSchema("Optional profile center Z in millimeters."),
  radius: numberSchema("Optional circle radius in millimeters.", { minimum: 0.1 }),
  length: numberSchema("Optional rounded slot length in millimeters.", { minimum: 0.1 }),
  width: numberSchema("Optional rectangle or rounded slot width in millimeters.", { minimum: 0.1 }),
  height: numberSchema("Optional rectangle height in millimeters.", { minimum: 0.1 }),
  cornerRadius: numberSchema("Optional rectangle corner radius in millimeters.", { minimum: 0 }),
  closed: booleanSchema("For polyline profiles, whether the polyline is closed."),
  points: {
    type: "array",
    description: "Polyline points as [x, z] pairs.",
    minItems: 3,
    items: vector2Schema("Polyline point.")
  }
}, ["type"]);
const customSketchTransformSchema = objectSchema({
  position: vector3Schema("Optional body position in millimeters."),
  scale: vector3Schema("Optional body scale; values must be positive.")
});
const customSketchBodyProperties = {
  name: stringSchema("Body name for the generated custom sketch.", { maxLength: 120 }),
  color: hexColorSchema,
  extrudeDepthMm: numberSchema("Sketch extrusion depth in millimeters.", { minimum: 0.1 }),
  outerProfile: customSketchProfileSchema,
  cutProfiles: {
    type: "array",
    description: "Optional closed cut profiles inside the outer profile.",
    items: customSketchProfileSchema
  },
  transform: customSketchTransformSchema,
  designIntent: stringSchema("Short non-persistent explanation of the intended shape.", { maxLength: 800 })
};

const partsActions = [
  defineAction(ASSISTANT_PAGES.PARTS, "parts_new_project", "Reset the Component Builder to a new empty PartProject.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Start a new empty PartProject."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_save_project_json", "Download the current PartProject JSON.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Download the current PartProject JSON."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_save_selected_to_library", "Save the selected Component Builder body to the local part library.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Save the selected body to the local part library."
  }),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_add_library_item",
    "Add a saved local library part to the current PartProject.",
    objectSchema({ itemId: stringSchema("Library item id to add.", { maxLength: 120 }) }, ["itemId"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_delete_library_item",
    "Delete a saved item from the local part library.",
    objectSchema({ itemId: stringSchema("Library item id to delete.", { maxLength: 120 }) }, ["itemId"]),
    {
      safety: ACTION_SAFETY.GUARDED,
      confirmation: "Delete the selected local library item."
    }
  ),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_export_library_json", "Download the local part library as JSON.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Download the local part library JSON."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_open_library_import_picker", "Open a file picker to import part library JSON.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Open the part library JSON file picker."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_open_project_picker", "Open a file picker to import a PartProject JSON file.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Open the PartProject JSON file picker."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_export_selected_stl", "Build if needed and export the selected generated body as STL.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Export the selected generated body as STL."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_send_assembly", "Build if needed, write the generated assembly snapshot, and open Assembly Studio.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Send generated bodies to Assembly Studio."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_open_assembly_studio", "Navigate back to the Assembly Studio.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Open the Assembly Studio."
  }),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_undo", "Undo the latest PartProject edit.", emptyObjectSchema),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_redo", "Redo the latest undone PartProject edit.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_select_body",
    "Select a Component Builder body by id.",
    objectSchema({ bodyId: stringSchema("Body id to select.", { maxLength: 120 }) }, ["bodyId"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_set_template_selection",
    "Select the starter template used by the Add Body button.",
    objectSchema({ templateId: stringSchema("Template id.", { enum: partTemplateIds }) }, ["templateId"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_add_template_body",
    "Add a starter template body. If templateId is omitted, the current template selection is used.",
    objectSchema({ templateId: stringSchema("Optional template id.", { enum: partTemplateIds }) })
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_create_custom_sketch_body",
    "Create a new custom sketch-extrude body from LLM-designed V1 profile geometry when no starter template matches the requested object.",
    objectSchema(customSketchBodyProperties, ["name", "outerProfile", "extrudeDepthMm"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_replace_sketch_body",
    "Replace the selected or provided sketch body with a full custom V1 sketch in one safe refinement step.",
    objectSchema({
      bodyId: stringSchema("Optional body id to replace. If omitted, the selected body is replaced.", { maxLength: 120 }),
      ...customSketchBodyProperties
    }, ["outerProfile", "extrudeDepthMm"])
  ),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_duplicate_body", "Duplicate the selected or provided body.", objectSchema({
    bodyId: stringSchema("Optional body id to duplicate.", { maxLength: 120 })
  })),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_delete_body", "Delete the selected or provided body.", objectSchema({
    bodyId: stringSchema("Optional body id to delete.", { maxLength: 120 })
  }), {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Delete the selected or provided body."
  }),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_set_body_properties",
    "Edit the selected or provided body name, color, extrusion depth, position, and scale.",
    objectSchema({
      bodyId: stringSchema("Optional body id to edit.", { maxLength: 120 }),
      name: stringSchema("Optional body name.", { maxLength: 120 }),
      color: hexColorSchema,
      extrudeDepthMm: numberSchema("Optional sketch extrusion depth in millimeters.", { minimum: 0.1 }),
      position: vector3Schema("Optional body position in millimeters."),
      scale: vector3Schema("Optional body scale; values must be positive.")
    })
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_resize_body",
    "Resize the selected or provided Component Builder body by target dimensions in millimeters.",
    objectSchema({
      bodyId: stringSchema("Optional body id to resize.", { maxLength: 120 }),
      targetSizeMm: vector3Schema("Target size in X/Y/Z millimeters."),
      uniform: booleanSchema("Whether to preserve proportions while resizing."),
      keepCutSizes: booleanSchema("Whether sketch holes and cutouts should keep their physical size.")
    }, ["targetSizeMm"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_set_profile",
    "Edit the selected body's outer profile or one cut profile.",
    objectSchema({
      bodyId: stringSchema("Optional body id to edit.", { maxLength: 120 }),
      target: stringSchema("Profile target.", { enum: ["outer", "cut"] }),
      profileId: stringSchema("Optional cut profile id.", { maxLength: 120 }),
      cutIndex: numberSchema("Optional zero-based cut profile index.", { minimum: 0 }),
      x: numberSchema("Optional profile center X in millimeters."),
      z: numberSchema("Optional profile center Z in millimeters."),
      radius: numberSchema("Optional circle radius in millimeters.", { minimum: 0.1 }),
      length: numberSchema("Optional slot length in millimeters.", { minimum: 0.1 }),
      width: numberSchema("Optional profile width in millimeters.", { minimum: 0.1 }),
      height: numberSchema("Optional profile height in millimeters.", { minimum: 0.1 }),
      cornerRadius: numberSchema("Optional rectangle corner radius in millimeters.", { minimum: 0 }),
      points: {
        type: "array",
        description: "Optional replacement polyline points as [x, z] pairs.",
        items: vector2Schema("Polyline point.")
      }
    }, ["target"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_add_cut_profile",
    "Add a circular or slotted cut profile to the selected or provided sketch body.",
    objectSchema({
      bodyId: stringSchema("Optional body id.", { maxLength: 120 }),
      type: stringSchema("Cut profile type.", { enum: ["circle", "slot"] })
    }, ["type"])
  ),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_remove_cut_profile", "Remove a cut profile from the selected or provided sketch body.", objectSchema({
    bodyId: stringSchema("Optional body id.", { maxLength: 120 }),
    profileId: stringSchema("Optional cut profile id.", { maxLength: 120 }),
    cutIndex: numberSchema("Optional zero-based cut profile index.", { minimum: 0 })
  })),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_add_linear_pattern", "Add the page's linear hole pattern to the selected or provided sketch body.", objectSchema({
    bodyId: stringSchema("Optional body id.", { maxLength: 120 })
  })),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_add_circular_pattern", "Add the page's bolt-circle pattern to the selected or provided sketch body.", objectSchema({
    bodyId: stringSchema("Optional body id.", { maxLength: 120 })
  })),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_set_revolve_preset",
    "Select the lathe preset used by the Add Lathe Body button.",
    objectSchema({ presetId: stringSchema("Revolve preset id.", { enum: revolvePresetIds }) }, ["presetId"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_add_revolve_body",
    "Add a lathe body. If presetId is omitted, the current lathe preset selection is used.",
    objectSchema({ presetId: stringSchema("Optional revolve preset id.", { enum: revolvePresetIds }) })
  ),
  defineAction(ASSISTANT_PAGES.PARTS, "parts_add_spur_gear", "Add the page's default spur gear body.", emptyObjectSchema),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_set_boolean_operation",
    "Select the boolean operation used by the Create Boolean Body button.",
    objectSchema({ operation: stringSchema("Boolean operation.", { enum: booleanOperations }) }, ["operation"])
  ),
  defineAction(
    ASSISTANT_PAGES.PARTS,
    "parts_add_boolean_body",
    "Create a boolean result body using the same selected-body operand behavior as the page.",
    objectSchema({ operation: stringSchema("Optional boolean operation.", { enum: booleanOperations }) })
  )
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
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_export_urdf", "Download the URDF robot description when preflight has no blocking issues.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Run URDF preflight and download the robot description if ready."
  }),
  defineAction(ASSISTANT_PAGES.WORKBENCH, "workbench_toggle_simulation_run", "Start or pause continuous simulation.", emptyObjectSchema, {
    safety: ACTION_SAFETY.GUARDED,
    confirmation: "Start or pause continuous simulation."
  })
];

export const ASSISTANT_ACTIONS = Object.freeze([...studioActions, ...partsActions, ...workbenchActions]);

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
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path} must match ${schema.pattern}`);
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
