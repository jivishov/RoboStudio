import assert from "node:assert/strict";
import test from "node:test";

import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { compileBodiesToMeshResults } from "../../src/parts/cadWorkerCore.js";
// The namespace import exists for the rule-set test, so "how many codes does this
// module publish" is read off the module rather than copied into the assertion.
import * as dfm from "../../src/parts/dfm.js";
import {
  DFM_BRIDGE_SPAN,
  DFM_GEAR_DEGENERATE_TOOTH,
  DFM_GEAR_UNDERCUT,
  DFM_DEEP_HOLE,
  DFM_HOLE_EDGE_DISTANCE,
  DFM_INTERNAL_CORNER_RADIUS,
  DFM_LASER_UNSAFE_MATERIAL,
  DFM_MATERIAL_PROCESS,
  DFM_MIN_FEATURE,
  DFM_MIN_WALL,
  DFM_OVERLAPPING_CUTS,
  DFM_POCKET_UNSUPPORTED,
  DFM_RULES,
  DFM_SOURCE_KIND_UNCHECKED,
  DFM_STOCK_NOT_STOCKED,
  DFM_STOCK_THICKNESS,
  DFM_THIN_WEB_UNDER_POCKET,
  DFM_THREAD_ENGAGEMENT,
  DFM_UNSUPPORTED_OVERHANG,
  DFM_UNVERIFIED_DIMENSION,
  bodyProcessId,
  detectOverlappingCutProfiles,
  profileCore,
  profileGapMm,
  profileNarrowestMm,
  projectManufacturabilityIssues,
  validateManufacturability
} from "../../src/parts/dfm.js";
import { bodyDxfPlan } from "../../src/parts/exporters/dxf.js";
import { ISSUE_SEVERITIES } from "../../src/parts/issues.js";
import { getProcessProfile } from "../../src/parts/process.js";
import { addBody, normalizePartBody } from "../../src/parts/projectState.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { clearanceHoleDiameterMm, counterboreMm, minEdgeDistanceMm } from "../../src/parts/standards/fasteners.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validateBody } from "../../src/parts/validation.js";

/** A rectangular plate with the given cuts. 60 by 40 unless told otherwise. */
function plate(cutProfiles, options = {}) {
  return normalizePartBody({
    id: options.id ?? "plate",
    name: options.name ?? "Plate",
    extrudeDepthMm: options.extrudeDepthMm ?? 4,
    materialId: options.materialId,
    processId: options.processId,
    sketch: {
      outerProfile: {
        id: "outer",
        type: "rectangle",
        x: 0,
        z: 0,
        width: options.width ?? 60,
        height: options.height ?? 40,
        cornerRadius: options.cornerRadius ?? 0
      },
      cutProfiles
    }
  });
}

function codes(issues) {
  return issues.map((issue) => issue.code);
}

function find(issues, code) {
  return issues.find((issue) => issue.code === code) ?? null;
}

/* ------------------------------------------------------- the boundary itself */

test("a body full of manufacturability findings still validates, compiles and exports", () => {
  // The whole reason this module is not part of `validateBody`. Every finding
  // below is a statement about a machine, and none of them may cost the author
  // their preview, their handoff or their DXF.
  const body = plate([
    { id: "thin_pair_a", type: "circle", x: -2.2, z: 0, radius: 2 },
    { id: "thin_pair_b", type: "circle", x: 2.2, z: 0, radius: 2 },
    { id: "speck", type: "circle", x: -25, z: 15, radius: 0.25 },
    { id: "near_edge", type: "circle", x: 26, z: 0, hole: { size: "M3" } }
  ]);

  const findings = validateManufacturability(body);
  assert.ok(findings.length >= 3, "this body is meant to be unmakeable several ways over");

  assert.deepEqual(validateBody(body), [], "not one finding may reach the compile gate");
  assert.ok(compilePartBodyToSolid(body));
  const [result] = compileBodiesToMeshResults([body]).results;
  assert.ok(result, "it still previews");
  assert.ok(bodyDxfPlan(body).entities.length, "it still exports DXF");
});

test("no rule needs the compiled solid, which is why this runs on the main thread", () => {
  const substrates = new Set(DFM_RULES.map((rule) => rule.substrate));
  assert.ok(!substrates.has("solid"), "a rule needing the solid belongs in the worker, and this is where that gets re-decided");
  // `gear-spec` joined the set in cycle 07: a tooth form is fully described by the
  // normalized gear parameters, so an undercut is closed-form and needs the solid no
  // more than a wall thickness does.
  assert.deepEqual([...substrates].sort(), ["gear-spec", "hole-spec", "material", "scalar", "sketch-2d"]);
  for (const rule of DFM_RULES) {
    assert.ok(rule.id && rule.title && typeof rule.run === "function", `${rule.id} must be a complete rule`);
  }
});

test("the rule set is the enumerated set, and a rule id is not the same thing as a code", () => {
  // Deliberately not a count. "Twelve" (the meta plan), "thirteen" (cycle 06's
  // completion doc) and "a fourteenth is out of scope" (cycle 09's brief) are three
  // stale numbers for the same thing, and they also count the wrong thing: the rules
  // and the codes are two different sets, and a reviewer who conflates them cannot
  // reconcile either. So both sets are enumerated, and their difference is stated.
  const ids = DFM_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, "two rules sharing an id would overwrite one another in a UI");
  assert.deepEqual(ids, [
    DFM_MIN_WALL,
    DFM_MIN_FEATURE,
    DFM_HOLE_EDGE_DISTANCE,
    DFM_UNSUPPORTED_OVERHANG,
    DFM_BRIDGE_SPAN,
    DFM_THIN_WEB_UNDER_POCKET,
    DFM_OVERLAPPING_CUTS,
    DFM_DEEP_HOLE,
    DFM_INTERNAL_CORNER_RADIUS,
    DFM_THREAD_ENGAGEMENT,
    DFM_STOCK_THICKNESS,
    DFM_MATERIAL_PROCESS,
    DFM_UNVERIFIED_DIMENSION,
    // Cycle 07's two, which is what reconciles cycle 06's thirteen with the tree.
    DFM_GEAR_UNDERCUT,
    DFM_GEAR_DEGENERATE_TOOTH
  ]);

  // The codes the module publishes, read off the module. Four of them are not rule
  // ids, and each is that way for a stated reason.
  const publishedCodes = Object.entries(dfm)
    .filter(([name, value]) => name.startsWith("DFM_") && typeof value === "string")
    .map(([, value]) => value);
  const secondCodes = [
    // Three rules emit a second code when the answer is a different kind of answer
    // than the one the rule is named for.
    DFM_POCKET_UNSUPPORTED,
    DFM_STOCK_NOT_STOCKED,
    DFM_LASER_UNSAFE_MATERIAL,
    // And this one is emitted by the driver, never by a rule. It is what the engine
    // says when a body kind has no applicable rule, so silence never reads as a clean
    // bill of health - which also makes it the one code a rule-set audit that iterated
    // rules would never find.
    DFM_SOURCE_KIND_UNCHECKED
  ];

  assert.deepEqual([...publishedCodes].sort(), [...ids, ...secondCodes].sort(), "every published code is a rule id or a stated exception");
  assert.ok(!ids.includes(DFM_SOURCE_KIND_UNCHECKED), "the unchecked-kind code must not be a DFM_RULES entry");
  for (const code of secondCodes) {
    assert.ok(!ids.includes(code), `${code} is a second code, not a rule id`);
  }
});

test("every finding carries a severity the issue shape publishes", () => {
  const body = plate([
    { id: "a", type: "circle", x: -2.2, z: 0, radius: 2 },
    { id: "b", type: "circle", x: 2.2, z: 0, radius: 2 }
  ]);
  for (const issue of validateManufacturability(body, { process: "laser", processOverrides: null })) {
    assert.ok(ISSUE_SEVERITIES.includes(issue.severity), `${issue.code} has severity ${issue.severity}`);
    assert.ok(issue.path, `${issue.code} must say where it is`);
  }
});

/* ------------------------------------------------------------ the geometry */

test("a profile is exactly a core swept by a disc, for every profile type", () => {
  assert.deepEqual(profileCore({ type: "circle", x: 3, z: -1, radius: 5 }), {
    segments: [[3, -1, 3, -1]],
    radiusMm: 5
  });
  assert.deepEqual(profileCore({ type: "roundedSlot", x: 0, z: 0, length: 20, width: 6 }), {
    segments: [[-7, 0, 7, 0]],
    radiusMm: 3
  });
  // A rounded rectangle is the inset rectangle swept by the corner radius, so its
  // core is four segments 2 mm in from each side.
  const rounded = profileCore({ type: "rectangle", x: 0, z: 0, width: 20, height: 10, cornerRadius: 2 });
  assert.equal(rounded.radiusMm, 2);
  assert.equal(rounded.segments.length, 4);
  assert.deepEqual(rounded.segments[0], [-8, -3, 8, -3]);
  assert.equal(profileCore({ type: "polyline", points: [[0, 0], [10, 0], [10, 10]] }).radiusMm, 0);
});

test("the gap between two profiles is exact, with no tessellation in the answer", () => {
  const gap = profileGapMm(
    { type: "circle", x: -2.2, z: 0, radius: 2 },
    { type: "circle", x: 2.2, z: 0, radius: 2 }
  );
  // 4.4 between centres less two 2 mm radii, to the last bit rather than to a
  // chord tolerance: an inscribed polygon would have made this 0.4-something.
  assert.ok(Math.abs(gap - 0.4) < 1e-12, `expected exactly 0.4, got ${gap}`);

  const slotToCircle = profileGapMm(
    { type: "roundedSlot", x: 0, z: 0, length: 20, width: 6 },
    { type: "circle", x: 15, z: 0, radius: 2 }
  );
  // Core segment ends at x = 7, circle centre at 15: 8 less 3 less 2.
  assert.ok(Math.abs(slotToCircle - 3) < 1e-12, `expected exactly 3, got ${slotToCircle}`);

  assert.ok(profileGapMm({ type: "circle", x: 0, z: 0, radius: 5 }, { type: "circle", x: 6, z: 0, radius: 5 }) < 0);
});

test("the narrowest dimension of a polyline is its neck, not its bounding box", () => {
  // A long thin diagonal sliver whose bounding box is 40 by 40 and whose material
  // is under a millimetre thick. A bounding-box reading would call it 40 mm wide.
  const sliver = {
    type: "polyline",
    points: [
      [0, 0],
      [40, 40],
      [39.5, 40.5],
      [-0.5, 0.5]
    ]
  };
  const narrowest = profileNarrowestMm(sliver);
  assert.ok(narrowest > 0.6 && narrowest < 0.8, `expected roughly 0.707, got ${narrowest}`);

  // A triangle has no non-adjacent edge pair at all, so the vertex-to-edge reading
  // is the one that works: this is the shortest altitude, twice the area over the
  // longest side, and not the 2 mm short leg a bounding box would offer.
  const triangle = { type: "polyline", points: [[0, 0], [10, 0], [0, 2]] };
  assert.ok(Math.abs(profileNarrowestMm(triangle) - (2 * 10) / Math.hypot(10, 2)) < 1e-12);
  assert.equal(profileNarrowestMm({ type: "circle", radius: 1.7 }), 3.4);
  assert.equal(profileNarrowestMm({ type: "roundedSlot", length: 20, width: 6 }), 6);
  assert.equal(profileNarrowestMm({ type: "rectangle", width: 20, height: 8 }), 8);
});

/* ------------------------------------------------------------- minimum wall */

test("a wall below the process minimum is reported with the measured value", () => {
  const body = plate([
    { id: "hole_a", type: "circle", x: -2.2, z: 0, radius: 2 },
    { id: "hole_b", type: "circle", x: 2.2, z: 0, radius: 2 }
  ]);
  const finding = find(validateManufacturability(body), DFM_MIN_WALL);

  assert.ok(finding, "a 0.4 mm web between two holes is not printable");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.thresholdMm, getProcessProfile("fdm").minWallMm);
  assert.ok(Math.abs(finding.worstMm - 0.4) < 1e-9);
  assert.deepEqual(finding.measurements[0].featureIds, ["hole_a", "hole_b"]);
  assert.match(finding.message, /hole_a to hole_b at 0\.4 mm/u);
});

test("raising the threshold in the profile changes the finding without touching a rule", () => {
  // The acceptance criterion for task 1: a threshold is data.
  const body = plate([
    { id: "hole_a", type: "circle", x: -3, z: 0, radius: 2 },
    { id: "hole_b", type: "circle", x: 3, z: 0, radius: 2 }
  ]);
  // A 2 mm web clears FDM's 1.2 mm default.
  assert.equal(find(validateManufacturability(body), DFM_MIN_WALL), null);

  const raised = find(validateManufacturability(body, { processOverrides: { minWallMm: 3 } }), DFM_MIN_WALL);
  assert.ok(raised, "the same geometry is now too thin");
  assert.equal(raised.thresholdMm, 3);
  assert.ok(Math.abs(raised.worstMm - 2) < 1e-9);

  // And the threshold really is read from the profile rather than duplicated in
  // the rule: lowering it below the measurement silences the finding again.
  assert.equal(find(validateManufacturability(body, { processOverrides: { minWallMm: 0.5 } }), DFM_MIN_WALL), null);
});

test("a laser's minimum wall grows with the sheet, from the same rule", () => {
  const body = plate([
    { id: "hole_a", type: "circle", x: -3, z: 0, radius: 2 },
    { id: "hole_b", type: "circle", x: 3, z: 0, radius: 2 }
  ], { extrudeDepthMm: 6, materialId: "acrylic" });

  const finding = find(validateManufacturability(body, { process: "laser" }), DFM_MIN_WALL);
  assert.ok(finding, "a 2 mm web in 6 mm acrylic burns through");
  assert.equal(finding.thresholdMm, 6, "the threshold is the stock thickness, not the absolute floor");

  const thin = plate([
    { id: "hole_a", type: "circle", x: -3, z: 0, radius: 2 },
    { id: "hole_b", type: "circle", x: 3, z: 0, radius: 2 }
  ], { extrudeDepthMm: 2, materialId: "acrylic" });
  assert.equal(find(validateManufacturability(thin, { process: "laser" }), DFM_MIN_WALL), null);
});

test("a cut that meets the outline is an opening, not a wall of no thickness", () => {
  // The U bracket's slot runs out to the top edge by design. Calling that a zero
  // millimetre wall would report every U-shaped part as unmakeable.
  const bracket = createBodyFromTemplate("u_bracket");
  assert.equal(find(validateManufacturability(bracket), DFM_MIN_WALL), null);

  // Shortening the slot by a millimetre leaves 0.5 mm of material above it, and
  // that is a real web rather than an opening, so it is reported.
  bracket.sketch.cutProfiles[0].height -= 1;
  const finding = find(validateManufacturability(bracket), DFM_MIN_WALL);
  assert.ok(finding);
  assert.ok(Math.abs(finding.worstMm - 0.5) < 1e-6, `expected 0.5, got ${finding.worstMm}`);
});

test("no shipped template reports a wall it does not have", () => {
  // A rule that fires on the page's own starter geometry is a rule nobody reads.
  // Cycle 08 owns the template retrofit, so this pins today's baseline: the
  // templates are clean of wall findings at the default process.
  for (const id of ["base_plate", "link_bar", "l_bracket", "u_bracket", "electronics_tray", "gripper_finger"]) {
    assert.deepEqual(
      codes(validateManufacturability(createBodyFromTemplate(id))),
      [],
      `${id} reported a finding at the default process`
    );
  }
});

/* --------------------------------------------------------- minimum feature */

test("a cut narrower than the process can make is reported", () => {
  const body = plate([{ id: "pin_hole", type: "circle", x: 0, z: 0, radius: 0.25 }]);
  const finding = find(validateManufacturability(body), DFM_MIN_FEATURE);
  assert.ok(finding);
  assert.equal(finding.thresholdMm, getProcessProfile("fdm").minFeatureMm);
  assert.ok(Math.abs(finding.worstMm - 0.5) < 1e-12);
  assert.match(finding.message, /pin_hole at 0\.5 mm/u);
});

/* ------------------------------------------------------ hole edge distance */

test("edge distance comes from the hole's own fastener size, not from its radius", () => {
  // Asserted against the accessor, never against a literal copied out of it: a
  // test that repeats the number cannot catch the table being wrong.
  const body = plate([{ id: "screw", type: "circle", x: 26, z: 0, hole: { size: "M3" } }]);
  const finding = find(validateManufacturability(body), DFM_HOLE_EDGE_DISTANCE);

  assert.ok(finding);
  const measurement = finding.measurements[0];
  assert.deepEqual(measurement.featureIds, ["screw"]);
  assert.equal(measurement.size, "M3");
  assert.equal(measurement.thresholdMm, minEdgeDistanceMm("M3") * getProcessProfile("fdm").holeEdgeDistanceFactor);
  assert.ok(Math.abs(measurement.measuredMm - 4) < 1e-9, `centre is 4 mm from the 30 mm half-width`);
  assert.ok(measurement.measuredMm < minEdgeDistanceMm("M3"));

  // The same hole one millimetre further in clears the same accessor.
  const moved = plate([{ id: "screw", type: "circle", x: 25, z: 0, hole: { size: "M3" } }]);
  assert.equal(find(validateManufacturability(moved), DFM_HOLE_EDGE_DISTANCE), null);
});

test("a bigger fastener needs more edge, and the rule reads that from the table", () => {
  const at = (size) => {
    const body = plate([{ id: "screw", type: "circle", x: 22, z: 0, hole: { size } }]);
    return find(validateManufacturability(body), DFM_HOLE_EDGE_DISTANCE);
  };
  // The centre is 8 mm from the edge either way; only the fastener changes.
  assert.equal(at("M3"), null, `M3 wants ${minEdgeDistanceMm("M3")} mm`);
  assert.ok(at("M6"), `M6 wants ${minEdgeDistanceMm("M6")} mm`);
  assert.equal(at("M6").measurements[0].thresholdMm, minEdgeDistanceMm("M6"));
});

test("a laser's edge-distance factor moves the threshold off the fastener practice", () => {
  const body = plate([{ id: "screw", type: "circle", x: 24, z: 0, hole: { size: "M3" } }], {
    materialId: "acrylic",
    extrudeDepthMm: 3
  });
  // Both numbers through accessors, in the message as well as the assertion: a
  // literal here would be a second copy of a table value, and the message is read
  // exactly when someone is deciding whether the table or the rule is wrong.
  const clearFdmMm = 30 - 24;
  assert.ok(clearFdmMm > minEdgeDistanceMm("M3") * getProcessProfile("fdm").holeEdgeDistanceFactor);
  assert.equal(
    find(validateManufacturability(body), DFM_HOLE_EDGE_DISTANCE),
    null,
    `${clearFdmMm} mm clears FDM's ${minEdgeDistanceMm("M3") * getProcessProfile("fdm").holeEdgeDistanceFactor} mm`
  );

  const laser = find(validateManufacturability(body, { process: "laser" }), DFM_HOLE_EDGE_DISTANCE);
  assert.ok(laser, "the heat-affected zone wants more");
  assert.equal(laser.measurements[0].thresholdMm, minEdgeDistanceMm("M3") * getProcessProfile("laser").holeEdgeDistanceFactor);
});

test("a plain circle near an edge is a wall finding and never a fastener finding", () => {
  // The deliberate answer to "what does an edge-distance rule do with a profile
  // that has no hole": nothing. Edge distance is about a clamped screw tearing
  // out, and a plain circle has no screw. The material is still checked, by the
  // rule whose subject the material actually is.
  const body = plate([{ id: "decorative", type: "circle", x: 28.9, z: 0, radius: 0.7 }]);
  const findings = validateManufacturability(body);

  assert.equal(find(findings, DFM_HOLE_EDGE_DISTANCE), null, "no fastener size was ever stated");
  const wall = find(findings, DFM_MIN_WALL);
  assert.ok(wall, "the 0.4 mm of material left outside it is reported as the wall it is");
  assert.deepEqual(wall.measurements[0].featureIds, ["decorative", "outer"]);
  assert.ok(Math.abs(wall.worstMm - 0.4) < 1e-9);
});

test("a refused hole gets no fastener finding, because no fastener resolved", () => {
  const body = plate([{ id: "typo", type: "circle", x: 28, z: 0, radius: 1, hole: { size: "M3.5" } }]);
  assert.equal(find(validateManufacturability(body), DFM_HOLE_EDGE_DISTANCE), null);
});

/* ------------------------------------------------------- pockets and print */

test("a counterbore leaves the stock less the pocket, not the stock", () => {
  const body = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore" } }]);
  const finding = find(validateManufacturability(body), DFM_THIN_WEB_UNDER_POCKET);
  const pocketDepthMm = counterboreMm("M3", "fdm").depthMm;

  assert.ok(finding);
  assert.equal(finding.thresholdMm, getProcessProfile("fdm").minWebUnderPocketMm);
  const measurement = finding.measurements[0];
  assert.equal(measurement.pocketDepthMm, pocketDepthMm);
  assert.equal(measurement.stockThicknessMm, 4);
  assert.ok(Math.abs(measurement.measuredMm - (4 - pocketDepthMm)) < 1e-12);
  assert.notEqual(measurement.measuredMm, 4, "reading extrudeDepthMm and stopping is the mistake this rule exists to avoid");
  assert.match(finding.message, /the 4 mm stock less a 3\.4 mm pocket/u);
});

test("a pocket deep enough to break through is the compile warning's business, not this one", () => {
  // `hole-pocket-breaks-through` already rides on the compile result. Saying it
  // again here in a different vocabulary would help nobody.
  const body = plate([{ id: "insert", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "heatSetInsert" } }], {
    extrudeDepthMm: 3
  });
  assert.equal(find(validateManufacturability(body), DFM_THIN_WEB_UNDER_POCKET), null);
  const [result] = compileBodiesToMeshResults([body]).results;
  assert.ok(result.warnings.some((warning) => warning.code === "hole-pocket-breaks-through"));
});

test("a laser cannot make a blind pocket at all, and says so rather than measuring one", () => {
  const body = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore" } }], {
    extrudeDepthMm: 3,
    materialId: "acrylic"
  });
  const finding = find(validateManufacturability(body, { process: "laser" }), DFM_POCKET_UNSUPPORTED);
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.match(finding.message, /cb \(counterbore\)/u);
  assert.equal(find(validateManufacturability(body, { process: "laser" }), DFM_THIN_WEB_UNDER_POCKET), null);
});

test("the FDM bridge limit is read from the profile, and changing it changes the finding", () => {
  // The acceptance criterion the meta plan's Assumptions And Limits entry demands.
  const body = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore", fromFace: "bottom" } }], {
    extrudeDepthMm: 12
  });
  // The M3 counterbore's roof reaches 1.4 mm over air, inside the 2 mm default.
  assert.equal(find(validateManufacturability(body), DFM_BRIDGE_SPAN), null);

  const strict = find(validateManufacturability(body, { processOverrides: { maxBridgeSpanMm: 1 } }), DFM_BRIDGE_SPAN);
  assert.ok(strict, "a printer with no part cooling bridges less");
  assert.equal(strict.thresholdMm, 1);
  // The unsupported ledge is half the difference between the counterbore and the
  // pilot it is annular around, and **both** are table values. The pilot used to be
  // a literal `3.4` here - correct today, and exactly the two-copies-of-one-number
  // shape audit A4 exists to refuse.
  const expectedMm = (counterboreMm("M3", "fdm").diameterMm - clearanceHoleDiameterMm("M3", "normal")) / 2;
  assert.ok(Math.abs(strict.measurements[0].measuredMm - expectedMm) < 1e-12);

  // And a printer that bridges better reports nothing at the same geometry.
  assert.equal(find(validateManufacturability(body, { processOverrides: { maxBridgeSpanMm: 20 } }), DFM_BRIDGE_SPAN), null);
});

test("only a pocket on the bed face prints over air", () => {
  const overrides = { maxBridgeSpanMm: 0.5 };
  const bottom = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore", fromFace: "bottom" } }], { extrudeDepthMm: 12 });
  const top = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore", fromFace: "top" } }], { extrudeDepthMm: 12 });

  assert.ok(find(validateManufacturability(bottom, { processOverrides: overrides }), DFM_BRIDGE_SPAN));
  assert.equal(find(validateManufacturability(top, { processOverrides: overrides }), DFM_BRIDGE_SPAN), null);

  // A part printed on edge has no bed face in the sketch plane, so both fall silent.
  assert.equal(find(validateManufacturability(bottom, { processOverrides: overrides, bedFace: null }), DFM_BRIDGE_SPAN), null);
  // And a subtractive process has no bed at all.
  assert.equal(find(validateManufacturability(bottom, { process: "cnc" }), DFM_BRIDGE_SPAN), null);
});

test("a sloped roof is an overhang and a flat one is a bridge, so neither reports twice", () => {
  const countersink = plate([{ id: "cs", type: "circle", x: 0, z: 0, hole: { size: "M4", style: "countersink", fromFace: "bottom" } }], { extrudeDepthMm: 10 });

  // A 90-degree-included countersink is exactly 45 degrees from vertical, which is
  // the default limit, so it is not reported at the default.
  assert.equal(find(validateManufacturability(countersink), DFM_UNSUPPORTED_OVERHANG), null);
  const strict = find(validateManufacturability(countersink, { processOverrides: { maxOverhangAngleDeg: 40 } }), DFM_UNSUPPORTED_OVERHANG);
  assert.ok(strict);
  assert.equal(strict.thresholdDeg, 40);
  assert.equal(strict.measurements[0].measuredDeg, 45);
  // A cone never also reports as a bridge, however tight the bridge limit is.
  assert.equal(
    find(validateManufacturability(countersink, { processOverrides: { maxOverhangAngleDeg: 40, maxBridgeSpanMm: 0.1 } }), DFM_BRIDGE_SPAN),
    null
  );
});

/* --------------------------------------------------------- cut against cut */

test("two overlapping cut profiles are reported exactly once across the page", () => {
  // Task 5's settlement. The detection used to live in `dxf.js`; it now lives here
  // alone, and `dxf.js` must not have kept a copy.
  const body = plate([
    { id: "hole_a", type: "circle", x: -2, z: 0, radius: 6 },
    { id: "hole_b", type: "circle", x: 2, z: 0, radius: 6 }
  ]);

  const finding = find(validateManufacturability(body), DFM_OVERLAPPING_CUTS);
  assert.ok(finding);
  assert.equal(finding.pairCount, 1);
  assert.deepEqual(finding.pairs, [["hole_a", "hole_b"]]);

  const plan = bodyDxfPlan(body);
  assert.deepEqual(plan.warnings, [], "the DXF plan no longer reports it a second time");
  assert.equal(plan.contourCount, 3, "and the file is still produced");
});

test("touching cuts and a bolt circle are not overlaps", () => {
  assert.equal(
    detectOverlappingCutProfiles({
      cutProfiles: [
        { id: "hole_a", type: "circle", x: 0, z: 0, radius: 5 },
        { id: "hole_b", type: "circle", x: 20, z: 0, radius: 5 }
      ]
    }),
    null
  );
  assert.equal(detectOverlappingCutProfiles({ cutProfiles: [] }), null);
  assert.equal(find(validateManufacturability(createBodyFromTemplate("base_plate")), DFM_OVERLAPPING_CUTS), null);
});

test("an overlapping pair is not also reported as a wall of no thickness", () => {
  const body = plate([
    { id: "hole_a", type: "circle", x: -2, z: 0, radius: 6 },
    { id: "hole_b", type: "circle", x: 2, z: 0, radius: 6 }
  ]);
  assert.equal(find(validateManufacturability(body), DFM_MIN_WALL), null);
});

/* ------------------------------------------------- the subtractive-only rules */

test("a hole deeper than a cutter reaches is reported for CNC and not for FDM", () => {
  const body = plate([{ id: "deep", type: "circle", x: 0, z: 0, radius: 1.5 }], {
    extrudeDepthMm: 30,
    materialId: "al6061t6"
  });
  assert.equal(find(validateManufacturability(body), DFM_DEEP_HOLE), null, "printing does not drill");

  const finding = find(validateManufacturability(body, { process: "cnc" }), DFM_DEEP_HOLE);
  assert.ok(finding);
  assert.equal(finding.thresholdRatio, getProcessProfile("cnc").maxHoleDepthRatio);
  assert.equal(finding.measurements[0].measuredRatio, 10);
});

test("a square pocket has internal corners a round cutter cannot reach", () => {
  const body = plate([{ id: "window", type: "rectangle", x: 0, z: 0, width: 20, height: 10, cornerRadius: 0 }], {
    extrudeDepthMm: 6,
    materialId: "al6061t6"
  });
  const finding = find(validateManufacturability(body, { process: "cnc" }), DFM_INTERNAL_CORNER_RADIUS);
  assert.ok(finding);
  assert.equal(finding.thresholdMm, getProcessProfile("cnc").minInternalCornerRadiusMm);
  assert.equal(finding.measurements[0].cornerCount, 4);

  // Rounding the pocket past the cutter radius silences it, and a laser never
  // cared because a laser makes a genuinely sharp corner.
  body.sketch.cutProfiles[0].cornerRadius = 1;
  assert.equal(find(validateManufacturability(body, { process: "cnc" }), DFM_INTERNAL_CORNER_RADIUS), null);
});

test("an external corner is not an internal one", () => {
  // A cutter walks around the outside of a rectangular outline, so the plate's own
  // four corners are not a finding. An L bracket's inside corner is.
  const square = plate([], { extrudeDepthMm: 6, materialId: "al6061t6" });
  assert.equal(find(validateManufacturability(square, { process: "cnc" }), DFM_INTERNAL_CORNER_RADIUS), null);

  const bracket = createBodyFromTemplate("l_bracket");
  bracket.materialId = "al6061t6";
  const finding = find(validateManufacturability(bracket, { process: "cnc" }), DFM_INTERNAL_CORNER_RADIUS);
  assert.ok(finding, "the reflex corner where the two legs meet is a corner in the material");
  assert.equal(finding.measurements[0].featureIds[0], bracket.sketch.outerProfile.id);
});

test("a tapped hole in a plate too thin to hold the thread is reported", () => {
  const body = plate([{ id: "tap", type: "circle", x: 0, z: 0, hole: { size: "M6", style: "tapped" } }]);
  const finding = find(validateManufacturability(body), DFM_THREAD_ENGAGEMENT);
  assert.ok(finding);
  assert.equal(finding.engagementDiameters, getProcessProfile("fdm").minThreadEngagementDiameters);
  assert.equal(finding.measurements[0].thresholdMm, 6 * getProcessProfile("fdm").minThreadEngagementDiameters);
  assert.equal(finding.measurements[0].measuredMm, 4);

  // Metal takes one diameter rather than two, so the same plate is fine machined.
  const metal = plate([{ id: "tap", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "tapped" } }], {
    materialId: "al6061t6"
  });
  assert.equal(find(validateManufacturability(metal, { process: "cnc" }), DFM_THREAD_ENGAGEMENT), null);
  // And a through hole is not a tapped one.
  const through = plate([{ id: "clear", type: "circle", x: 0, z: 0, hole: { size: "M6" } }]);
  assert.equal(find(validateManufacturability(through), DFM_THREAD_ENGAGEMENT), null);
});

/* ------------------------------------------------------- stock and material */

test("stock thickness is checked against the process bounds", () => {
  const thick = plate([], { extrudeDepthMm: 20, materialId: "acrylic" });
  const finding = find(validateManufacturability(thick, { process: "laser" }), DFM_STOCK_THICKNESS);
  assert.ok(finding);
  assert.equal(finding.bound, "max");
  assert.equal(finding.thresholdMm, getProcessProfile("laser").maxStockThicknessMm);

  const thin = plate([], { extrudeDepthMm: 0.2 });
  assert.equal(find(validateManufacturability(thin), DFM_STOCK_THICKNESS).bound, "min");

  // FDM publishes no maximum, so a 200 mm body is not reported against zero.
  assert.equal(find(validateManufacturability(plate([], { extrudeDepthMm: 200 })), DFM_STOCK_THICKNESS), null);
});

test("a thickness between two stocked sheets is advisory, not a defect", () => {
  const body = plate([], { extrudeDepthMm: 3.5, materialId: "acrylic" });
  const finding = find(validateManufacturability(body, { process: "laser" }), DFM_STOCK_NOT_STOCKED);
  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.match(finding.message, /Nothing here is unmakeable/u);

  const stocked = plate([], { extrudeDepthMm: 3, materialId: "acrylic" });
  assert.equal(find(validateManufacturability(stocked, { process: "laser" }), DFM_STOCK_NOT_STOCKED), null);
  // PLA publishes no sheet list, so the rule has nothing to say about a printed part.
  assert.equal(find(validateManufacturability(plate([], { extrudeDepthMm: 3.5 })), DFM_STOCK_NOT_STOCKED), null);
});

test("a material that must never be laser cut is an error and quotes the reason", () => {
  const body = plate([], { extrudeDepthMm: 3, materialId: "pvc" });
  const finding = find(validateManufacturability(body, { process: "laser" }), DFM_LASER_UNSAFE_MATERIAL);
  assert.ok(finding);
  assert.equal(finding.severity, "error");
  assert.match(finding.message, /hydrogen chloride/u);
});

test("a material note that is not about lasers is not quoted as a laser reason", () => {
  // PLA is laser-unsafe and its note is about layer adhesion. Appending it would
  // state a hazard reason the material table never gave.
  const finding = find(validateManufacturability(plate([]), { process: "laser" }), DFM_LASER_UNSAFE_MATERIAL);
  assert.ok(finding);
  assert.equal(finding.message, "PLA must not be laser cut.");
});

test("a material the process does not make is reported without measuring geometry", () => {
  const finding = find(validateManufacturability(plate([]), { process: "cnc" }), DFM_MATERIAL_PROCESS);
  assert.ok(finding);
  assert.equal(finding.severity, "warning");
  assert.deepEqual(finding.materialProcesses, ["fdm"]);
  assert.equal(find(validateManufacturability(plate([])), DFM_MATERIAL_PROCESS), null);
});

/* ------------------------------------------------------- advisory and gaps */

test("an unverified standard dimension is surfaced as advice and never as a defect", () => {
  // Cycle 05 emits `unverifiedDimensions` and nothing consumed it. A flagged value
  // is a published number nobody has checked, which is not the same as a fault.
  const body = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore", process: "machined" } }], {
    extrudeDepthMm: 12,
    materialId: "al6061t6"
  });
  const finding = find(validateManufacturability(body, { process: "cnc" }), DFM_UNVERIFIED_DIMENSION);
  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.deepEqual(finding.measurements[0].dimensions, ["counterbore"]);

  // The FDM column is derived from a head diameter and is not flagged.
  const printed = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore" } }], { extrudeDepthMm: 12 });
  assert.equal(find(validateManufacturability(printed), DFM_UNVERIFIED_DIMENSION), null);
});

test("a body with no sketch says which rules did not run rather than passing silently", () => {
  const gear = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" } });
  const findings = validateManufacturability(gear);
  const gap = find(findings, DFM_SOURCE_KIND_UNCHECKED);

  assert.ok(gap);
  assert.equal(gap.severity, "info");
  assert.ok(gap.uncheckedRules.includes(DFM_MIN_WALL));
  assert.ok(gap.uncheckedRules.includes(DFM_HOLE_EDGE_DISTANCE));
  assert.ok(!gap.uncheckedRules.includes(DFM_STOCK_THICKNESS), "thickness was still checked");
});

/* -------------------------------------------------------------- the contract */

test("every measuring finding names the feature, the measured value and the threshold", () => {
  const body = plate([
    { id: "thin_a", type: "circle", x: -2.2, z: 0, radius: 2 },
    { id: "thin_b", type: "circle", x: 2.2, z: 0, radius: 2 },
    { id: "speck", type: "circle", x: -25, z: 15, radius: 0.2 },
    { id: "near_edge", type: "circle", x: 26, z: -12, hole: { size: "M3" } },
    { id: "tap", type: "circle", x: 20, z: 12, hole: { size: "M6", style: "tapped" } },
    { id: "cb", type: "circle", x: -20, z: -12, hole: { size: "M5", style: "counterbore" } }
  ], { extrudeDepthMm: 6 });
  const findings = validateManufacturability(body);
  const measuring = new Set([
    DFM_MIN_WALL,
    DFM_MIN_FEATURE,
    DFM_HOLE_EDGE_DISTANCE,
    DFM_THIN_WEB_UNDER_POCKET,
    DFM_THREAD_ENGAGEMENT
  ]);

  assert.ok(findings.length >= 5, `expected several findings, got ${codes(findings).join(", ")}`);
  for (const issue of findings.filter((entry) => measuring.has(entry.code))) {
    const measurements = issue.measurements ?? [];
    assert.ok(measurements.length, `${issue.code} states no measurement`);
    for (const measurement of measurements) {
      assert.ok(measurement.featureIds?.length, `${issue.code} names no feature`);
      assert.ok(Number.isFinite(measurement.measuredMm), `${issue.code} states no measured value`);
      // The threshold is either shared by the finding or carried per measurement,
      // because edge distance and thread engagement differ per fastener.
      const thresholdMm = issue.thresholdMm ?? measurement.thresholdMm;
      assert.ok(Number.isFinite(thresholdMm), `${issue.code} states no threshold`);
      assert.ok(measurement.measuredMm < thresholdMm, `${issue.code} reported a measurement that is not below its threshold`);
      // And the message says all three out loud, not only the extras object.
      assert.ok(issue.message.includes(measurement.featureIds[0]), `${issue.code} does not name ${measurement.featureIds[0]}`);
    }
    assert.match(issue.message, /\d/u, `${issue.code} states no number`);
  }
});

test("findings come back worst first", () => {
  const body = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore", process: "machined" } }], {
    extrudeDepthMm: 4,
    materialId: "pvc"
  });
  const severities = validateManufacturability(body, { process: "laser" }).map((issue) => issue.severity);
  const rank = { error: 0, warning: 1, info: 2 };
  for (let index = 1; index < severities.length; index += 1) {
    assert.ok(rank[severities[index - 1]] <= rank[severities[index]], `out of order: ${severities.join(", ")}`);
  }
});

/* -------------------------------------------------------- per-body process */

test("each body is judged against its own process", () => {
  const printed = plate([{ id: "cb", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore" } }], {
    id: "printed",
    extrudeDepthMm: 12
  });
  const cut = plate([{ id: "cb2", type: "circle", x: 0, z: 0, hole: { size: "M3", style: "counterbore" } }], {
    id: "cut",
    extrudeDepthMm: 3,
    materialId: "acrylic",
    processId: "laser"
  });

  assert.equal(bodyProcessId(printed), "fdm");
  assert.equal(bodyProcessId(cut), "laser");

  let project = createPartProject({ updatedAt: "2026-07-28T00:00:00.000Z" });
  project = addBody(project, printed, { updatedAt: "2026-07-28T00:01:00.000Z" });
  project = addBody(project, cut, { updatedAt: "2026-07-28T00:02:00.000Z" });

  const findings = projectManufacturabilityIssues(project);
  const unsupported = findings.filter((issue) => issue.code === DFM_POCKET_UNSUPPORTED);
  assert.equal(unsupported.length, 1, "only the laser-cut body cannot have a pocket");
  assert.equal(unsupported[0].bodyId, "cut");
  assert.ok(findings.every((issue) => issue.bodyId), "every project finding names the body it belongs to");
});

test("an unknown process on a body falls back rather than skipping every rule", () => {
  const body = plate([{ id: "speck", type: "circle", x: 0, z: 0, radius: 0.2 }], { processId: "waterjet" });
  assert.equal(bodyProcessId(body), "fdm");
  assert.ok(find(validateManufacturability(body), DFM_MIN_FEATURE));
});
