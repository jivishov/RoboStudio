import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { compileBodiesToMeshResults } from "../../src/parts/cadWorkerCore.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { validateManufacturability } from "../../src/parts/dfm.js";
import { bodyDxfPlan } from "../../src/parts/exporters/dxf.js";
import {
  HOLE_NO_PUBLISHED_VALUE,
  HOLE_UNSUPPORTED_SIZE,
  POCKET_BREAKTHROUGH_CODE,
  REFUSED_HOLE_CODE
} from "../../src/parts/holes.js";
import { addBody, normalizePartBody } from "../../src/parts/projectState.js";
import {
  createCircularHole,
  createCircleProfile,
  createPolylineProfile,
  createRectangleProfile,
  createRoundedSlotProfile
} from "../../src/parts/sketch.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validateBody, validatePartProject } from "../../src/parts/validation.js";

test("validates one closed outer profile with closed cut profiles", () => {
  const body = createBodyFromTemplate("link_bar");
  assert.deepEqual(validateBody(body), []);
});

test("rejects missing, open, and unsupported outer profiles", () => {
  const missing = createBodyFromTemplate("base_plate");
  missing.sketch.outerProfile = null;
  assert.ok(validateBody(missing).some((item) => item.code === "missing-outer-profile"));

  const open = createBodyFromTemplate("base_plate");
  open.sketch.outerProfile = createPolylineProfile({
    id: "outer",
    closed: false,
    points: [
      [0, 0],
      [10, 0],
      [10, 10]
    ]
  });
  assert.ok(validateBody(open).some((item) => item.code === "open-outer-profile" || item.code === "open-profile"));

  const unsupported = createBodyFromTemplate("base_plate");
  unsupported.sketch.outerProfile = { id: "outer", type: "spline", points: [] };
  assert.ok(validateBody(unsupported).some((item) => item.code === "unsupported-profile"));
});

test("detects invalid dimensions and outside holes", () => {
  const rectangle = createBodyFromTemplate("base_plate");
  rectangle.sketch.outerProfile = createRectangleProfile({ id: "outer", width: 20, height: 20 });
  rectangle.sketch.cutProfiles = [createCircularHole({ id: "hole", x: 40, z: 0, radius: 3 })];
  assert.ok(validateBody(rectangle).some((item) => item.code === "cut-outside-outer-profile"));

  const circle = createBodyFromTemplate("spacer_standoff");
  circle.sketch.outerProfile = createCircleProfile({ id: "outer", radius: 10 });
  circle.sketch.cutProfiles = [createCircularHole({ id: "hole", x: 8, z: 0, radius: 4 })];
  assert.ok(validateBody(circle).some((item) => item.code === "cut-outside-outer-profile"));

  const slot = createBodyFromTemplate("link_bar");
  slot.sketch.outerProfile = createRoundedSlotProfile({ id: "outer", length: 10, width: 20 });
  slot.sketch.outerProfile.length = 10;
  assert.ok(validateBody(slot).some((item) => item.code === "invalid-slot-dimension"));
});

test("detects cuts inside a polyline bounding box but outside the actual closed profile", () => {
  const lBracket = createBodyFromTemplate("l_bracket");
  lBracket.sketch.cutProfiles.push(createCircularHole({ id: "missing_corner_hole", x: 20, z: 20, radius: 3 }));

  assert.ok(validateBody(lBracket).some((item) => item.code === "cut-outside-outer-profile"));
});

test("detects duplicate ids in bodies and profiles", () => {
  const body = createBodyFromTemplate("base_plate");
  body.sketch.cutProfiles[0].id = "outer";
  assert.ok(validateBody(body).some((item) => item.code === "duplicate-profile-id"));

  const project = createPartProject({
    bodies: [createBodyFromTemplate("base_plate"), createBodyFromTemplate("base_plate")],
    selectedBodyId: "base_plate",
    updatedAt: "2026-05-25T10:00:00.000Z"
  });
  assert.ok(validatePartProject(project).some((item) => item.code === "duplicate-body-id"));
});

test("validates project selection and template state through add body", () => {
  let project = createPartProject({ selectedBodyId: "missing", updatedAt: "2026-05-25T10:00:00.000Z" });
  project = addBody(project, createBodyFromTemplate("u_bracket"), {
    updatedAt: "2026-05-25T10:01:00.000Z"
  });

  assert.equal(project.selectedBodyId, "u_bracket");
  assert.equal(validatePartProject(project).length, 0);

  project.selectedBodyId = "missing";
  assert.ok(validatePartProject(project).some((item) => item.code === "invalid-selection"));
});

test("no hole or standards finding is routed through validateBody", () => {
  // Landmine one, as a standing regression. `validateBody` is a hard compile gate:
  // `cadCompile.js` refuses a body whose issue list is non-empty at *any* severity,
  // so a hole finding pushed in here would block compile, preview, handoff and every
  // export - including the DXF of a pilot circle that is perfectly cuttable.
  const refused = normalizePartBody({
    id: "plate",
    name: "Plate",
    extrudeDepthMm: 2,
    sketch: {
      outerProfile: createRectangleProfile({ id: "outer", x: 0, z: 0, width: 60, height: 40 }),
      cutProfiles: [
        // An unresolvable size, an insert bore nobody publishes, and a pocket deeper
        // than the plate: three findings that a manufacturability pass would report
        // and that this gate must stay silent about.
        { id: "typo", type: "circle", x: -20, z: 0, radius: 2, hole: { size: "M3.5" } },
        { id: "no_insert", type: "circle", x: 0, z: 0, radius: 2, hole: { size: "M5", style: "heatSetInsert" } },
        { id: "too_deep", type: "circle", x: 20, z: 0, radius: 2, hole: { size: "M3", style: "heatSetInsert" } }
      ]
    }
  });

  assert.deepEqual(validateBody(refused), [], "a hole finding is never a validation issue");
  // And it does compile, which is the property the empty issue list is standing in for.
  assert.ok(compilePartBodyToSolid(refused));

  const holeCodes = [REFUSED_HOLE_CODE, POCKET_BREAKTHROUGH_CODE, HOLE_UNSUPPORTED_SIZE, HOLE_NO_PUBLISHED_VALUE];
  const issueCodes = validateBody(refused).map((item) => item.code);
  for (const code of holeCodes) {
    assert.ok(!issueCodes.includes(code), `${code} must not reach validateBody`);
  }

  // The findings do exist - they travel on the compile result as warnings.
  const [result] = compileBodiesToMeshResults([refused]).results;
  const warningCodes = result.warnings.map((warning) => warning.code);
  assert.ok(warningCodes.includes(REFUSED_HOLE_CODE));
  assert.ok(warningCodes.includes(POCKET_BREAKTHROUGH_CODE));
});

test("no manufacturability finding is routed through validateBody", () => {
  // Landmine one again, for cycle 06's engine. The two functions share the issue
  // *shape* and must never share the array: `validateBody` refuses to compile on a
  // non-empty list at any severity, so a wall finding pushed in here would make a
  // 0.4 mm web block the preview, the handoff and every export - including the
  // DXF of a part a laser cutter would make without complaint.
  const unmakeable = normalizePartBody({
    id: "unmakeable",
    name: "Unmakeable plate",
    // 0.3 mm of stock, two holes with a 0.4 mm web between them, one M3 hole half a
    // millimetre from the edge, and a tapped M8 with nothing to thread into.
    extrudeDepthMm: 0.3,
    sketch: {
      outerProfile: createRectangleProfile({ id: "outer", x: 0, z: 0, width: 60, height: 40 }),
      cutProfiles: [
        createCircularHole({ id: "web_a", x: -2.2, z: 0, radius: 2 }),
        createCircularHole({ id: "web_b", x: 2.2, z: 0, radius: 2 }),
        { id: "near_edge", type: "circle", x: 28.2, z: -15, hole: { size: "M3" } },
        { id: "tapped", type: "circle", x: -20, z: 15, hole: { size: "M8", style: "tapped" } }
      ]
    }
  });

  const findings = validateManufacturability(unmakeable);
  assert.ok(findings.length >= 4, `expected several findings, got ${findings.map((item) => item.code).join(", ")}`);

  assert.deepEqual(validateBody(unmakeable), [], "not one manufacturability finding may reach the compile gate");
  const gateCodes = new Set(validateBody(unmakeable).map((item) => item.code));
  for (const finding of findings) {
    assert.ok(!gateCodes.has(finding.code), `${finding.code} must not reach validateBody`);
  }

  // And the properties the empty list stands in for all still hold.
  assert.ok(compilePartBodyToSolid(unmakeable), "it compiles");
  assert.ok(compileBodiesToMeshResults([unmakeable]).results.length, "it previews");
  assert.ok(bodyDxfPlan(unmakeable).entities.length, "it exports");
});

/**
 * A module's source with comments removed, so a source-level ban reads code only.
 *
 * The two halves of the import ban used to be different strengths: `validation.js`
 * was checked with a bare `includes("dfm.js")`, but `dfm.js` with
 * `/from "\.\/validation\.js"/`, which `from "../parts/validation.js"` and
 * `await import("./validation.js")` both slip past. A bare `includes` could not be
 * used symmetrically because `dfm.js` *discusses* `validation.js` at length in
 * prose - which is exactly what this strips, so both halves can be equally strict.
 */
function sourceWithoutComments(relativePath) {
  return readFileSync(new URL(`../../src/parts/${relativePath}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/^[^\n"'`]*\/\/.*$/gmu, " ");
}

test("validateBody never calls the manufacturability engine, in either direction", () => {
  // Stated as a source-level property rather than only as behaviour, because the
  // failure mode is somebody adding one import in six months' time.
  const validationSource = sourceWithoutComments("validation.js");
  const dfmSource = sourceWithoutComments("dfm.js");

  // The negative control, first. A source-level test that stops seeing its input
  // passes by seeing nothing - cycle 08's review found exactly that - so before
  // concluding anything from an absence, prove each stripped source still holds a
  // module reference of the shape being searched for.
  assert.ok(validationSource.includes("contracts.js"), "the comment stripper ate validation.js");
  assert.ok(dfmSource.includes("process.js"), "the comment stripper ate dfm.js");
  // And that it does remove prose: `dfm.js` names `validation.js` in its header, so
  // the raw file would fail the assertion below for the wrong reason.
  assert.ok(
    readFileSync(new URL("../../src/parts/dfm.js", import.meta.url), "utf8").includes("validation.js"),
    "dfm.js is expected to discuss validation.js in comments - if it stops, this control is vacuous"
  );

  assert.ok(!validationSource.includes("dfm.js"), "validation.js must not import the DFM engine");
  assert.ok(!validationSource.includes("process.js"), "validation.js must not read a process profile");
  // Now equally strict in this direction: any mention in code at all, whatever the
  // path shape and whether static or dynamic.
  assert.ok(!dfmSource.includes("validation.js"), "dfm.js must not reach into the compile gate either");
});
