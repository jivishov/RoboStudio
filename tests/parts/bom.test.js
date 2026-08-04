import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOM_MASS_NOT_BUILT,
  BOM_MASS_NOT_WATERTIGHT,
  bodyPurchasedParts,
  describeMinimumLength,
  describePurchased,
  projectBom
} from "../../src/parts/bom.js";
import { ABSENT_OUTPUT, formatOutput } from "../../src/parts/format.js";
import { addBody, normalizePartBody, normalizePartProject } from "../../src/parts/projectState.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { bodyGeometryProperties } from "../../src/parts/massProperties.js";
import { describeHole } from "../../src/parts/holes.js";
import { getMaterial, massGramsForVolume } from "../../src/parts/materials.js";
import { describeProcess } from "../../src/parts/process.js";

const PARTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "parts");

function projectWith(...bodies) {
  return bodies.reduce((project, body) => addBody(project, body), normalizePartProject());
}

/** The exact-2D volume a sketch body has without any compile, keyed as the page keys it. */
function geometryFor(bodies) {
  return new Map(bodies.map((body) => [body.id, bodyGeometryProperties(body)]).filter(([, value]) => value));
}

/* ============================================================ S1, written first */

test("a body with no measurable volume states that it has none, and never renders zero", () => {
  // ⚠ This test is first in the file because the defect it guards has shipped three times
  // in this project and was caught in review every time, never by a test: `Number(null)`
  // is `0`, so cycle 04 fabricated a `0` volume, cycle 05 rendered "0.000 cm3" in the one
  // card whose contract is a dash, and cycle 06 measured twenty templates against a
  // maximum of zero.
  //
  // The assertion is on the **rendered cell**, which is why `format.js` exists as a
  // separate module: `src/parts.js` cannot be imported here, so the string a cell will
  // hold is only checkable if the function that produces it is.
  const plate = createBodyFromTemplate("base_plate");
  const project = projectWith(plate);
  const bom = projectBom(project, {
    geometryPropertiesById: geometryFor([plate]),
    watertightById: { [plate.id]: false }
  });

  const [row] = bom.parts;
  assert.equal(row.bodyId, plate.id, "the row still appears - omitting it is the quieter version of the same lie");
  assert.equal(row.massGrams, null);
  assert.equal(row.massUnavailableCode, BOM_MASS_NOT_WATERTIGHT);
  assert.match(row.massUnavailableReason, /closed surface/u);

  const rendered = formatOutput(row.massGrams, 3);
  assert.notEqual(rendered, "0", "three negatives on the rendered value, not on the property");
  assert.notEqual(rendered, "0.000");
  assert.notEqual(rendered, "");
  assert.equal(rendered, ABSENT_OUTPUT);
});

test("an unbuilt body and an open one are different absences with different reasons", () => {
  const plate = createBodyFromTemplate("base_plate");
  const gear = normalizePartBody({
    id: "gear",
    name: "Gear",
    source: { kind: "spurGear" },
    gear: { toothCount: 20, moduleMm: 2 }
  });
  const project = projectWith(plate, gear);

  // No geometry supplied for the gear at all: nothing has compiled it.
  const bom = projectBom(project, { geometryPropertiesById: geometryFor([plate]) });
  const gearRow = bom.parts.find((row) => row.bodyId === "gear");
  assert.equal(gearRow.massGrams, null);
  assert.equal(gearRow.massUnavailableCode, BOM_MASS_NOT_BUILT);
  assert.match(gearRow.massUnavailableReason, /not been built/u);
  assert.doesNotMatch(gearRow.massUnavailableReason, /closed surface/u, "two absences, two remedies");

  // And the sketch plate beside it is weighed, because its volume needs no solid.
  const plateRow = bom.parts.find((row) => row.bodyId === plate.id);
  assert.ok(plateRow.massGrams > 0);
  assert.equal(plateRow.massUnavailableReason, null);
});

test("a project total containing an absence is itself absent, and says how short it is", () => {
  const plate = createBodyFromTemplate("base_plate");
  const gear = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" }, gear: { toothCount: 20, moduleMm: 2 } });
  const bom = projectBom(projectWith(plate, gear), { geometryPropertiesById: geometryFor([plate]) });

  // Arithmetically the partial sum is correct and materially it is a lie, because a reader
  // takes a total to cover the rows above it. It is offered under its own name instead.
  assert.equal(bom.totals.massGrams, null);
  assert.equal(formatOutput(bom.totals.massGrams, 2), ABSENT_OUTPUT);
  assert.ok(bom.totals.knownMassGrams > 0);
  assert.equal(bom.totals.unweighedCount, 1);
  assert.match(bom.totals.massUnavailableReason, /1 of 2/u);
});

test("a fully weighed project does state a total", () => {
  // The other direction, so the branch above is shown reachable both ways (audit A3).
  const plate = createBodyFromTemplate("base_plate");
  const bom = projectBom(projectWith(plate), { geometryPropertiesById: geometryFor([plate]) });
  assert.ok(bom.totals.massGrams > 0);
  assert.equal(bom.totals.massUnavailableReason, null);
  assert.equal(bom.totals.unweighedCount, 0);
  assert.equal(
    Number(bom.totals.massGrams.toFixed(6)),
    Number(massGramsForVolume(bom.parts[0].volumeMm3, bom.parts[0].materialId).toFixed(6))
  );
});

/* ============================================================ S2, the minimum length */

test("a screw entry states a minimum length and never a length", () => {
  const plate = createBodyFromTemplate("base_plate");
  const entries = bodyPurchasedParts(plate);
  const screws = entries.filter((entry) => entry.kind === "screw");
  assert.ok(screws.length > 0, "the retrofitted base plate's mount holes imply screws");

  for (const entry of entries) {
    // ⚠ The assertion is on the **absence of a definitive field**, not on the wording of
    // one. A row that grew a `lengthMm` beside the minimum would still read correctly in
    // the panel and would be exactly the interpolated-hole defect in a new place.
    assert.equal("lengthMm" in entry, false, `${entry.key} must not carry a definitive length`);
    assert.equal("screwLengthMm" in entry, false);
  }
  for (const entry of screws) {
    assert.ok(entry.minimumLengthMm > 0);
    const sentence = describeMinimumLength(entry);
    assert.match(sentence, /At least/u);
    assert.match(sentence, /does not model/u, "the reason a single number is not offered must be stated");
  }
});

test("a minimum length is the geometry the project holds, plus what the screw lands in", () => {
  const thicknessMm = 8;
  const body = normalizePartBody({
    id: "trap",
    name: "Trap",
    extrudeDepthMm: thicknessMm,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [
        { id: "plain", type: "circle", x: -10, z: 0, radius: 1, hole: { standard: "ISO metric", size: "M3", fit: "normal" } },
        {
          id: "nut",
          type: "circle",
          x: 10,
          z: 0,
          radius: 1,
          hole: { standard: "ISO metric", size: "M3", fit: "normal", style: "nutTrap", fromFace: "bottom" }
        }
      ]
    }
  });

  const entries = bodyPurchasedParts(body);
  const plainScrew = entries.find((entry) => entry.kind === "screw" && entry.minimumLengthMm === thicknessMm);
  assert.ok(plainScrew, "a through hole needs at least the plate it passes through");

  const nutScrew = entries.find((entry) => entry.kind === "screw" && entry.minimumLengthMm > thicknessMm);
  assert.ok(nutScrew, "a nut trap adds the depth the screw lands in");
  assert.ok(entries.some((entry) => entry.kind === "nut"), "and the nut itself is on the order");
});

test("a body with no usable thickness gets no minimum rather than a fabricated one", () => {
  const body = normalizePartBody({
    id: "gear_holes",
    name: "Gear",
    source: { kind: "spurGear" },
    gear: { toothCount: 20, moduleMm: 2 }
  });
  // A non-sketch body has no cut profiles at all, so it implies no purchased parts - which
  // is different from implying them at an unknown length.
  assert.deepEqual(bodyPurchasedParts(body), []);

  const entry = { kind: "screw", minimumLengthMm: null };
  assert.match(describeMinimumLength(entry), /depends on the assembly stack-up/u);
  assert.doesNotMatch(describeMinimumLength(entry), /\d/u, "no digits at all where there is no number");
});

/* ============================================================ designations */

test("every designation comes from the resolved hole, never from a radius", () => {
  const plate = createBodyFromTemplate("base_plate");
  const [entry] = bodyPurchasedParts(plate);

  // A4: the size is the standard's token, and the hole's own label comes from
  // `describeHole` rather than from a second description written here.
  assert.match(entry.size, /^M\d/u);
  const profile = plate.sketch.cutProfiles.find((item) => entry.sourceProfileIds.includes(item.id));
  assert.equal(entry.holeLabel, describeHole(profile.hole));
  assert.equal(describePurchased(entry), `${entry.size} screw`);

  const source = readFileSync(join(PARTS_DIR, "bom.js"), "utf8");
  assert.match(source, /describeHole/u, "the hole label must be read, not rewritten");
  assert.doesNotMatch(source, /radius\s*\*\s*2/u, "a designation derived from a radius is the defect this forbids");
});

test("a refused hole contributes no purchased part", () => {
  const body = normalizePartBody({
    id: "refused",
    name: "Refused",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [{ id: "odd", type: "circle", x: 0, z: 0, radius: 1.5, hole: { standard: "ISO metric", size: "M2.2", fit: "normal" } }]
    }
  });
  // The refusal cost the author derived geometry they never got. Listing a screw for it
  // would put a part on an order the drawing has no hole for.
  assert.deepEqual(bodyPurchasedParts(body), []);
});

test("identical fasteners group and count, across bodies", () => {
  const a = createBodyFromTemplate("base_plate");
  const b = { ...createBodyFromTemplate("base_plate"), id: "base_plate_2", name: "Second plate" };
  const bom = projectBom(projectWith(a, normalizePartBody(b)), { geometryPropertiesById: geometryFor([a]) });

  const screws = bom.purchased.filter((entry) => entry.kind === "screw");
  assert.ok(screws.length > 0);
  for (const entry of screws) {
    assert.equal(entry.quantity, entry.sourceProfileIds.length, "the count is the number of holes that asked");
    assert.ok(entry.quantity >= 2, "two identical plates must not produce two separate rows");
    assert.equal(entry.bodyIds.length, 2);
  }
  assert.equal(
    bom.totals.purchasedCount,
    bom.purchased.reduce((sum, entry) => sum + entry.quantity, 0)
  );
});

test("bom.js imports no Node built-in and no JSCAD", () => {
  // It is a DOM-free data module and it must stay one, so the absent-not-zero assertions
  // above can keep running in node without a browser or a compile.
  const source = readFileSync(join(PARTS_DIR, "bom.js"), "utf8");
  assert.equal(source.includes("node:"), false);
  assert.equal(source.includes("@jscad/modeling"), false);
});

test("a BOM row names the material the body is actually made of", () => {
  // ⚠ G2. `materialId` and mass were asserted and the rendered label never was, so
  // replacing the whole expression with the constant "PLA" - every row naming PLA
  // whatever the body was made of - left the entire suite green. A BOM is an order, and
  // the label is the part of it a human reads.
  const pla = createBodyFromTemplate("base_plate");
  const acrylic = normalizePartBody({ ...createBodyFromTemplate("base_plate"), id: "acrylic_plate", materialId: "acrylic" });
  const bom = projectBom(projectWith(pla, acrylic), { geometryPropertiesById: geometryFor([pla, acrylic]) });

  for (const row of bom.parts) {
    // Asserted through the material table's own accessor rather than against a typed
    // string, which is audit A4 applied to a label instead of a dimension.
    assert.equal(row.materialLabel, getMaterial(row.materialId).label, `${row.bodyId} mislabels its material`);
  }
  const labels = bom.parts.map((row) => row.materialLabel);
  assert.equal(new Set(labels).size, 2, "two materials must not collapse to one label");
});

/* ============================================================ G4-G7, the second gap sweep */

test("a BOM row names the process the body is actually made by", () => {
  // ⚠ G4, and G2's sibling: `materialLabel` was guarded after G2 and `processLabel` is
  // rendered in the same sentence beside it, unguarded. Replacing the whole expression
  // with the constant "FDM 3D printing" - every row naming FDM whatever the body's process
  // was - left the entire suite green.
  const printed = normalizePartBody({ ...createBodyFromTemplate("base_plate"), id: "printed_plate", processId: "fdm" });
  const cut = normalizePartBody({ ...createBodyFromTemplate("base_plate"), id: "cut_plate", processId: "laser" });
  const bom = projectBom(projectWith(printed, cut), { geometryPropertiesById: geometryFor([printed, cut]) });

  for (const row of bom.parts) {
    // Through the process table's own accessor rather than against a typed string, which
    // is audit A4 applied to a label - the same way the material row above is asserted.
    assert.equal(row.processLabel, describeProcess(row.processId), `${row.bodyId} mislabels its process`);
  }
  assert.deepEqual(bom.parts.map((row) => row.processId), ["fdm", "laser"]);
  assert.equal(new Set(bom.parts.map((row) => row.processLabel)).size, 2, "two processes must not collapse to one label");
});

test("a BOM row is titled by the body's name, not by its id", () => {
  // ⚠ G5. The row title is the only thing tying a printed line to the body the author
  // named, and every existing assertion in this file went through `bodyId`, so the title
  // could be swapped for the id and nothing noticed.
  const plate = createBodyFromTemplate("base_plate");
  assert.notEqual(plate.name, plate.id, "this test is vacuous unless the fixture's name and id differ");

  const bom = projectBom(projectWith(plate), { geometryPropertiesById: geometryFor([plate]) });
  const [row] = bom.parts;
  assert.equal(row.name, plate.name);
  assert.notEqual(row.name, row.bodyId);
});

test("a tapped hole buys nothing, because the thread is in the part", () => {
  // ⚠ G6, a refusal path no test reached. `dfm.js` has a thread-engagement rule over
  // resolved tapped holes, so the style is real and reachable; what nothing checked was
  // that it contributes no purchased row. A screw on the order for a thread cut into the
  // plate is a part somebody buys and cannot use.
  const body = normalizePartBody({
    id: "tapped_plate",
    name: "Tapped plate",
    extrudeDepthMm: 8,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [
        { id: "tapped", type: "circle", x: -10, z: 0, radius: 1, hole: { standard: "ISO metric", size: "M3", fit: "normal", style: "tapped" } }
      ]
    }
  });
  const tappedProfile = body.sketch.cutProfiles.find((profile) => profile.id === "tapped");
  assert.equal(tappedProfile.hole.style, "tapped", "the fixture must really carry a tapped hole");
  assert.deepEqual(bodyPurchasedParts(body), []);

  // The other direction, so the branch is shown reachable both ways: the same plate with a
  // clearance hole does buy a screw.
  const through = normalizePartBody({
    ...body,
    id: "through_plate",
    sketch: {
      ...body.sketch,
      cutProfiles: [{ id: "through", type: "circle", x: -10, z: 0, radius: 1, hole: { standard: "ISO metric", size: "M3", fit: "normal" } }]
    }
  });
  assert.equal(bodyPurchasedParts(through).filter((entry) => entry.kind === "screw").length, 1);
});

test("the made-parts count covers every row, weighed or not", () => {
  // ⚠ G7. `documentsSummary` renders this as "N made" directly above the rows it counts,
  // and the rule this whole module exists to enforce is that a body with no measurable
  // volume **keeps its row**. Counting only the weighed ones would restate the omission
  // the row list refuses to make - and it left the suite green.
  const plate = createBodyFromTemplate("base_plate");
  const gear = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" }, gear: { toothCount: 20, moduleMm: 2 } });
  const bom = projectBom(projectWith(plate, gear), { geometryPropertiesById: geometryFor([plate]) });

  assert.equal(bom.totals.unweighedCount, 1, "the fixture must really contain an absence");
  assert.equal(bom.parts.length, 2);
  assert.equal(bom.totals.partCount, bom.parts.length, "the summary counts the rows it summarises");
  assert.equal(bom.totals.partCount, bom.totals.unweighedCount + bom.parts.filter((row) => row.massGrams != null).length);
});
