/**
 * The twenty starter templates, retrofitted against the fastener standards table.
 *
 * ## The rule this file now obeys
 *
 * **A template never authors a radius for a hole that means a fastener.** It names the
 * fastener - `hole: { size, fit, style }` - and `createCircleProfile` derives the
 * radius from `standards/fasteners.js`. That is not a stylistic preference: before
 * this, `base_plate` shipped `radius: 3.2` beside an identifier reading `mount_hole`,
 * which is 6.4 mm of clearance for an M3 screw, roughly double, in the very first part
 * a new user sees. Cycle 05 built the machinery that makes the standard the single
 * source of the number; this file stops competing with it.
 *
 * A radius that *agrees* with a standard is still a defect and is not written here
 * either. Two numbers that must match are a number that will eventually not match.
 *
 * ## What counts as a fastener, and how each size was chosen
 *
 * A hole means a fastener when a screw, bolt or insert goes through it. A cable slot,
 * a sensor window, a weight relief, a shaft bore, a servo spline bore and a bearing
 * seat do not, and they keep a plain radius and carry no `hole`. That split matters
 * beyond tidiness: cycle 06's edge-distance rule reads the hole's own fastener size
 * and deliberately reports nothing for a plain circle, because inferring an M3 from a
 * 1.7 mm radius would put a fastener in a finding the design never asked for. Giving a
 * cable slot a `hole` would manufacture exactly that finding. Every non-fastener
 * circular cut is listed in `TEMPLATE_NON_FASTENER_CUTS` with the reason, and a test
 * asserts the registry and the geometry agree in both directions.
 *
 * Sizes were not invented. Two rules produced every one of them.
 *
 * 1. **Where the meta plan identified a radius-for-diameter defect, the shipped number
 *    was the intended *diameter*.** `base_plate`, `link_bar`, `u_bracket`,
 *    `tube_connector_plate` and `spacer_standoff` are those cases, so 3.2 means an M3
 *    and 4.2 means an M4 - the fastener the author was thinking of, not the fastener
 *    whose clearance happens to be twice their typo.
 * 2. **Everywhere else the shipped radius was a radius, and the fastener is the one
 *    whose published clearance fits inside it.** Exactly: if some `(size, fit)` pair in
 *    the table has a clearance equal to the shipped diameter, that pair is used and the
 *    geometry does not move at all - `servo_horn_disk`'s 3.6 mm radial holes are an M3
 *    at loose fit to the last digit. Otherwise it is the largest *normal*-fit clearance
 *    that does not exceed the shipped diameter. Never the nearest, because the nearest
 *    can be larger, and a larger hole spends edge distance and wall thickness the
 *    template was drawn with. The retrofit is allowed to shrink a hole and is not
 *    allowed to quietly grow one.
 *
 * ## Three templates moved, and one did not
 *
 * `motor_face_mount` and `bearing_block_plate` carried numbers that were wrong about a
 * real component rather than about a fastener, so they now resolve through
 * `hardware.js` and `standards/components.js`: the bolt square is NEMA ICS 16-2001's
 * 31.0 mm rather than 36, and the bore is a 608's ISO 15 outer diameter rather than a
 * zero-clearance 22.0 that will not accept one. Consuming the catalogue rather than
 * copying its numbers is deliberate - a template and a hardware pattern that describe
 * the same motor must not be able to disagree.
 *
 * `triangular_gusset_plate` and `quad_motor_arm_plate` had holes that became fasteners
 * and then sat closer to an edge than a fastener may, so **the holes moved**. Cycle 06
 * had pinned the templates as finding-free and said plainly that this was a baseline
 * rather than a result; the honest response to corrected geometry tripping a real rule
 * is to correct the geometry again, not to widen the assertion. Each move is commented
 * where it happens.
 *
 * `axle_shaft` has no holes and is the control: it comes out of this cycle
 * byte-identical, and a test says so.
 *
 * ## Nothing here is compensated
 *
 * A clearance hole authored here is nominal. Kerf and printer compensation are cycle
 * 09's, whose contract is that nominal dimensions are never mutated, so a template
 * that pre-shrank a hole for a printer would be lying to the stage that exists to do
 * it.
 */

import { DEFAULT_BODY_COLOR, createSketchExtrudeBody } from "./contracts.js";
import { resolveHardwarePattern } from "./hardware.js";
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

/**
 * Every circular cut in every template that is **not** a fastener hole, with why.
 *
 * This is the registry the acceptance criterion asks for, and it is exported rather
 * than left as comments so a test can enumerate each template's cut profiles and
 * insist that every circle either resolves a `hole` or appears here. Both directions
 * are checked: a fastener hole that lost its standard fails, and a stale entry for a
 * profile that no longer exists fails too.
 *
 * Non-circular cuts - slots, windows, gaps - are absent by construction. `hole` is
 * registered on circle profiles only, so a `roundedSlot` cannot carry one and cannot
 * be misread as a fastener.
 */
export const TEMPLATE_NON_FASTENER_CUTS = Object.freeze({
  bearing_block_plate: Object.freeze({
    bearing_bore: "A 608 bearing seat. Sized from the bearing's ISO 15 outer diameter at the ISO 286 H7 housing "
      + "fit recorded for the component, not from a fastener."
  }),
  motor_face_mount: Object.freeze({
    pilot_bore: "A bore that locates on the NEMA 17 pilot boss. Sized from NEMA ICS 16-2001's pilot diameter at "
      + "the ISO 286 H7 fit recorded for the component; a locating boss is not a screw."
  }),
  wheel_hub_flange: Object.freeze({
    center_bore: "The axle passes through. A shaft bore is a fit rather than a clearance hole, and no shaft "
      + "standard is published here."
  }),
  servo_horn_disk: Object.freeze({
    center_bore: "The splined servo output shaft passes through. Splines are vendor art, not a standard - see the "
      + "servo horn entry in standards/components.js UNSOURCED_COMPONENTS."
  }),
  drive_chassis_side_plate: Object.freeze({
    front_axle: "An axle bore, not a bolt hole.",
    rear_axle: "An axle bore, not a bolt hole."
  }),
  quad_motor_arm_plate: Object.freeze({
    center_hub: "The central hub tube passes through. A tube bore is a fit, not a clearance hole."
  })
});

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

/**
 * Holes on a bolt circle, all naming the same fastener.
 *
 * `hole` replaced the old `holeRadius` argument outright rather than sitting beside it
 * as an alternative. A bolt circle is a fastener pattern by definition - that is what
 * the word bolt is doing in the name - so there is no caller that wants a hand-typed
 * radius here, and keeping the parameter would have left one.
 */
function boltCircleHoles(idPrefix, count, radius, hole, options = {}) {
  const startAngleDeg = options.startAngleDeg ?? 0;
  return Array.from({ length: count }, (_item, index) => {
    const angle = ((startAngleDeg + (360 * index) / count) * Math.PI) / 180;
    return createCircularHole({
      id: `${idPrefix}_${index + 1}`,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      hole
    });
  });
}

/**
 * The cut profiles of a hardware catalogue entry, or a thrown error.
 *
 * A template consuming the catalogue must not be able to ship a body with the
 * component's holes silently missing, so a refusal here is a programming error rather
 * than a user-facing one: the entry ids and options are literals in this file. The
 * throw is the assertion that they stay valid.
 */
function hardwareCuts(entryId, options) {
  const resolved = resolveHardwarePattern(entryId, options);
  if (!resolved.ok) {
    throw new Error(`Template hardware pattern "${entryId}" was refused: ${resolved.reason}`);
  }
  return resolved.profiles;
}

const TEMPLATE_BUILDERS = {
  base_plate(options = {}) {
    return bodyFromSketch(
      "base_plate",
      "Base plate",
      {
        outerProfile: createRectangleProfile({ id: "outer", width: 120, height: 80, cornerRadius: 4 }),
        // Four M3 mount holes. The shipped `radius: 3.2` was the intended diameter and
        // the headline defect of this cycle: 3.2 mm is M3's *close* clearance, so the
        // author knew the number and put it in the wrong field. Normal fit is what a
        // starter plate wants, and the radius is now the table's business.
        cutProfiles: [
          createCircularHole({ id: "mount_hole_1", x: -48, z: -28, hole: { size: "M3" } }),
          createCircularHole({ id: "mount_hole_2", x: 48, z: -28, hole: { size: "M3" } }),
          createCircularHole({ id: "mount_hole_3", x: 48, z: 28, hole: { size: "M3" } }),
          createCircularHole({ id: "mount_hole_4", x: -48, z: 28, hole: { size: "M3" } })
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
        // A bolted pivot is a fastener hole. `radius: 4.2` was the intended diameter,
        // which is within a tenth of M4's close clearance, so an M4 pivot bolt is what
        // was meant.
        cutProfiles: [
          createCircularHole({ id: "pivot_hole_a", x: -50, z: 0, hole: { size: "M4" } }),
          createCircularHole({ id: "pivot_hole_b", x: 50, z: 0, hole: { size: "M4" } })
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
          // The window is the opening the servo body drops through. A rectangle cannot
          // carry a `hole` and should not: nothing is fastened through it.
          createRectangleProfile({ id: "servo_window", x: 0, z: 0, width: 42, height: 22, cornerRadius: 1.5 }),
          // 2.3 mm radius is 4.6 mm across; M4 normal at 4.5 is the largest published
          // clearance that fits inside it.
          createCircularHole({ id: "servo_hole_1", x: -28, z: -20, hole: { size: "M4" } }),
          createCircularHole({ id: "servo_hole_2", x: 28, z: -20, hole: { size: "M4" } }),
          createCircularHole({ id: "servo_hole_3", x: 28, z: 20, hole: { size: "M4" } }),
          createCircularHole({ id: "servo_hole_4", x: -28, z: 20, hole: { size: "M4" } })
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
        // 6.0 mm across. M6 normal is 6.6 and would grow the hole, so M5 normal at 5.5
        // is the size: the largest clearance that fits in what was drawn.
        cutProfiles: [
          createCircularHole({ id: "leg_hole", x: 14, z: -25, hole: { size: "M5" } }),
          createCircularHole({ id: "upright_hole", x: -25, z: 14, hole: { size: "M5" } })
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
          // The U's opening. Tangent to nothing and fastened by nothing.
          createRectangleProfile({ id: "u_gap", x: 0, z: 12, width: 42, height: 46, cornerRadius: 2 }),
          // The meta plan's defect table cites this line as radius-for-diameter, so
          // 3.2 was the intended diameter and these are M3 pivots.
          createCircularHole({ id: "left_pivot", x: -30, z: -20, hole: { size: "M3" } }),
          createCircularHole({ id: "right_pivot", x: 30, z: -20, hole: { size: "M3" } })
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
        // 5.6 mm across, so M5 normal at 5.5.
        //
        // Two of these moved, for different reasons, and the difference is worth
        // stating. The hypotenuse runs diagonally across the plate. `upright_hole` at
        // (-20, 15) sat 4.69 mm from it, which is inside `minEdgeDistanceMm("M5")` of
        // 7.5 and reported as a screw that will tear out through the diagonal edge: it
        // moved because corrected geometry tripped a real rule, which is a finding
        // about the template rather than a reason to widen an assertion.
        // `base_hole_b` at x 24 measured 8.43 mm and **passed**, with 0.93 mm of
        // margin; it moved to x 20 for margin alone and would have been legal where it
        // was. Recorded so nobody later reads one move as evidence of the other.
        cutProfiles: [
          createCircularHole({ id: "base_hole_a", x: -36, z: -22, hole: { size: "M5" } }),
          createCircularHole({ id: "base_hole_b", x: 20, z: -25, hole: { size: "M5" } }),
          createCircularHole({ id: "upright_hole", x: -38, z: 10, hole: { size: "M5" } })
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
        // Eight M3 clamp screws. `radius: 3.2` was the intended diameter throughout,
        // the same defect as `base_plate` repeated eight times.
        cutProfiles: [
          createCircularHole({ id: "tube_hole_1", x: -36, z: -13, hole: { size: "M3" } }),
          createCircularHole({ id: "tube_hole_2", x: -36, z: 13, hole: { size: "M3" } }),
          createCircularHole({ id: "tube_hole_3", x: -12, z: -13, hole: { size: "M3" } }),
          createCircularHole({ id: "tube_hole_4", x: -12, z: 13, hole: { size: "M3" } }),
          createCircularHole({ id: "tube_hole_5", x: 12, z: -13, hole: { size: "M3" } }),
          createCircularHole({ id: "tube_hole_6", x: 12, z: 13, hole: { size: "M3" } }),
          createCircularHole({ id: "tube_hole_7", x: 36, z: -13, hole: { size: "M3" } }),
          createCircularHole({ id: "tube_hole_8", x: 36, z: 13, hole: { size: "M3" } })
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
        // A standoff exists so a screw can pass through it, which makes this bore the
        // clearest fastener hole in the set. 3.2 was the intended diameter: an M3.
        cutProfiles: [createCircularHole({ id: "bore", hole: { size: "M3" } })]
      },
      { ...options, extrudeDepthMm: 18 }
    );
  },
  axle_shaft(options = {}) {
    // The control. No holes, nothing to retrofit, and deliberately untouched so that a
    // diff of this cycle has one template proving the retrofit changed only what it
    // meant to.
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
          // Was `radius: 11`, exactly 22.0 mm across, which is a 608's nominal outer
          // diameter and therefore a bore no 608 will enter. Resolved through the
          // catalogue so the seat and the `bearing_seat_608` hardware pattern are the
          // same geometry rather than two copies of it.
          ...hardwareCuts("bearing_seat_608", { seatId: "bearing_bore", centerX: 0, centerZ: 0 }),
          // 5.6 mm across, so M5 normal.
          createCircularHole({ id: "mount_hole_1", x: -24, z: -16, hole: { size: "M5" } }),
          createCircularHole({ id: "mount_hole_2", x: 24, z: -16, hole: { size: "M5" } }),
          createCircularHole({ id: "mount_hole_3", x: 24, z: 16, hole: { size: "M5" } }),
          createCircularHole({ id: "mount_hole_4", x: -24, z: 16, hole: { size: "M5" } })
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
          // The axle bore keeps its radius: a shaft is a fit, not a clearance hole.
          createCircularHole({ id: "center_bore", radius: 5 }),
          // 5.0 mm across, so M4 normal at 4.5.
          ...boltCircleHoles("bolt_hole", 6, 18, { size: "M4" }, { startAngleDeg: 30 })
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
          // Adjustment slots. A slot is how a carriage is aligned, not how it is
          // bolted, and a `roundedSlot` cannot carry a fastener standard anyway.
          createSlottedHole({ id: "adjust_slot_a", x: -36, z: 0, length: 24, width: 5 }),
          createSlottedHole({ id: "adjust_slot_b", x: 36, z: 0, length: 24, width: 5 }),
          // 5.2 mm across; M5 close at 5.3 would grow it, so M4 normal at 4.5.
          createCircularHole({ id: "rail_hole_1", x: -52, z: -12, hole: { size: "M4" } }),
          createCircularHole({ id: "rail_hole_2", x: -52, z: 12, hole: { size: "M4" } }),
          createCircularHole({ id: "rail_hole_3", x: 52, z: -12, hole: { size: "M4" } }),
          createCircularHole({ id: "rail_hole_4", x: 52, z: 12, hole: { size: "M4" } })
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
        // The whole face pattern comes from the catalogue. It shipped a plus-or-minus
        // 18 bolt square - 36 mm where NEMA ICS 16-2001 gives 31.0 - with 4.8 mm holes
        // for M3 screws, and a 22.0 mm pilot bore that the 22.0 mm boss cannot enter.
        // All three are now one call, which is the only arrangement in which the plate
        // and the `nema17_face` pattern cannot describe different motors.
        cutProfiles: hardwareCuts("nema17_face", {
          idPrefix: "motor_hole",
          pilotId: "pilot_bore",
          centerX: 0,
          centerZ: 0
        })
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
          // The splined output shaft. No published spline series to resolve, so the
          // radius stands and the catalogue refuses a servo horn entry outright.
          createCircularHole({ id: "center_bore", radius: 3 }),
          // 3.6 mm across, which is M3's loose clearance exactly. The geometry does not
          // move at all; it just stops being a number nobody could check.
          createCircularHole({ id: "radial_hole_1", x: 12, z: 0, hole: { size: "M3", fit: "loose" } }),
          createCircularHole({ id: "radial_hole_2", x: 0, z: 12, hole: { size: "M3", fit: "loose" } }),
          createCircularHole({ id: "radial_hole_3", x: -12, z: 0, hole: { size: "M3", fit: "loose" } }),
          createCircularHole({ id: "radial_hole_4", x: 0, z: -12, hole: { size: "M3", fit: "loose" } })
        ]
      },
      { ...options, extrudeDepthMm: 3 }
    );
  },
  sensor_mount_plate(options = {}) {
    // No circular cuts at all: a window and two adjustment slots. Nothing to retrofit
    // and nothing that could be mistaken for a fastener.
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
          // 6.0 mm across, so M5 normal at 5.5.
          createCircularHole({ id: "corner_hole_1", x: -50, z: -25, hole: { size: "M5" } }),
          createCircularHole({ id: "corner_hole_2", x: 50, z: -25, hole: { size: "M5" } }),
          createCircularHole({ id: "corner_hole_3", x: 50, z: 25, hole: { size: "M5" } }),
          createCircularHole({ id: "corner_hole_4", x: -50, z: 25, hole: { size: "M5" } }),
          // Cable pass-throughs. Cycle 06's rule is explicit that a slot near an edge
          // is a wall question and never a fastener question.
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
          // 6.0 mm across, so M5 normal.
          createCircularHole({ id: "mount_hole_a", x: 0, z: -44, hole: { size: "M5" } }),
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
          // The wrist pair was 6.0 mm across and the tool pair 5.6; both land on M5
          // normal, which is also the right answer physically - a palm bolted to a
          // wrist with two different bolt sizes is a bill of materials nobody wants.
          createCircularHole({ id: "wrist_hole_a", x: -24, z: -16, hole: { size: "M5" } }),
          createCircularHole({ id: "wrist_hole_b", x: -24, z: 16, hole: { size: "M5" } }),
          createCircularHole({ id: "tool_hole_a", x: 22, z: -16, hole: { size: "M5" } }),
          createCircularHole({ id: "tool_hole_b", x: 22, z: 16, hole: { size: "M5" } }),
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
          // Axle bores. A wheel axle runs through these; they are not bolt holes and a
          // shaft fit is cycle 09's.
          createCircularHole({ id: "front_axle", x: 62, z: 0, radius: 4.5 }),
          createCircularHole({ id: "rear_axle", x: -62, z: 0, radius: 4.5 }),
          // 5.6 mm across, so M5 normal.
          createCircularHole({ id: "motor_hole_a", x: -24, z: -12, hole: { size: "M5" } }),
          createCircularHole({ id: "motor_hole_b", x: -24, z: 12, hole: { size: "M5" } }),
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
          // The central hub tube passes through. Not a fastener.
          createCircularHole({ id: "center_hub", radius: 5 }),
          // 4.4 mm across; M4 close at 4.3 does not match it exactly and M4 normal at
          // 4.5 would grow it, so M3 normal - which is also what a quadcopter motor
          // actually bolts down with.
          //
          // The outer pair moved from x 68 to x 64, and the inner from 58 to 56. The
          // arm's rounded end curves away there: at x 68 an M3 centre measures 3.94 mm
          // from the boundary against `minEdgeDistanceMm("M3")` of 4.5, so both outer
          // holes were reported. As plain 2.2 mm circles they had been a legal 1.8 mm
          // wall; as fasteners they are screws pulling out through the tip. The inner
          // pair followed so the two rows stay 8 mm apart rather than 6.
          createCircularHole({ id: "motor_hole_1", x: 56, z: -8, hole: { size: "M3" } }),
          createCircularHole({ id: "motor_hole_2", x: 56, z: 8, hole: { size: "M3" } }),
          createCircularHole({ id: "motor_hole_3", x: 64, z: -8, hole: { size: "M3" } }),
          createCircularHole({ id: "motor_hole_4", x: 64, z: 8, hole: { size: "M3" } }),
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
