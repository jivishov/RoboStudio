import { DEFAULT_BODY_COLOR, createSketchExtrudeBody } from "./contracts.js";
import {
  createCircularHole,
  createCircleProfile,
  createPolylineProfile,
  createRectangleProfile,
  createRoundedSlotProfile,
  createSlottedHole
} from "./sketch.js";

const TEMPLATE_COLORS = Object.freeze({
  base_plate: "#2563eb",
  link_bar: "#0f9f6e",
  servo_mount_plate: "#7c3aed",
  l_bracket: "#b45309",
  u_bracket: "#0891b2",
  spacer_standoff: "#475569",
  axle_shaft: "#64748b",
  gripper_finger: "#c026d3",
  bearing_block_plate: "#1d4ed8",
  motor_face_mount: "#6d28d9",
  servo_horn_disk: "#9333ea",
  wheel_hub_flange: "#0f766e",
  sensor_mount_plate: "#0284c7",
  electronics_tray: "#374151",
  linear_rail_carriage: "#047857",
  triangular_gusset_plate: "#b45309",
  tube_connector_plate: "#0369a1",
  end_effector_palm: "#be185d",
  drive_chassis_side_plate: "#334155",
  quad_motor_arm_plate: "#0e7490"
});

export const PART_TEMPLATES = Object.freeze([
  { id: "base_plate", label: "Base plate", category: "Structure" },
  { id: "link_bar", label: "Link bar", category: "Structure" },
  { id: "l_bracket", label: "L bracket", category: "Structure" },
  { id: "u_bracket", label: "U bracket", category: "Structure" },
  { id: "triangular_gusset_plate", label: "Triangular gusset plate", category: "Structure" },
  { id: "tube_connector_plate", label: "Tube connector plate", category: "Structure" },
  { id: "servo_mount_plate", label: "Servo mount plate", category: "Actuation" },
  { id: "motor_face_mount", label: "Motor face mount", category: "Actuation" },
  { id: "servo_horn_disk", label: "Servo horn disk", category: "Actuation" },
  { id: "spacer_standoff", label: "Spacer / standoff", category: "Motion" },
  { id: "axle_shaft", label: "Axle / shaft", category: "Motion" },
  { id: "bearing_block_plate", label: "Bearing block plate", category: "Motion" },
  { id: "wheel_hub_flange", label: "Wheel hub flange", category: "Motion" },
  { id: "linear_rail_carriage", label: "Linear rail carriage", category: "Motion" },
  { id: "sensor_mount_plate", label: "Sensor mount plate", category: "Sensors / Electronics" },
  { id: "electronics_tray", label: "Electronics tray", category: "Sensors / Electronics" },
  { id: "gripper_finger", label: "Gripper finger", category: "End Effectors" },
  { id: "end_effector_palm", label: "End effector palm", category: "End Effectors" },
  { id: "drive_chassis_side_plate", label: "Drive chassis side plate", category: "Mobile / Aerial" },
  { id: "quad_motor_arm_plate", label: "Quad motor arm plate", category: "Mobile / Aerial" }
]);

function bodyFromSketch(templateId, name, sketch, options = {}) {
  return createSketchExtrudeBody(
    {
      id: templateId,
      name,
      color: TEMPLATE_COLORS[templateId] ?? DEFAULT_BODY_COLOR,
      extrudeDepthMm: options.extrudeDepthMm ?? 6,
      sketch
    },
    options.existingIds
  );
}

function boltCircleHoles(idPrefix, count, radius, holeRadius, options = {}) {
  const startAngleDeg = options.startAngleDeg ?? 0;
  return Array.from({ length: count }, (_item, index) => {
    const angle = ((startAngleDeg + (360 * index) / count) * Math.PI) / 180;
    return createCircularHole({
      id: `${idPrefix}_${index + 1}`,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      radius: holeRadius
    });
  });
}

const TEMPLATE_BUILDERS = {
  base_plate(options = {}) {
    return bodyFromSketch(
      "base_plate",
      "Base plate",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 120, height: 80, cornerRadius: 4 }),
        cutProfiles: [
          createCircularHole({ id: "mount_hole_1", x: -48, z: -28, radius: 3.2 }),
          createCircularHole({ id: "mount_hole_2", x: 48, z: -28, radius: 3.2 }),
          createCircularHole({ id: "mount_hole_3", x: 48, z: 28, radius: 3.2 }),
          createCircularHole({ id: "mount_hole_4", x: -48, z: 28, radius: 3.2 })
        ]
      },
      { ...options, extrudeDepthMm: 6 }
    );
  },
  link_bar(options = {}) {
    return bodyFromSketch(
      "link_bar",
      "Link bar",
      {
        outerProfile: createRoundedSlotProfile({ id: "outer", length: 140, width: 24 }),
        cutProfiles: [
          createCircularHole({ id: "pivot_hole_a", x: -50, z: 0, radius: 4.2 }),
          createCircularHole({ id: "pivot_hole_b", x: 50, z: 0, radius: 4.2 })
        ]
      },
      { ...options, extrudeDepthMm: 5 }
    );
  },
  servo_mount_plate(options = {}) {
    return bodyFromSketch(
      "servo_mount_plate",
      "Servo mount plate",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 72, height: 54, cornerRadius: 3 }),
        cutProfiles: [
          createRectangleProfile({ id: "servo_window", x: 0, z: 0, width: 42, height: 22, cornerRadius: 1.5 }),
          createCircularHole({ id: "servo_hole_1", x: -28, z: -20, radius: 2.3 }),
          createCircularHole({ id: "servo_hole_2", x: 28, z: -20, radius: 2.3 }),
          createCircularHole({ id: "servo_hole_3", x: 28, z: 20, radius: 2.3 }),
          createCircularHole({ id: "servo_hole_4", x: -28, z: 20, radius: 2.3 })
        ]
      },
      { ...options, extrudeDepthMm: 4 }
    );
  },
  l_bracket(options = {}) {
    return bodyFromSketch(
      "l_bracket",
      "L bracket",
      {
        outerProfile: createPolylineProfile({
          id: "outer",
          points: [
            [-36, -36],
            [36, -36],
            [36, -14],
            [-14, -14],
            [-14, 36],
            [-36, 36]
          ]
        }),
        cutProfiles: [
          createCircularHole({ id: "leg_hole", x: 14, z: -25, radius: 3 }),
          createCircularHole({ id: "upright_hole", x: -25, z: 14, radius: 3 })
        ]
      },
      { ...options, extrudeDepthMm: 4 }
    );
  },
  u_bracket(options = {}) {
    return bodyFromSketch(
      "u_bracket",
      "U bracket",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 80, height: 70, cornerRadius: 2 }),
        cutProfiles: [
          createRectangleProfile({ id: "u_gap", x: 0, z: 12, width: 42, height: 46, cornerRadius: 2 }),
          createCircularHole({ id: "left_pivot", x: -30, z: -20, radius: 3.2 }),
          createCircularHole({ id: "right_pivot", x: 30, z: -20, radius: 3.2 })
        ]
      },
      { ...options, extrudeDepthMm: 5 }
    );
  },
  triangular_gusset_plate(options = {}) {
    return bodyFromSketch(
      "triangular_gusset_plate",
      "Triangular gusset plate",
      {
        outerProfile: createPolylineProfile({
          id: "outer",
          points: [
            [-50, -35],
            [50, -35],
            [-50, 45]
          ]
        }),
        cutProfiles: [
          createCircularHole({ id: "base_hole_a", x: -36, z: -22, radius: 2.8 }),
          createCircularHole({ id: "base_hole_b", x: 24, z: -25, radius: 2.8 }),
          createCircularHole({ id: "upright_hole", x: -20, z: 15, radius: 2.8 })
        ]
      },
      { ...options, extrudeDepthMm: 4 }
    );
  },
  tube_connector_plate(options = {}) {
    return bodyFromSketch(
      "tube_connector_plate",
      "Tube connector plate",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 100, height: 45, cornerRadius: 3 }),
        cutProfiles: [
          createCircularHole({ id: "tube_hole_1", x: -36, z: -13, radius: 3.2 }),
          createCircularHole({ id: "tube_hole_2", x: -36, z: 13, radius: 3.2 }),
          createCircularHole({ id: "tube_hole_3", x: -12, z: -13, radius: 3.2 }),
          createCircularHole({ id: "tube_hole_4", x: -12, z: 13, radius: 3.2 }),
          createCircularHole({ id: "tube_hole_5", x: 12, z: -13, radius: 3.2 }),
          createCircularHole({ id: "tube_hole_6", x: 12, z: 13, radius: 3.2 }),
          createCircularHole({ id: "tube_hole_7", x: 36, z: -13, radius: 3.2 }),
          createCircularHole({ id: "tube_hole_8", x: 36, z: 13, radius: 3.2 })
        ]
      },
      { ...options, extrudeDepthMm: 5 }
    );
  },
  spacer_standoff(options = {}) {
    return bodyFromSketch(
      "spacer_standoff",
      "Spacer standoff",
      {
        outerProfile: createCircleProfile({ id: "outer", radius: 12 }),
        cutProfiles: [createCircularHole({ id: "bore", radius: 3.2 })]
      },
      { ...options, extrudeDepthMm: 18 }
    );
  },
  axle_shaft(options = {}) {
    return bodyFromSketch(
      "axle_shaft",
      "Axle shaft",
      {
        outerProfile: createCircleProfile({ id: "outer", radius: 4 }),
        cutProfiles: []
      },
      { ...options, extrudeDepthMm: 60 }
    );
  },
  bearing_block_plate(options = {}) {
    return bodyFromSketch(
      "bearing_block_plate",
      "Bearing block plate",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 64, height: 50, cornerRadius: 3 }),
        cutProfiles: [
          createCircularHole({ id: "bearing_bore", radius: 11 }),
          createCircularHole({ id: "mount_hole_1", x: -24, z: -16, radius: 2.8 }),
          createCircularHole({ id: "mount_hole_2", x: 24, z: -16, radius: 2.8 }),
          createCircularHole({ id: "mount_hole_3", x: 24, z: 16, radius: 2.8 }),
          createCircularHole({ id: "mount_hole_4", x: -24, z: 16, radius: 2.8 })
        ]
      },
      { ...options, extrudeDepthMm: 6 }
    );
  },
  wheel_hub_flange(options = {}) {
    return bodyFromSketch(
      "wheel_hub_flange",
      "Wheel hub flange",
      {
        outerProfile: createCircleProfile({ id: "outer", radius: 28 }),
        cutProfiles: [
          createCircularHole({ id: "center_bore", radius: 5 }),
          ...boltCircleHoles("bolt_hole", 6, 18, 2.5, { startAngleDeg: 30 })
        ]
      },
      { ...options, extrudeDepthMm: 6 }
    );
  },
  linear_rail_carriage(options = {}) {
    return bodyFromSketch(
      "linear_rail_carriage",
      "Linear rail carriage",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 125, height: 38, cornerRadius: 3 }),
        cutProfiles: [
          createSlottedHole({ id: "adjust_slot_a", x: -36, z: 0, length: 24, width: 5 }),
          createSlottedHole({ id: "adjust_slot_b", x: 36, z: 0, length: 24, width: 5 }),
          createCircularHole({ id: "rail_hole_1", x: -52, z: -12, radius: 2.6 }),
          createCircularHole({ id: "rail_hole_2", x: -52, z: 12, radius: 2.6 }),
          createCircularHole({ id: "rail_hole_3", x: 52, z: -12, radius: 2.6 }),
          createCircularHole({ id: "rail_hole_4", x: 52, z: 12, radius: 2.6 })
        ]
      },
      { ...options, extrudeDepthMm: 5 }
    );
  },
  motor_face_mount(options = {}) {
    return bodyFromSketch(
      "motor_face_mount",
      "Motor face mount",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 56, height: 56, cornerRadius: 4 }),
        cutProfiles: [
          createCircularHole({ id: "pilot_bore", radius: 11 }),
          createCircularHole({ id: "motor_hole_1", x: -18, z: -18, radius: 2.4 }),
          createCircularHole({ id: "motor_hole_2", x: 18, z: -18, radius: 2.4 }),
          createCircularHole({ id: "motor_hole_3", x: 18, z: 18, radius: 2.4 }),
          createCircularHole({ id: "motor_hole_4", x: -18, z: 18, radius: 2.4 })
        ]
      },
      { ...options, extrudeDepthMm: 4 }
    );
  },
  servo_horn_disk(options = {}) {
    return bodyFromSketch(
      "servo_horn_disk",
      "Servo horn disk",
      {
        outerProfile: createCircleProfile({ id: "outer", radius: 22 }),
        cutProfiles: [
          createCircularHole({ id: "center_bore", radius: 3 }),
          createCircularHole({ id: "radial_hole_1", x: 12, z: 0, radius: 1.8 }),
          createCircularHole({ id: "radial_hole_2", x: 0, z: 12, radius: 1.8 }),
          createCircularHole({ id: "radial_hole_3", x: -12, z: 0, radius: 1.8 }),
          createCircularHole({ id: "radial_hole_4", x: 0, z: -12, radius: 1.8 })
        ]
      },
      { ...options, extrudeDepthMm: 3 }
    );
  },
  sensor_mount_plate(options = {}) {
    return bodyFromSketch(
      "sensor_mount_plate",
      "Sensor mount plate",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 52, height: 34, cornerRadius: 2 }),
        cutProfiles: [
          createRectangleProfile({ id: "sensor_window", width: 18, height: 14, cornerRadius: 1 }),
          createSlottedHole({ id: "adjust_slot_a", x: -15, z: 11, length: 14, width: 4 }),
          createSlottedHole({ id: "adjust_slot_b", x: 15, z: 11, length: 14, width: 4 })
        ]
      },
      { ...options, extrudeDepthMm: 3 }
    );
  },
  electronics_tray(options = {}) {
    return bodyFromSketch(
      "electronics_tray",
      "Electronics tray",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 120, height: 70, cornerRadius: 5 }),
        cutProfiles: [
          createCircularHole({ id: "corner_hole_1", x: -50, z: -25, radius: 3 }),
          createCircularHole({ id: "corner_hole_2", x: 50, z: -25, radius: 3 }),
          createCircularHole({ id: "corner_hole_3", x: 50, z: 25, radius: 3 }),
          createCircularHole({ id: "corner_hole_4", x: -50, z: 25, radius: 3 }),
          createSlottedHole({ id: "cable_slot_a", x: -30, z: 0, length: 24, width: 6 }),
          createSlottedHole({ id: "cable_slot_b", x: 30, z: 0, length: 24, width: 6 })
        ]
      },
      { ...options, extrudeDepthMm: 3 }
    );
  },
  gripper_finger(options = {}) {
    return bodyFromSketch(
      "gripper_finger",
      "Gripper finger",
      {
        outerProfile: createPolylineProfile({
          id: "outer",
          points: [
            [-12, -58],
            [14, -58],
            [20, 22],
            [12, 58],
            [-10, 58],
            [-18, 20]
          ]
        }),
        cutProfiles: [
          createCircularHole({ id: "mount_hole_a", x: 0, z: -44, radius: 3 }),
          createSlottedHole({ id: "adjust_slot", x: 1, z: -24, length: 18, width: 5 })
        ]
      },
      { ...options, extrudeDepthMm: 5 }
    );
  },
  end_effector_palm(options = {}) {
    return bodyFromSketch(
      "end_effector_palm",
      "End effector palm",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 70, height: 58, cornerRadius: 4 }),
        cutProfiles: [
          createCircularHole({ id: "wrist_hole_a", x: -24, z: -16, radius: 3 }),
          createCircularHole({ id: "wrist_hole_b", x: -24, z: 16, radius: 3 }),
          createCircularHole({ id: "tool_hole_a", x: 22, z: -16, radius: 2.8 }),
          createCircularHole({ id: "tool_hole_b", x: 22, z: 16, radius: 2.8 }),
          createSlottedHole({ id: "cable_slot", x: 0, z: 0, length: 20, width: 6 })
        ]
      },
      { ...options, extrudeDepthMm: 5 }
    );
  },
  drive_chassis_side_plate(options = {}) {
    return bodyFromSketch(
      "drive_chassis_side_plate",
      "Drive chassis side plate",
      {
        outerProfile: createRoundedSlotProfile({ id: "outer", length: 160, width: 45 }),
        cutProfiles: [
          createCircularHole({ id: "front_axle", x: 62, z: 0, radius: 4.5 }),
          createCircularHole({ id: "rear_axle", x: -62, z: 0, radius: 4.5 }),
          createCircularHole({ id: "motor_hole_a", x: -24, z: -12, radius: 2.8 }),
          createCircularHole({ id: "motor_hole_b", x: -24, z: 12, radius: 2.8 }),
          createSlottedHole({ id: "weight_relief_slot_a", x: 16, z: -12, length: 26, width: 5 }),
          createSlottedHole({ id: "weight_relief_slot_b", x: 16, z: 12, length: 26, width: 5 })
        ]
      },
      { ...options, extrudeDepthMm: 4 }
    );
  },
  quad_motor_arm_plate(options = {}) {
    return bodyFromSketch(
      "quad_motor_arm_plate",
      "Quad motor arm plate",
      {
        outerProfile: createRoundedSlotProfile({ id: "outer", length: 150, width: 32 }),
        cutProfiles: [
          createCircularHole({ id: "center_hub", radius: 5 }),
          createCircularHole({ id: "motor_hole_1", x: 58, z: -8, radius: 2.2 }),
          createCircularHole({ id: "motor_hole_2", x: 58, z: 8, radius: 2.2 }),
          createCircularHole({ id: "motor_hole_3", x: 68, z: -8, radius: 2.2 }),
          createCircularHole({ id: "motor_hole_4", x: 68, z: 8, radius: 2.2 }),
          createSlottedHole({ id: "body_mount_slot", x: -42, z: 0, length: 28, width: 5 })
        ]
      },
      { ...options, extrudeDepthMm: 4 }
    );
  }
};

export function listPartTemplates() {
  return PART_TEMPLATES.map((template) => ({ ...template }));
}

export function createBodyFromTemplate(templateId, options = {}) {
  const builder = TEMPLATE_BUILDERS[templateId] ?? TEMPLATE_BUILDERS.base_plate;
  return builder(options);
}
