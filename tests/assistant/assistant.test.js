import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createAssistantAttachmentStore } from "../../src/assistant/attachments.js";
import {
  ACTION_SAFETY,
  ASSISTANT_PAGES,
  getActionDefinition,
  getActionsForPage,
  toolsForPage,
  validateActionArguments
} from "../../src/assistant/actionCatalog.js";
import {
  ASSISTANT_MODELS,
  defaultAssistantModelId,
  defaultReasoningEffortForModel,
  getAssistantModel,
  isSupportedAssistantModel,
  isSupportedReasoningEffort,
  reasoningEffortsForModel
} from "../../src/assistant/modelCatalog.js";
import { createPageAssistantAdapter } from "../../src/assistant/pageAdapter.js";
import {
  buildResponsesRequest,
  createAssistantProxyMiddleware,
  extractAssistantResponse
} from "../../src/assistant/serverProxy.js";
import { formatResponseMetrics } from "../../src/assistant/metrics.js";
import { clampAssistantPosition } from "../../src/assistant/drag.js";
import { listPartTemplates } from "../../src/parts/templates.js";
import {
  assistantConversationFileName,
  buildAssistantConversationTranscript,
  formatAssistantMessageTimestamp
} from "../../src/assistant/conversationTranscript.js";
import {
  ASSISTANT_EVAL_MODEL,
  ASSISTANT_EVAL_REASONING_EFFORT,
  evaluateScenarioResult,
  getAssistantEvalScenarios,
  requiredCallsMissing
} from "../../src/assistant/evalScenarios.js";
import {
  MAX_ASSISTANT_TOOL_ROUNDS,
  addUsageTotals,
  aggregateUsage,
  normalizeUsage,
  runAssistantTurn
} from "../../src/assistant/turnRunner.js";

test("assistant model catalog exposes only requested model ids", () => {
  assert.deepEqual(
    ASSISTANT_MODELS.map((model) => model.id),
    ["gpt-5.5", "gpt-5.4-mini"]
  );
  assert.equal(defaultAssistantModelId(), "gpt-5.5");
  assert.equal(isSupportedAssistantModel("gpt-5.5"), true);
  assert.equal(isSupportedAssistantModel("gpt-5.4-mini"), true);
  assert.equal(isSupportedAssistantModel("gpt-4o-mini"), false);
  assert.equal(getAssistantModel("gpt-5.4-mini").reasoning.effort, "low");
  assert.deepEqual(reasoningEffortsForModel("gpt-5.5"), ["none", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(reasoningEffortsForModel("gpt-5.4-mini"), ["none", "low", "medium", "high", "xhigh"]);
  assert.equal(defaultReasoningEffortForModel("gpt-5.5"), "medium");
  assert.equal(defaultReasoningEffortForModel("gpt-5.4-mini"), "low");
  assert.equal(isSupportedReasoningEffort("gpt-5.4-mini", "xhigh"), true);
  assert.equal(isSupportedReasoningEffort("gpt-5.4-mini", "minimal"), false);
});

test("action registry separates safe and guarded page actions", () => {
  const studioActions = getActionsForPage(ASSISTANT_PAGES.STUDIO);
  const partsActions = getActionsForPage(ASSISTANT_PAGES.PARTS);
  const workbenchActions = getActionsForPage(ASSISTANT_PAGES.WORKBENCH);
  const electronicsActions = getActionsForPage(ASSISTANT_PAGES.ELECTRONICS);
  const circuitLabActions = getActionsForPage(ASSISTANT_PAGES.CIRCUITS);

  assert.ok(studioActions.some((action) => action.name === "studio_set_mode"));
  assert.ok(studioActions.some((action) => action.name === "studio_resize_selected_part"));
  assert.ok(studioActions.some((action) => action.name === "studio_detect_features"));
  assert.ok(studioActions.some((action) => action.name === "studio_select_feature"));
  assert.ok(studioActions.some((action) => action.name === "studio_set_measurement_pick_target"));
  assert.ok(studioActions.some((action) => action.name === "studio_apply_feature_edit"));
  assert.ok(studioActions.some((action) => action.name === "studio_apply_feature_spacing"));
  assert.ok(studioActions.some((action) => action.name === "studio_export_glb"));
  assert.ok(studioActions.some((action) => action.name === "studio_clear_scene"));
  assert.ok(partsActions.some((action) => action.name === "parts_add_template_body"));
  assert.ok(partsActions.some((action) => action.name === "parts_create_custom_sketch_body"));
  assert.ok(partsActions.some((action) => action.name === "parts_replace_sketch_body"));
  assert.ok(partsActions.some((action) => action.name === "parts_create_advanced_cad_body"));
  assert.ok(partsActions.some((action) => action.name === "parts_replace_advanced_cad_body"));
  assert.ok(partsActions.some((action) => action.name === "parts_export_selected_step"));
  assert.ok(partsActions.some((action) => action.name === "parts_resize_body"));
  assert.ok(partsActions.some((action) => action.name === "parts_save_selected_to_library"));
  assert.ok(partsActions.some((action) => action.name === "parts_add_library_item"));
  assert.ok(partsActions.some((action) => action.name === "parts_export_selected_stl"));
  assert.ok(workbenchActions.some((action) => action.name === "workbench_step_simulation"));
  assert.ok(workbenchActions.some((action) => action.name === "workbench_delete_proxy"));
  assert.ok(workbenchActions.some((action) => action.name === "workbench_get_mechatronics_readiness"));
  assert.ok(workbenchActions.some((action) => action.name === "workbench_apply_semantic_channel"));
  assert.ok(electronicsActions.some((action) => action.name === "electronics_add_component"));
  assert.ok(electronicsActions.some((action) => action.name === "electronics_connect_pins"));
  assert.ok(electronicsActions.some((action) => action.name === "electronics_export_firmware_zip"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_add_hardware"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_connect_terminals"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_resize_component"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_rotate_component"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_run_test"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_get_readiness"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_get_binding_status"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_preview_binding_suggestions"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_get_pin_map"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_get_harness"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_get_bom"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_get_build_checklist"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_set_actuator_binding"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_set_sensor_binding"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_set_firmware_channel"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_remove_binding"));
  assert.ok(circuitLabActions.some((action) => action.name === "circuits_export_build_guide"));

  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_set_mode").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_detect_features").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_select_feature").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_set_measurement_pick_target").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_apply_feature_edit").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_apply_feature_spacing").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_export_glb").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_clear_scene").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_add_template_body").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_create_custom_sketch_body").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_replace_sketch_body").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_create_advanced_cad_body").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_replace_advanced_cad_body").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_export_selected_step").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_add_library_item").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_new_project").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_save_selected_to_library").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_delete_library_item").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.PARTS, "parts_delete_body").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.WORKBENCH, "workbench_delete_proxy").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.WORKBENCH, "workbench_get_mechatronics_readiness").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.WORKBENCH, "workbench_apply_semantic_channel").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.ELECTRONICS, "electronics_add_component").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.ELECTRONICS, "electronics_run_drc").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.ELECTRONICS, "electronics_export_firmware_zip").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_add_hardware").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_resize_component").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_rotate_component").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_run_test").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_get_readiness").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_set_actuator_binding").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_set_sensor_binding").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_set_firmware_channel").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_remove_binding").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_export_build_guide").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.CIRCUITS, "circuits_apply_starter_template").safety, ACTION_SAFETY.GUARDED);
});

test("action argument validation rejects unknown, unsafe, and malformed input", () => {
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_mode", { mode: "hinge" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_mode", { mode: "resize" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_mode", { mode: "delete" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_measurement_pick_target", { target: "A" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_measurement_pick_target", { target: "C" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_select_feature", { partId: "upper_arm", featureId: "hole_1" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_grid_visible", { visible: "yes" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_set_ik_target", { target: [1, 2, 3] }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_set_ik_target", { target: [1, 2] }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_get_mechatronics_readiness", {}).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_apply_semantic_channel", { channelId: "servo_signal", value: 25 }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_apply_semantic_channel", { channelId: "C:\\robot\\servo", value: 25 }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_add_template_body", { templateId: "link_bar" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_add_template_body", { templateId: "unknown" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_add_library_item", { itemId: "saved_link" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_add_library_item", {}).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_set_body_properties", { color: "#ff0000", scale: [1, 1, 1] }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_resize_body", {
      targetSizeMm: [120, 6, 80],
      uniform: false,
      keepCutSizes: true
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_resize_selected_part", {
      targetSizeMm: [120, 6]
    }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_set_body_properties", { color: "red" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_set_profile", { target: "cut", points: [[1, 2], [3, 4]] }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_create_custom_sketch_body", {
      name: "Custom bracket",
      extrudeDepthMm: 4,
      outerProfile: { type: "polyline", points: [[-20, -10], [20, -10], [0, 25]], closed: true },
      cutProfiles: [{ type: "circle", x: 0, z: 0, radius: 3 }]
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_create_custom_sketch_body", {
      name: "Bad custom",
      extrudeDepthMm: 4,
      outerProfile: { type: "spline", points: [[0, 0], [1, 1], [2, 0]] }
    }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_replace_sketch_body", {
      bodyId: "custom_bracket",
      extrudeDepthMm: 5,
      outerProfile: { type: "rectangle", width: 40, height: 24 }
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_create_advanced_cad_body", {
      name: "Filleted mount",
      advancedCadRecipe: {
        version: 1,
        units: "mm",
        operations: [
          { type: "box", id: "base", size: [60, 6, 30], center: [0, 0, 0] },
          { type: "hole", id: "center_hole", radius: 4, depth: 8, center: [0, 0, 0], axis: "y" },
          { type: "fillet", id: "edge_round", radius: 1.5 }
        ]
      }
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.PARTS, "parts_create_advanced_cad_body", {
      name: "Unsafe advanced",
      advancedCadRecipe: {
        version: 1,
        units: "mm",
        operations: [{ type: "rawPython", code: "print('no')" }]
      }
    }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_unknown", {}).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.ELECTRONICS, "electronics_add_component", { componentId: "led-5mm-red" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.ELECTRONICS, "electronics_add_component", { componentId: "unknown" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.ELECTRONICS, "electronics_connect_pins", {
      endpointA: { type: "board", pinId: "GPIO2" },
      endpointB: { type: "component", instanceId: "led_1", pinId: "anode" }
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_apply_starter_template", { templateId: "arduino_servo_safe" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_apply_starter_template", { templateId: "unknown" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_add_hardware", { componentTypeId: "servo-standard" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_connect_terminals", {
      endpointA: { componentId: "arduino", terminalId: "D9" },
      endpointB: { componentId: "servo", terminalId: "signal" }
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_connect_terminals", {
      endpointA: { type: "component", instanceId: "arduino", pinId: "D9" },
      endpointB: { componentId: "servo", terminalId: "signal" }
    }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_focus_terminal", {
      endpoint: { componentId: "arduino", terminalId: "D9", x: 12 }
    }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_resize_component", { componentId: "servo", scale: 1.25 }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_resize_component", { componentId: "servo", scale: 9 }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_rotate_component", { componentId: "servo", rotationDegrees: 90 }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_rotate_component", { componentId: "servo", rotationDegrees: 360 }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_get_pin_map", {}).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_set_firmware_channel", {
      channelId: "servo_signal",
      semanticRole: "joint.command.position",
      direction: "controller-to-device",
      signalType: "servo-pulse",
      valueType: "number",
      controllerTerminalRef: { componentId: "arduino", terminalId: "D9" },
      deviceTerminalRef: { componentId: "servo", terminalId: "signal" }
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_set_firmware_channel", {
      channelId: "servo_signal",
      semanticRole: "joint.command.position",
      direction: "controller-to-device",
      signalType: "servo-pulse",
      valueType: "number",
      controllerTerminalRef: { componentId: "arduino", terminalId: "D9", selector: "#pin" },
      deviceTerminalRef: { componentId: "servo", terminalId: "signal" }
    }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_set_actuator_binding", {
      jointId: "shoulder",
      actuatorId: "servo_20kg",
      circuitComponentId: "servo",
      firmwareChannelIds: ["servo_signal"],
      commandTransform: { invert: false, scale: 1, offset: 0 }
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_set_actuator_binding", {
      jointId: "shoulder",
      actuatorId: "servo_20kg",
      circuitComponentId: "servo",
      firmwareChannelIds: ["C:/robot/servo"]
    }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_set_sensor_binding", {
      sensorId: "distance_1",
      circuitComponentId: "ultrasonic",
      firmwareChannelIds: ["distance_echo"]
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_remove_binding", {
      targetType: "firmwareChannel",
      targetId: "servo_signal"
    }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.CIRCUITS, "circuits_remove_binding", {
      targetType: "component",
      targetId: "servo_signal"
    }).ok,
    false
  );
});

test("tool schemas are generated from the central action registry", () => {
  const tools = toolsForPage(ASSISTANT_PAGES.STUDIO);
  const setMode = tools.find((tool) => tool.name === "studio_set_mode");

  assert.ok(setMode);
  assert.equal(setMode.type, "function");
  assert.deepEqual(setMode.parameters.properties.mode.enum, ["select", "move", "rotate", "resize", "measure", "feature", "hinge"]);
  assert.equal(tools.some((tool) => tool.name === "workbench_set_mode"), false);

  const partsTools = toolsForPage(ASSISTANT_PAGES.PARTS);
  const addTemplate = partsTools.find((tool) => tool.name === "parts_add_template_body");
  assert.ok(addTemplate);
  assert.deepEqual(
    addTemplate.parameters.properties.templateId.enum,
    listPartTemplates().map((template) => template.id)
  );
  assert.equal(partsTools.some((tool) => tool.name === "studio_set_mode"), false);
  assert.ok(partsTools.some((tool) => tool.name === "parts_resize_body"));
  assert.ok(partsTools.some((tool) => tool.name === "parts_create_custom_sketch_body"));
  assert.ok(partsTools.some((tool) => tool.name === "parts_replace_sketch_body"));
  assert.ok(partsTools.some((tool) => tool.name === "parts_create_advanced_cad_body"));
  assert.ok(partsTools.some((tool) => tool.name === "parts_export_selected_step"));
  assert.ok(partsTools.some((tool) => tool.name === "parts_save_selected_to_library"));
  assert.ok(partsTools.some((tool) => tool.name === "parts_add_library_item"));

  const electronicsTools = toolsForPage(ASSISTANT_PAGES.ELECTRONICS);
  assert.ok(electronicsTools.some((tool) => tool.name === "electronics_connect_pins"));
  assert.ok(electronicsTools.some((tool) => tool.name === "electronics_generate_code"));
  assert.equal(electronicsTools.some((tool) => tool.name === "studio_set_mode"), false);

  const circuitLabTools = toolsForPage(ASSISTANT_PAGES.CIRCUITS);
  assert.ok(circuitLabTools.some((tool) => tool.name === "circuits_connect_terminals"));
  assert.ok(circuitLabTools.some((tool) => tool.name === "circuits_resize_component"));
  assert.ok(circuitLabTools.some((tool) => tool.name === "circuits_rotate_component"));
  assert.ok(circuitLabTools.some((tool) => tool.name === "circuits_get_readiness"));
  assert.ok(circuitLabTools.some((tool) => tool.name === "circuits_set_firmware_channel"));
  assert.ok(circuitLabTools.some((tool) => tool.name === "circuits_export_build_guide"));
  assert.ok(circuitLabTools.some((tool) => tool.name === "circuits_generate_source"));
  assert.equal(circuitLabTools.some((tool) => tool.name === "electronics_connect_pins"), false);

  const workbenchTools = toolsForPage(ASSISTANT_PAGES.WORKBENCH);
  assert.ok(workbenchTools.some((tool) => tool.name === "workbench_get_mechatronics_readiness"));
  assert.ok(workbenchTools.some((tool) => tool.name === "workbench_apply_semantic_channel"));
  assert.equal(workbenchTools.some((tool) => tool.name === "circuits_set_firmware_channel"), false);
});

test("Responses request builder uses model catalog, tools, previous response id, and tool outputs", () => {
  const firstTurn = buildResponsesRequest({
    model: "gpt-5.5",
    pageId: ASSISTANT_PAGES.STUDIO,
    pageContext: { mode: "hinge" },
    previousResponseId: "resp_previous",
    reasoningEffort: "high",
    message: "Set the elbow to 30 degrees"
  });

  assert.equal(firstTurn.model, "gpt-5.5");
  assert.equal(firstTurn.previous_response_id, "resp_previous");
  assert.equal(firstTurn.parallel_tool_calls, false);
  assert.equal(Object.hasOwn(firstTurn, "max_output_tokens"), false);
  assert.equal(firstTurn.reasoning.effort, "high");
  assert.ok(firstTurn.tools.some((tool) => tool.name === "studio_set_joint_angle"));
  assert.match(firstTurn.input[0].content[0].text, /Current page context/);

  const toolTurn = buildResponsesRequest({
    model: "gpt-5.4-mini",
    pageId: ASSISTANT_PAGES.WORKBENCH,
    previousResponseId: "resp_tools",
    reasoningEffort: "low",
    toolOutputs: [{ callId: "call_1", output: { ok: true, message: "Done" } }]
  });

  assert.equal(toolTurn.model, "gpt-5.4-mini");
  assert.equal(toolTurn.previous_response_id, "resp_tools");
  assert.equal(toolTurn.input[0].type, "function_call_output");
  assert.equal(toolTurn.input[0].call_id, "call_1");
  assert.ok(toolTurn.tools.some((tool) => tool.name === "workbench_step_simulation"));

  const partsTurn = buildResponsesRequest({
    model: "gpt-5.5",
    pageId: ASSISTANT_PAGES.PARTS,
    reasoningEffort: "medium",
    pageContext: { selection: null },
    message: "Add a link bar"
  });
  assert.ok(partsTurn.instructions.includes("Robotic Component Builder"));
  assert.ok(partsTurn.instructions.includes("design a custom sketch-extrude body"));
  assert.ok(partsTurn.instructions.includes("declarative advanced CAD recipe"));
  assert.ok(partsTurn.tools.some((tool) => tool.name === "parts_add_template_body"));
  assert.ok(partsTurn.tools.some((tool) => tool.name === "parts_create_custom_sketch_body"));
  assert.ok(partsTurn.tools.some((tool) => tool.name === "parts_add_library_item"));
  assert.equal(partsTurn.tools.some((tool) => tool.name === "workbench_step_simulation"), false);

  const electronicsTurn = buildResponsesRequest({
    model: "gpt-5.5",
    pageId: ASSISTANT_PAGES.ELECTRONICS,
    reasoningEffort: "medium",
    pageContext: { board: { id: "esp32-devkitc-v4" } },
    message: "Add a button and run DRC"
  });
  assert.ok(electronicsTurn.instructions.includes("Electronics Studio"));
  assert.ok(electronicsTurn.instructions.includes("Run electronics DRC"));
  assert.ok(electronicsTurn.tools.some((tool) => tool.name === "electronics_add_component"));
  assert.ok(electronicsTurn.tools.some((tool) => tool.name === "electronics_run_drc"));

  const circuitLabTurn = buildResponsesRequest({
    model: "gpt-5.5",
    pageId: ASSISTANT_PAGES.CIRCUITS,
    reasoningEffort: "medium",
    pageContext: { summary: { controller: "Arduino Uno R3" } },
    message: "Add a servo and run the wiring test"
  });
  assert.ok(circuitLabTurn.instructions.includes("Circuit Lab"));
  assert.ok(circuitLabTurn.instructions.includes("do not use Circuitiny"));
  assert.ok(circuitLabTurn.instructions.includes("source-only"));
  assert.ok(circuitLabTurn.tools.some((tool) => tool.name === "circuits_add_hardware"));
  assert.ok(circuitLabTurn.tools.some((tool) => tool.name === "circuits_resize_component"));
  assert.ok(circuitLabTurn.tools.some((tool) => tool.name === "circuits_rotate_component"));
  assert.ok(circuitLabTurn.tools.some((tool) => tool.name === "circuits_run_test"));

  const fileTurn = buildResponsesRequest({
    model: "gpt-5.4-mini",
    pageId: ASSISTANT_PAGES.PARTS,
    reasoningEffort: "low",
    pageContext: { selection: null },
    message: "Use the uploaded sketch notes.",
    fileInputs: [{ fileId: "file_uploaded", name: "sketch-notes.pdf", inputKind: "file" }]
  });
  assert.equal(fileTurn.input[0].content[0].type, "input_file");
  assert.equal(fileTurn.input[0].content[0].file_id, "file_uploaded");
  assert.equal(fileTurn.input[0].content[1].type, "input_text");
  assert.match(fileTurn.input[0].content[1].text, /Attached files: sketch-notes\.pdf/);
  assert.match(fileTurn.input[0].content[1].text, /User request:/);

  const mixedAttachmentTurn = buildResponsesRequest({
    model: "gpt-5.4-mini",
    pageId: ASSISTANT_PAGES.PARTS,
    reasoningEffort: "low",
    pageContext: { selection: null },
    message: "Use both attachments.",
    fileInputs: [
      { fileId: "file_image", name: "part-photo.png", inputKind: "image" },
      { fileId: "file_notes", name: "sketch-notes.pdf", inputKind: "file" }
    ]
  });
  assert.equal(mixedAttachmentTurn.input[0].content[0].type, "input_image");
  assert.equal(mixedAttachmentTurn.input[0].content[0].file_id, "file_image");
  assert.equal(mixedAttachmentTurn.input[0].content[0].detail, "auto");
  assert.equal(mixedAttachmentTurn.input[0].content[1].type, "input_file");
  assert.equal(mixedAttachmentTurn.input[0].content[1].file_id, "file_notes");
  assert.equal(mixedAttachmentTurn.input[0].content[2].type, "input_text");
  assert.match(mixedAttachmentTurn.input[0].content[2].text, /Attached files: part-photo\.png, sketch-notes\.pdf/);
});

test("Responses request builder rejects unsupported models, pages, and efforts", () => {
  assert.throws(
    () => buildResponsesRequest({ model: "gpt-4o-mini", pageId: ASSISTANT_PAGES.STUDIO, message: "hi" }),
    /Unsupported assistant model/
  );
  assert.throws(
    () => buildResponsesRequest({ model: "gpt-5.5", pageId: "other", message: "hi" }),
    /Unsupported assistant page/
  );
  assert.throws(
    () =>
      buildResponsesRequest({
        model: "gpt-5.5",
        pageId: ASSISTANT_PAGES.STUDIO,
        reasoningEffort: "minimal",
        message: "hi"
      }),
    /Unsupported reasoning effort/
  );
});

test("assistant response extraction handles text and function calls", () => {
  const extracted = extractAssistantResponse({
    id: "resp_123",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "I will update it." }]
      },
      {
        type: "function_call",
        call_id: "call_abc",
        name: "studio_set_mode",
        arguments: "{\"mode\":\"move\"}"
      }
    ]
  });

  assert.equal(extracted.responseId, "resp_123");
  assert.equal(extracted.text, "I will update it.");
  assert.equal(extracted.usage, null);
  assert.deepEqual(extracted.toolCalls, [
    { callId: "call_abc", name: "studio_set_mode", arguments: { mode: "move" }, rawArguments: "{\"mode\":\"move\"}" }
  ]);
});

test("page assistant adapter validates and executes registered actions", async () => {
  const calls = [];
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ mode: "hinge" }),
    actions: {
      studio_set_mode: async (args) => {
        calls.push(args);
        return "mode updated";
      }
    }
  });

  assert.deepEqual(adapter.getContext(), { mode: "hinge" });
  assert.deepEqual(await adapter.executeAction("studio_set_mode", { mode: "move" }), {
    ok: true,
    action: "studio_set_mode",
    message: "mode updated",
    data: undefined
  });
  assert.deepEqual(calls, [{ mode: "move" }]);
  await assert.rejects(() => adapter.executeAction("studio_set_mode", { mode: "bad" }), /must be one of/);
  await assert.rejects(() => adapter.executeAction("studio_export_glb", {}), /No page handler/);
});

test("assistant proxy uses injected api key provider and returns usage plus latency", async () => {
  const req = new PassThrough();
  req.method = "POST";

  const responsePromise = new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(content) {
        resolve({ statusCode: this.statusCode, headers: this.headers, content });
      }
    };

    const middleware = createAssistantProxyMiddleware({
      apiKeyProvider: () => "fake-test-key",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        assert.equal(options.headers.authorization, "Bearer fake-test-key");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "gpt-5.4-mini");
        assert.equal(body.reasoning.effort, "low");
        return new Response(
          JSON.stringify({
            id: "resp_test",
            status: "completed",
            output_text: "Connected.",
            output: [],
            usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    middleware(req, res);
  });

  req.end(
    JSON.stringify({
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      pageId: ASSISTANT_PAGES.STUDIO,
      pageContext: {},
      message: "hello"
    })
  );

  const response = await responsePromise;
  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.content);
  assert.equal(parsed.responseId, "resp_test");
  assert.equal(parsed.text, "Connected.");
  assert.equal(parsed.usage.total_tokens, 13);
  assert.equal(Number.isFinite(parsed.latencyMs), true);
});

test("assistant proxy uploads staged files with user_data purpose and reuses cached file ids", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "robostudio-assistant-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const attachmentStore = createAssistantAttachmentStore({ tempRoot });
  const staged = await attachmentStore.stageFile({
    name: "C:\\robot\\sketch-notes.txt",
    type: "text/plain",
    data: Buffer.from("mounting notes")
  });
  let uploadCalls = 0;
  let responseCalls = 0;
  let deleteCalls = 0;

  const fetchImpl = async (url, options) => {
    if (url === "https://api.openai.com/v1/files") {
      uploadCalls += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer fake-test-key");
      assert.equal(options.body.get("purpose"), "user_data");
      const file = options.body.get("file");
      assert.equal(file.name, "sketch-notes.txt");
      assert.equal(file.type, "text/plain");
      assert.equal(await file.text(), "mounting notes");
      return new Response(JSON.stringify({ id: "file_cached" }), { status: 200 });
    }
    if (url === "https://api.openai.com/v1/responses") {
      responseCalls += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.input[0].content[0].type, "input_file");
      assert.equal(body.input[0].content[0].file_id, "file_cached");
      assert.match(body.input[0].content[1].text, /Attached files: sketch-notes\.txt/);
      return new Response(
        JSON.stringify({
          id: `resp_file_${responseCalls}`,
          output_text: "Read the file.",
          output: [],
          usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 }
        }),
        { status: 200 }
      );
    }
    if (url === "https://api.openai.com/v1/files/file_cached") {
      deleteCalls += 1;
      assert.equal(options.method, "DELETE");
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const middleware = createAssistantProxyMiddleware({
    apiKeyProvider: () => "fake-test-key",
    attachmentStore,
    fetchImpl
  });

  async function postAssistant(payload) {
    const req = new PassThrough();
    req.method = "POST";
    const responsePromise = new Promise((resolve) => {
      const res = {
        statusCode: 0,
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        },
        end(content) {
          resolve({ statusCode: this.statusCode, headers: this.headers, content });
        }
      };
      middleware(req, res);
    });
    req.end(JSON.stringify(payload));
    const response = await responsePromise;
    assert.equal(response.statusCode, 200);
    return JSON.parse(response.content);
  }

  const payload = {
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    pageId: ASSISTANT_PAGES.PARTS,
    pageContext: {},
    message: "Use the attached sketch notes.",
    attachmentIds: [staged.id]
  };
  await postAssistant(payload);
  await postAssistant({ ...payload, previousResponseId: "resp_file_1" });

  assert.equal(uploadCalls, 1);
  assert.equal(responseCalls, 2);

  await attachmentStore.cleanupAttachmentIds([staged.id], {
    apiKey: "fake-test-key",
    fetchImpl
  });
  assert.equal(deleteCalls, 1);
});

test("assistant proxy uploads PNG images with vision purpose and sends input_image", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "robostudio-assistant-image-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const attachmentStore = createAssistantAttachmentStore({ tempRoot });
  const staged = await attachmentStore.stageFile({
    name: "C:\\robot\\part-photo.png",
    type: "image/png",
    data: Buffer.from("fake png bytes")
  });
  let uploadCalls = 0;
  let responseCalls = 0;
  let deleteCalls = 0;

  const fetchImpl = async (url, options) => {
    if (url === "https://api.openai.com/v1/files") {
      uploadCalls += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer fake-test-key");
      assert.equal(options.body.get("purpose"), "vision");
      const file = options.body.get("file");
      assert.equal(file.name, "part-photo.png");
      assert.equal(file.type, "image/png");
      assert.equal(await file.text(), "fake png bytes");
      return new Response(JSON.stringify({ id: "file_png_cached" }), { status: 200 });
    }
    if (url === "https://api.openai.com/v1/responses") {
      responseCalls += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.input[0].content[0].type, "input_image");
      assert.equal(body.input[0].content[0].file_id, "file_png_cached");
      assert.equal(body.input[0].content[0].detail, "auto");
      assert.equal(body.input[0].content[1].type, "input_text");
      assert.match(body.input[0].content[1].text, /Attached files: part-photo\.png/);
      return new Response(
        JSON.stringify({
          id: `resp_png_${responseCalls}`,
          output_text: "Read the image.",
          output: [],
          usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 }
        }),
        { status: 200 }
      );
    }
    if (url === "https://api.openai.com/v1/files/file_png_cached") {
      deleteCalls += 1;
      assert.equal(options.method, "DELETE");
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const middleware = createAssistantProxyMiddleware({
    apiKeyProvider: () => "fake-test-key",
    attachmentStore,
    fetchImpl
  });

  const req = new PassThrough();
  req.method = "POST";
  const responsePromise = new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(content) {
        resolve({ statusCode: this.statusCode, headers: this.headers, content });
      }
    };
    middleware(req, res);
  });
  req.end(
    JSON.stringify({
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      pageId: ASSISTANT_PAGES.PARTS,
      pageContext: {},
      message: "Use the attached photo.",
      attachmentIds: [staged.id]
    })
  );

  const response = await responsePromise;
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.content).responseId, "resp_png_1");
  assert.equal(uploadCalls, 1);
  assert.equal(responseCalls, 1);

  await attachmentStore.cleanupAttachmentIds([staged.id], {
    apiKey: "fake-test-key",
    fetchImpl
  });
  assert.equal(deleteCalls, 1);
});

test("assistant attachment store treats PNG extension as image when MIME is missing", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "robostudio-assistant-ext-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const attachmentStore = createAssistantAttachmentStore({ tempRoot });
  const staged = await attachmentStore.stageFile({
    name: "uploaded.PNG",
    type: "",
    data: Buffer.from("fake png bytes")
  });
  let uploadCalls = 0;
  let deleteCalls = 0;

  const fetchImpl = async (url, options) => {
    if (url === "https://api.openai.com/v1/files") {
      uploadCalls += 1;
      assert.equal(options.body.get("purpose"), "vision");
      const file = options.body.get("file");
      assert.equal(file.name, "uploaded.PNG");
      assert.equal(file.type, "application/octet-stream");
      return new Response(JSON.stringify({ id: "file_ext_png" }), { status: 200 });
    }
    if (url === "https://api.openai.com/v1/files/file_ext_png") {
      deleteCalls += 1;
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const fileInputs = await attachmentStore.openAiFileInputsForIds([staged.id], {
    apiKey: "fake-test-key",
    fetchImpl
  });
  assert.equal(uploadCalls, 1);
  assert.deepEqual(fileInputs, [
    {
      fileId: "file_ext_png",
      name: "uploaded.PNG",
      type: "application/octet-stream",
      size: "fake png bytes".length,
      inputKind: "image"
    }
  ]);

  await attachmentStore.cleanupAttachmentIds([staged.id], {
    apiKey: "fake-test-key",
    fetchImpl
  });
  assert.equal(deleteCalls, 1);
});

test("assistant usage helpers normalize response and conversation token totals", () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 4, completion_tokens: 6 }), {
    input_tokens: 4,
    output_tokens: 6,
    total_tokens: 10
  });
  assert.deepEqual(
    aggregateUsage([
      { usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } },
      { usage: { prompt_tokens: 4, completion_tokens: 6 } },
      { usage: null }
    ]),
    { input_tokens: 14, output_tokens: 9, total_tokens: 23 }
  );
  assert.deepEqual(
    addUsageTotals(
      { input_tokens: 14, output_tokens: 9, total_tokens: 23 },
      { input_tokens: 5, output_tokens: 2, total_tokens: 7 }
    ),
    { input_tokens: 19, output_tokens: 11, total_tokens: 30 }
  );
  assert.equal(aggregateUsage([{ usage: {} }]), null);
  assert.equal(
    formatResponseMetrics(
      { latencyMs: 125, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } },
      { input_tokens: 19, output_tokens: 11, total_tokens: 30 }
    ),
    "Last response: 125 ms / 7 tokens | Conversation total: 30 tokens"
  );
});

test("assistant conversation helpers format timestamps and export transcripts", () => {
  const now = new Date(2026, 4, 26, 15, 10, 0);
  assert.equal(formatAssistantMessageTimestamp(new Date(2026, 4, 26, 14, 5, 0), now), "Today, 2:05 PM");
  assert.equal(formatAssistantMessageTimestamp(new Date(2026, 4, 25, 9, 0, 0), now), "Yesterday, 9:00 AM");
  assert.equal(formatAssistantMessageTimestamp(new Date(2026, 0, 3, 18, 30, 0), now), "Jan 3, 6:30 PM");
  assert.equal(formatAssistantMessageTimestamp(new Date(2025, 11, 31, 23, 59, 0), now), "Dec 31, 2025, 11:59 PM");

  const transcript = buildAssistantConversationTranscript({
    title: "STL Assembly Studio assistant conversation",
    savedAt: new Date(2026, 4, 26, 15, 10, 0),
    messages: [
      { role: "user", text: "Move the base.", createdAt: new Date(2026, 4, 26, 14, 5, 0) },
      { role: "assistant", text: "Done.", createdAt: new Date(2026, 4, 26, 14, 6, 0) }
    ]
  });

  assert.match(transcript, /STL Assembly Studio assistant conversation/);
  assert.match(transcript, /Messages: 2/);
  assert.match(transcript, /\[May 26, 2026, 2:05 PM\] You/);
  assert.match(transcript, /Move the base\./);
  assert.match(transcript, /\[May 26, 2026, 2:06 PM\] Assistant/);
  assert.equal(
    assistantConversationFileName("STL Assembly Studio", new Date(2026, 4, 26, 15, 10, 9)),
    "stl-assembly-studio-conversation-2026-05-26-15-10-09.txt"
  );
});

test("assistant drag clamp keeps card inside viewport", () => {
  assert.deepEqual(
    clampAssistantPosition({ x: -200, y: -50 }, { width: 900, height: 600 }, { width: 300, height: 220 }),
    { x: 10, y: 10 }
  );
  assert.deepEqual(
    clampAssistantPosition({ x: 850, y: 580 }, { width: 900, height: 600 }, { width: 300, height: 220 }),
    { x: 590, y: 370 }
  );
  assert.deepEqual(
    clampAssistantPosition({ x: 250, y: 180 }, { width: 900, height: 600 }, { width: 300, height: 220 }),
    { x: 250, y: 180 }
  );
});

test("assistant eval scenarios use mini model with high reasoning and validate state", () => {
  assert.equal(ASSISTANT_EVAL_MODEL, "gpt-5.4-mini");
  assert.equal(ASSISTANT_EVAL_REASONING_EFFORT, "high");
  assert.equal(MAX_ASSISTANT_TOOL_ROUNDS, 12);

  const studioScenarios = getAssistantEvalScenarios(ASSISTANT_PAGES.STUDIO);
  const partSetup = studioScenarios.find((scenario) => scenario.id === "studio-part-setup");
  assert.ok(partSetup);
  assert.deepEqual(partSetup.requiredCalls, [
    "studio_set_mode",
    "studio_search_parts",
    "studio_select_part",
    "studio_set_part_opacity"
  ]);

  assert.deepEqual(requiredCallsMissing(
    [{ name: "studio_set_mode" }, { name: "studio_search_parts" }],
    ["studio_set_mode", "studio_select_part"]
  ), ["studio_select_part"]);

  const summary = evaluateScenarioResult(
    partSetup,
    {
      toolCalls: partSetup.requiredCalls.map((name) => ({ name })),
      guardedCalls: [],
      stoppedForMaxRounds: false,
      latencyMs: 500,
      usage: { total_tokens: 100 },
      finalText: "Done."
    },
    {
      mode: "rotate",
      search: "upper",
      selection: { id: "upper_arm", opacityPercent: 55 }
    }
  );
  assert.equal(summary.pass, true);
  assert.equal(summary.usage.total_tokens, 100);

  const partsScenarios = getAssistantEvalScenarios(ASSISTANT_PAGES.PARTS);
  const templateEdit = partsScenarios.find((scenario) => scenario.id === "parts-template-edit");
  assert.ok(templateEdit);
  assert.deepEqual(templateEdit.requiredCalls, [
    "parts_add_template_body",
    "parts_select_body",
    "parts_set_body_properties"
  ]);

  const partsSummary = evaluateScenarioResult(
    templateEdit,
    {
      toolCalls: templateEdit.requiredCalls.map((name) => ({ name })),
      guardedCalls: [],
      stoppedForMaxRounds: false,
      latencyMs: 450,
      usage: { total_tokens: 90 },
      finalText: "Done."
    },
    {
      page: "Robotic Component Builder",
      selection: {
        id: "link_bar",
        name: "Test link",
        color: "#ff0000",
        extrudeDepthMm: 7,
        transform: { position: [5, 0, 0] }
      }
    }
  );
  assert.equal(partsSummary.pass, true);

  const customSketch = partsScenarios.find((scenario) => scenario.id === "parts-custom-propeller-like");
  assert.ok(customSketch);
  assert.deepEqual(customSketch.requiredCalls, ["parts_create_custom_sketch_body"]);
});

test("assistant turn runner stages guarded actions without executing them", async () => {
  let executed = false;
  const payloads = [];
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ ready: true }),
    actions: {
      studio_export_glb: () => {
        executed = true;
      }
    }
  });

  const result = await runAssistantTurn({
    adapter,
    model: ASSISTANT_EVAL_MODEL,
    reasoningEffort: ASSISTANT_EVAL_REASONING_EFFORT,
    message: "Export the GLB.",
    attachmentIds: ["attachment_local"],
    requestAssistant: async (payload) => {
      payloads.push(payload);
      if (payload.message) {
        return {
          responseId: "resp_guarded",
          text: "",
          toolCalls: [{ callId: "call_export", name: "studio_export_glb", arguments: {} }]
        };
      }
      return { responseId: "resp_final", text: "Queued.", toolCalls: [], usage: { total_tokens: 12 } };
    }
  });

  assert.equal(executed, false);
  assert.equal(payloads[0].reasoningEffort, "high");
  assert.deepEqual(payloads[0].attachmentIds, ["attachment_local"]);
  assert.equal(Object.hasOwn(payloads[1], "attachmentIds"), false);
  assert.equal(payloads[1].toolOutputs[0].output.status, "pending_confirmation");
  assert.deepEqual(result.guardedCalls.map((call) => call.name), ["studio_export_glb"]);
  assert.equal(result.finalText, "Queued.");
  assert.equal(result.stopReason, "guarded_confirmation");
});

test("assistant turn runner defers guarded actions without sending a follow-up request", async () => {
  let executed = false;
  const payloads = [];
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ ready: true }),
    actions: {
      studio_export_glb: () => {
        executed = true;
      }
    }
  });

  const result = await runAssistantTurn({
    adapter,
    model: ASSISTANT_EVAL_MODEL,
    reasoningEffort: ASSISTANT_EVAL_REASONING_EFFORT,
    message: "Export the GLB.",
    requestAssistant: async (payload) => {
      payloads.push(payload);
      return {
        responseId: "resp_guarded",
        text: "",
        toolCalls: [{ callId: "call_export", name: "studio_export_glb", arguments: {} }]
      };
    },
    onGuardedToolCall: ({ responseId, label }) => {
      assert.equal(responseId, "resp_guarded");
      assert.equal(label, "Export and download the assembly GLB.");
      return { defer: true };
    }
  });

  assert.equal(executed, false);
  assert.equal(payloads.length, 1);
  assert.equal(Object.hasOwn(payloads[0], "toolOutputs"), false);
  assert.equal(result.stopReason, "guarded_confirmation");
  assert.equal(result.previousResponseId, "resp_guarded");
  assert.deepEqual(result.pendingGuardedCall, {
    responseId: "resp_guarded",
    callId: "call_export",
    name: "studio_export_glb",
    args: {},
    label: "Export and download the assembly GLB."
  });
  assert.equal(result.toolOutputs[0].deferred, true);
});

test("assistant turn runner continues from a guarded tool output and resumes automatic tools", async () => {
  const payloads = [];
  let mode = "";
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ mode }),
    actions: {
      studio_set_mode: ({ mode: nextMode }) => {
        mode = nextMode;
        return `Mode set to ${nextMode}.`;
      }
    }
  });

  const result = await runAssistantTurn({
    adapter,
    model: ASSISTANT_EVAL_MODEL,
    reasoningEffort: ASSISTANT_EVAL_REASONING_EFFORT,
    previousResponseId: "resp_guarded",
    attachmentIds: ["attachment_should_not_resend"],
    toolOutputs: [{ callId: "call_export", output: { ok: true, action: "studio_export_glb", message: "Exported." } }],
    requestAssistant: async (payload) => {
      payloads.push(payload);
      if (payload.toolOutputs?.[0]?.callId === "call_export") {
        return {
          responseId: "resp_after_confirm",
          text: "",
          toolCalls: [{ callId: "call_mode", name: "studio_set_mode", arguments: { mode: "move" } }]
        };
      }
      return { responseId: "resp_final", text: "Done.", toolCalls: [], usage: { total_tokens: 8 } };
    }
  });

  assert.equal(mode, "move");
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].previousResponseId, "resp_guarded");
  assert.equal(payloads[0].toolOutputs[0].callId, "call_export");
  assert.equal(Object.hasOwn(payloads[0], "message"), false);
  assert.equal(Object.hasOwn(payloads[0], "attachmentIds"), false);
  assert.equal(payloads[1].previousResponseId, "resp_after_confirm");
  assert.equal(payloads[1].toolOutputs[0].callId, "call_mode");
  assert.equal(result.finalText, "Done.");
  assert.equal(result.stopReason, null);
});

test("assistant turn runner sends canceled guarded outputs with the original call id", async () => {
  const payloads = [];
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.PARTS,
    title: "Test Parts",
    getContext: () => ({ ready: true }),
    actions: {}
  });

  const result = await runAssistantTurn({
    adapter,
    model: ASSISTANT_EVAL_MODEL,
    reasoningEffort: ASSISTANT_EVAL_REASONING_EFFORT,
    previousResponseId: "resp_guarded",
    toolOutputs: [
      {
        callId: "call_new_project",
        output: {
          ok: false,
          action: "parts_new_project",
          status: "canceled",
          message: "Canceled: Start a new empty PartProject."
        }
      }
    ],
    requestAssistant: async (payload) => {
      payloads.push(payload);
      return { responseId: "resp_cancel", text: "Canceled.", toolCalls: [] };
    }
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].previousResponseId, "resp_guarded");
  assert.equal(payloads[0].toolOutputs[0].callId, "call_new_project");
  assert.equal(payloads[0].toolOutputs[0].output.status, "canceled");
  assert.equal(Object.hasOwn(payloads[0], "message"), false);
  assert.equal(result.finalText, "Canceled.");
});

test("assistant turn runner sends guarded execution errors with the original call id", async () => {
  const payloads = [];
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.PARTS,
    title: "Test Parts",
    getContext: () => ({ ready: true }),
    actions: {}
  });

  const result = await runAssistantTurn({
    adapter,
    model: ASSISTANT_EVAL_MODEL,
    reasoningEffort: ASSISTANT_EVAL_REASONING_EFFORT,
    previousResponseId: "resp_guarded",
    toolOutputs: [
      {
        callId: "call_new_project",
        output: { ok: false, action: "parts_new_project", error: "No page handler is registered for parts_new_project" }
      }
    ],
    requestAssistant: async (payload) => {
      payloads.push(payload);
      return { responseId: "resp_error", text: "Could not continue.", toolCalls: [] };
    }
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].previousResponseId, "resp_guarded");
  assert.equal(payloads[0].toolOutputs[0].callId, "call_new_project");
  assert.equal(payloads[0].toolOutputs[0].output.ok, false);
  assert.match(payloads[0].toolOutputs[0].output.error, /No page handler/);
  assert.equal(Object.hasOwn(payloads[0], "message"), false);
  assert.equal(result.finalText, "Could not continue.");
});

test("assistant turn runner enforces shared tool-round limit", async () => {
  let requestCount = 0;
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ ready: true }),
    actions: {
      studio_set_mode: ({ mode }) => `Mode set to ${mode}.`
    }
  });

  const result = await runAssistantTurn({
    adapter,
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
    message: "Keep changing mode.",
    maxToolRounds: 2,
    requestAssistant: async () => {
      requestCount += 1;
      return {
        responseId: `resp_${requestCount}`,
        text: "",
        toolCalls: [{ callId: `call_${requestCount}`, name: "studio_set_mode", arguments: { mode: "move" } }]
      };
    }
  });

  assert.equal(result.stoppedForMaxRounds, true);
  assert.equal(result.stopReason, "safety_budget");
  assert.equal(result.toolCalls.length, 2);
  assert.equal(requestCount, 3);
});

test("assistant turn runner stops repeated no-progress tool loops", async () => {
  let requestCount = 0;
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ ready: true }),
    actions: {}
  });

  const result = await runAssistantTurn({
    adapter,
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
    message: "Use a missing action repeatedly.",
    requestAssistant: async () => {
      requestCount += 1;
      return {
        responseId: `resp_${requestCount}`,
        text: "",
        toolCalls: [{ callId: `call_${requestCount}`, name: "studio_missing_action", arguments: { value: 1 } }]
      };
    }
  });

  assert.equal(result.stoppedForNoProgress, true);
  assert.equal(result.stopReason, "no_progress");
  assert.equal(result.toolCalls.length, 2);
  assert.equal(requestCount, 2);
});
