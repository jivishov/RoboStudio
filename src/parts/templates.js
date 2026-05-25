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
  gripper_finger: "#c026d3"
});

export const PART_TEMPLATES = Object.freeze([
  { id: "base_plate", label: "Base plate" },
  { id: "link_bar", label: "Link bar" },
  { id: "servo_mount_plate", label: "Servo mount plate" },
  { id: "l_bracket", label: "L bracket" },
  { id: "u_bracket", label: "U bracket" },
  { id: "spacer_standoff", label: "Spacer / standoff" },
  { id: "axle_shaft", label: "Axle / shaft" },
  { id: "gripper_finger", label: "Gripper finger" }
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
  }
};

export function listPartTemplates() {
  return PART_TEMPLATES.map((template) => ({ ...template }));
}

export function createBodyFromTemplate(templateId, options = {}) {
  const builder = TEMPLATE_BUILDERS[templateId] ?? TEMPLATE_BUILDERS.base_plate;
  return builder(options);
}
