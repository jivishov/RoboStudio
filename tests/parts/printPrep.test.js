import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { STOCK_FINDING_CODES, SUPPORT_FINDING_CODES, bodyPrintPrep, projectPrintPrep } from "../../src/parts/printPrep.js";
import { DFM_BRIDGE_SPAN, validateManufacturability } from "../../src/parts/dfm.js";
import { addBody, normalizePartBody, normalizePartProject } from "../../src/parts/projectState.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { stockThicknessesMm } from "../../src/parts/materials.js";
import { getProcessProfile } from "../../src/parts/process.js";

const PARTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "parts");

/**
 * A plate with an M6 counterbore cut from the bed face.
 *
 * ⚠ Not a countersink, which was the obvious fixture and produces **no finding**: a
 * 90-degree-included countersink gives a 45-degree wall, which sits exactly on FDM's
 * unsupported limit and is correctly not reported. A counterbore's roof is flat, so it is
 * the bridge rule that fires, and it only fires once the head is wide enough for the
 * annular ledge to reach past 2 mm - M4 and M5 do not, M6 does. Recorded here because a
 * fixture that silently produces nothing is how a comparison test passes vacuously.
 */
function overhangingPlate(overrides = {}) {
  return normalizePartBody({
    id: "cbore_plate",
    name: "Counterbored plate",
    extrudeDepthMm: 12,
    materialId: "pla",
    processId: "fdm",
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
      cutProfiles: [
        {
          id: "cbore",
          type: "circle",
          x: 0,
          z: 0,
          radius: 1,
          hole: { standard: "ISO metric", size: "M6", fit: "normal", style: "counterbore", fromFace: "bottom" }
        }
      ]
    },
    ...overrides
  });
}

test("the support answer is the DFM findings, compared rather than pinned", () => {
  // ⚠ Asserted by **comparing the two**, not by matching a string. A pinned string passes
  // on a tree where print prep and the Manufacturability card have diverged, which is the
  // shape audit A3 exists to catch - and divergence is exactly what happens when a
  // threshold moves on a `process.js` profile and only one consumer is re-baselined.
  const body = overhangingPlate();
  const findings = validateManufacturability(body);
  const prep = bodyPrintPrep(body);

  const expected = findings.filter((finding) => SUPPORT_FINDING_CODES.includes(finding.code));
  assert.deepEqual(
    prep.supports.findings.map((finding) => finding.code),
    expected.map((finding) => finding.code)
  );
  assert.equal(prep.supports.required, expected.length > 0);
  for (const [index, finding] of prep.supports.findings.entries()) {
    assert.equal(finding.message, expected[index].message, "the same sentence, so the two panels cannot disagree");
  }
  assert.ok(expected.some((finding) => finding.code === DFM_BRIDGE_SPAN), "this fixture must really print over air");
  assert.ok(prep.supports.required, "and the summary must follow the findings");
});

test("a body with nothing over air says so, rather than saying nothing", () => {
  // The other direction. Without it, "required" could be hard-wired true and pass above.
  const plate = createBodyFromTemplate("base_plate");
  const prep = bodyPrintPrep(plate);
  assert.equal(prep.supports.required, false);
  assert.deepEqual(prep.supports.findings, []);
  assert.match(prep.supports.summary, /Nothing in this body prints over air/u);
});

test("print prep re-derives no threshold of its own", () => {
  // Every number behind a support finding is a field on a `process.js` profile. A second
  // copy here would be the one nobody re-baselines.
  const source = readFileSync(join(PARTS_DIR, "printPrep.js"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");
  assert.doesNotMatch(code, /maxOverhangAngleDeg\s*[=:]/u);
  assert.doesNotMatch(code, /maxBridgeSpanMm\s*[=:]/u);
  assert.match(code, /validateManufacturability/u);

  // A3 negative control for the stripper, the same one `threads.test.js` carries.
  assert.doesNotMatch("/** never maxBridgeSpanMm: 2 */\nconst a = 1;".replace(/\/\*[\s\S]*?\*\//gu, ""), /maxBridgeSpanMm/u);
  assert.match("const maxBridgeSpanMm = 2;", /maxBridgeSpanMm\s*[=:]/u);
});

test("stock thickness goes through the material table, and a sheet-less process says so", () => {
  const laserPlate = normalizePartBody({
    ...createBodyFromTemplate("base_plate"),
    id: "laser_plate",
    materialId: "acrylic",
    processId: "laser",
    extrudeDepthMm: 6.35
  });
  const stocked = stockThicknessesMm("acrylic");
  assert.ok(stocked?.length, "this test needs a material that comes in sheets");

  const prep = bodyPrintPrep(laserPlate);
  assert.deepEqual(prep.stock.stockThicknessesMm, stocked);
  assert.equal(prep.stock.matches, stocked.some((value) => Math.abs(value - 6.35) < 1e-9));
  if (!prep.stock.matches) assert.match(prep.stock.reason, /nearest is/u);

  // ⚠ `null`, not `false`. FDM builds the thickness rather than buying it, so the question
  // does not apply - which is a different answer from "no thickness matches", and letting
  // the two collapse into one boolean is how a print gets flagged for a stock it never
  // needed.
  const printed = bodyPrintPrep(createBodyFromTemplate("base_plate"));
  assert.equal(printed.stock.matches, null);
  assert.match(printed.stock.reason, /builds the thickness/u);
});

test("a matching stock thickness reports the match rather than staying silent", () => {
  const stocked = stockThicknessesMm("acrylic");
  const body = normalizePartBody({
    ...createBodyFromTemplate("base_plate"),
    id: "exact_stock",
    materialId: "acrylic",
    processId: "laser",
    extrudeDepthMm: stocked[0]
  });
  const prep = bodyPrintPrep(body);
  assert.equal(prep.stock.matches, true);
  assert.equal(prep.stock.reason, null);
});

test("orientation is a recommendation with its reasoning, and is not a persisted field", () => {
  const flat = bodyPrintPrep(createBodyFromTemplate("base_plate"));
  assert.match(flat.orientation.recommendation, /flat on the bed/u);
  assert.match(flat.orientation.why, /drawn in/u);

  const overhanging = bodyPrintPrep(overhangingPlate());
  assert.match(overhanging.orientation.recommendation, /Flip the part/u);
  assert.match(overhanging.orientation.why, /face on the bed/u);

  // `bedFace` is a process-profile field, not a per-body one, and this module must not
  // have quietly introduced a body-level orientation. If it ever needs one that is a new
  // registered normalizer field with a round-trip test in the same commit.
  const body = overhangingPlate();
  assert.equal("bedFace" in body, false);
  assert.equal("orientation" in body, false);

  const cut = bodyPrintPrep(normalizePartBody({ ...createBodyFromTemplate("base_plate"), id: "cnc", processId: "cnc" }));
  assert.equal(cut.orientation.recommendation, null);
  assert.match(cut.orientation.why, /cuts from stock/u);
});

test("a non-sketch body gets a narrower answer and says which rules did not run", () => {
  const gear = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" }, gear: { toothCount: 20, moduleMm: 2 } });
  const prep = bodyPrintPrep(gear);
  assert.match(prep.uncheckedNote, /no sketch/u);
  assert.match(prep.orientation.recommendation, /Not derived/u);
  assert.match(prep.orientation.why, /does not guess/u);
});

test("there is no print time field at all, absent or otherwise", () => {
  // A time estimate needs a slicer. A row whose only content is a refusal is not a row -
  // it is a promise the page cannot keep, rendered.
  const prep = bodyPrintPrep(createBodyFromTemplate("base_plate"));
  const keys = JSON.stringify(prep);
  assert.doesNotMatch(keys, /printTime|timeMinutes|estimatedTime|durationMin/u);
  assert.equal("printTimeMinutes" in prep, false);
});

test("print prep covers every body in project order", () => {
  const a = createBodyFromTemplate("base_plate");
  const b = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" }, gear: { toothCount: 20, moduleMm: 2 } });
  const project = [a, b].reduce((current, body) => addBody(current, body), normalizePartProject());
  assert.deepEqual(
    projectPrintPrep(project).map((entry) => entry.bodyId),
    project.bodies.map((body) => body.id)
  );
});

/* ============================================================ G8-G11, the second gap sweep */

test("a print-prep row is titled by the body's name, not by its id", () => {
  // ⚠ G8, and the same hole as G5 in `bom.js`: both modules derive the row title and the
  // whole file asserted `bodyId`, so the title could be swapped for the id in either place
  // and nothing noticed.
  const plate = createBodyFromTemplate("base_plate");
  assert.notEqual(plate.name, plate.id, "this test is vacuous unless the fixture's name and id differ");

  const prep = bodyPrintPrep(plate);
  assert.equal(prep.name, plate.name);
  assert.notEqual(prep.name, prep.bodyId);
});

test("the stock block carries the findings it summarises", () => {
  // ⚠ G9, F1's shape exactly. `stock.matches` was asserted and the findings list beside it
  // never was, so the list could be emptied while the boolean stayed right - a panel
  // saying the thickness is not stocked with nothing under it saying which rule said so.
  // Compared against `validateManufacturability` rather than pinned, for the same reason
  // the support answer above is.
  const stocked = stockThicknessesMm("acrylic");
  const body = normalizePartBody({
    ...createBodyFromTemplate("base_plate"),
    id: "odd_stock",
    materialId: "acrylic",
    processId: "laser",
    extrudeDepthMm: stocked[0] + 0.7
  });
  const expected = validateManufacturability(body).filter((finding) => STOCK_FINDING_CODES.includes(finding.code));
  assert.ok(expected.length, "this fixture must really produce a stock finding");

  const prep = bodyPrintPrep(body);
  assert.equal(prep.stock.matches, false);
  assert.deepEqual(prep.stock.findings.map((finding) => finding.code), expected.map((finding) => finding.code));
  for (const [index, finding] of prep.stock.findings.entries()) {
    assert.equal(finding.message, expected[index].message, "the same sentence, so the two panels cannot disagree");
  }

  // The other direction: a body on a stocked thickness carries no stock finding.
  const exact = normalizePartBody({ ...body, id: "exact_stock_findings", extrudeDepthMm: stocked[0] });
  assert.deepEqual(bodyPrintPrep(exact).stock.findings, []);
});

test("`additive` and `bedFace` report the process profile's own fields", () => {
  // ⚠ G10 and G11. `orientationRecommendation` reads both internally and print prep
  // publishes them beside its recommendation, so they are the same two numbers derived
  // twice; only the recommendation was asserted. Hard-wiring `additive: true` or
  // `bedFace: null` left the suite green, and either one describes the wrong machine.
  for (const processId of ["fdm", "laser", "cnc"]) {
    const body = normalizePartBody({ ...createBodyFromTemplate("base_plate"), id: `prep_${processId}`, processId });
    const profile = getProcessProfile(processId);
    const prep = bodyPrintPrep(body);
    assert.equal(prep.processId, processId);
    assert.equal(prep.additive, profile.additive === true, `${processId} misreports whether it is additive`);
    assert.equal(prep.bedFace, profile.bedFace ?? null, `${processId} misreports its bed face`);
  }

  // Both fields must really vary across the table, or the loop above passes on a constant.
  const faces = ["fdm", "laser", "cnc"].map((id) => bodyPrintPrep(normalizePartBody({ ...createBodyFromTemplate("base_plate"), id: `face_${id}`, processId: id })));
  assert.equal(new Set(faces.map((prep) => prep.additive)).size, 2);
  assert.equal(new Set(faces.map((prep) => prep.bedFace)).size, 2);
});

test("printPrep.js imports no Node built-in and no JSCAD", () => {
  const source = readFileSync(join(PARTS_DIR, "printPrep.js"), "utf8");
  assert.equal(source.includes("node:"), false);
  assert.equal(source.includes("@jscad/modeling"), false);
});
