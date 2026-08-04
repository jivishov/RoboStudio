/**
 * Cycle 09's compensation contract, asserted as properties rather than as numbers.
 *
 * Four of these tests exist because the thing they check would not otherwise fail
 * anything. A compensation applied in a second place, a sketch quietly mutated by a
 * compile, a `processId` that changes the solid without invalidating its cache entry,
 * and a `null` kerf read as zero are all silent: the geometry looks plausible, every
 * other test passes, and the symptom arrives as a wrong part or a stale preview.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

import jscad from "@jscad/modeling";

import {
  bodyCompensationReport,
  compilePartBodyToSolid,
  compileSketchToGeom2
} from "../../src/parts/cadCompile.js";
import { bodyCompileSignature, COMPILE_SIGNATURE_FIELDS } from "../../src/parts/compileCache.js";
import { createSketchExtrudeBody } from "../../src/parts/contracts.js";
import {
  InvalidCompensationValueError,
  PROCESS_COMPENSATION_FIELDS,
  PROCESS_IDS,
  PROCESS_PROFILE_FIELDS,
  UnknownProcessProfileFieldError,
  compensationTermMm,
  describeProcessCompensation,
  getProcessProfile,
  processCompensationMm,
  resolveProcessProfile
} from "../../src/parts/process.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { parsePartProjectJson, serializePartProject } from "../../src/parts/serialization.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { circleSegmentsForRadius } from "../../src/parts/tessellation.js";

const { measurements, geometries } = jscad;
const { measureArea, measureVolume } = measurements;

const PARTS_DIR = path.join(process.cwd(), "src", "parts");

/**
 * A plate with two holes and a slot, so every profile type is exercised.
 *
 * `processId` is applied on top of `createSketchExtrudeBody` rather than passed into it:
 * that factory builds the sketch-body shape and does not carry a process, so spreading
 * the override inside would have produced twenty bodies all quietly on the default -
 * and every per-process assertion below would have passed by comparing FDM with FDM.
 */
function plate(overrides = {}) {
  return normalizePartBody({
    ...createSketchExtrudeBody({
      id: "plate",
      name: "Plate",
      extrudeDepthMm: 6,
      sketch: {
        outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40, cornerRadius: 3 },
        cutProfiles: [
          { id: "hole_a", type: "circle", x: -20, z: 0, radius: 2 },
          { id: "hole_b", type: "circle", x: 20, z: 0, radius: 2 },
          { id: "slot", type: "roundedSlot", x: 0, z: 12, length: 20, width: 5 }
        ]
      }
    }),
    ...overrides
  });
}

/* =================================================== R1: exactly one place */

/**
 * Every `.js` file under `src/parts/`, with its path relative to that directory.
 */
async function partsSources() {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".js")) {
        files.push({ file: path.relative(PARTS_DIR, full).replaceAll("\\", "/"), source: await fs.readFile(full, "utf8") });
      }
    }
  }
  await walk(PARTS_DIR);
  return files;
}

/**
 * Lines that offset or dilate geometry, excluding comments.
 *
 * Deliberately not a bare `/offset/` search: `cadCompile.js` and `dfm.js` both discuss
 * the morphological route at length in prose, and a scanner that counted those would
 * report five offenders in a compliant tree and be silenced by the next author. What is
 * being looked for is a **call**.
 */
function geometryOffsetCallLines(source) {
  return source
    .split(/\r?\n/u)
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text }) => {
      const code = text.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return false;
      return /\boffset\s*\(/u.test(code) || /\bexpand\s*\(/u.test(code);
    });
}

test("compensation is applied in exactly one place, and the scanner can see one", async () => {
  const sources = await partsSources();
  assert.ok(sources.length > 20, "the walk should find the whole directory");

  const byFile = new Map(sources.map(({ file, source }) => [file, geometryOffsetCallLines(source)]));

  // A3, first half: the scanner is proved to see the one legitimate call before it is
  // trusted to find no others. A source scan that returns zero on a tree containing one
  // is cycle 08's own vacuous-test failure, and it passes by seeing nothing.
  const inCadCompile = byFile.get("cadCompile.js") ?? [];
  assert.equal(inCadCompile.length, 1, `cadCompile.js should hold exactly one offset call, found ${inCadCompile.length}`);
  assert.match(inCadCompile[0].text, /delta/u, "and it should be the compensation one");

  // The claim itself: no other module offsets a profile or a region.
  for (const [file, hits] of byFile) {
    if (file === "cadCompile.js") continue;
    assert.deepEqual(hits, [], `${file} offsets geometry outside the one compensation site`);
  }
});

test("the offset scanner reports an injected second call site", async () => {
  // A3, second half: the negative control, run rather than merely once performed. If the
  // scanner ever stops being able to see a violation, the test above passes by seeing
  // nothing - which is the exact state cycle 08's review found and this is the guard
  // against reaching it again.
  const source = await fs.readFile(path.join(PARTS_DIR, "massProperties.js"), "utf8");
  assert.deepEqual(geometryOffsetCallLines(source), [], "the control file must start clean");

  const injected = source.replace(
    "const flat = outlinesMassProperties(",
    "const dilated = offset({ delta: 0.1 }, compileSketchToGeom2(body.sketch));\n  const flat = outlinesMassProperties("
  );
  assert.notEqual(injected, source, "the injection site must still exist");
  assert.equal(geometryOffsetCallLines(injected).length, 1);

  // And prose about offsets is still not a call, so the scanner is not merely matching
  // the word. `dfm.js` discusses `expansions.offset` in its module comment and is clean.
  const dfm = await fs.readFile(path.join(PARTS_DIR, "dfm.js"), "utf8");
  assert.match(dfm, /expansions\.offset/u, "the premise: dfm.js mentions it");
  assert.deepEqual(geometryOffsetCallLines(dfm), [], "and mentioning it is not calling it");
});

/* ====================== R2: nominal is byte-identical across compile, per process */

test("a body's nominal sketch is byte-identical before and after a compile, at every process", () => {
  // The strongest test in the cycle. Stronger than "the sketch is not mutated" because it
  // covers the normalizer round trip that would persist a mutation, and run per process
  // rather than once because a compensation that is zero for one process and non-zero for
  // another passes a single-process test while being broken.
  //
  // The failure this guards against is not a wrong solid. It is a saved file that has
  // quietly stopped being nominal - and once it has, every later compile compensates a
  // number that was already compensated.
  for (const processId of PROCESS_IDS) {
    const body = plate({ processId });
    const before = JSON.stringify(body.sketch);

    compilePartBodyToSolid(body);
    bodyCompensationReport(body);
    assert.equal(JSON.stringify(body.sketch), before, `${processId}: compiling mutated the sketch`);

    // And the round trip a normalizer would perform on it, which is where a mutation
    // would become permanent.
    const restored = parsePartProjectJson(serializePartProject({
      version: 1,
      bodies: [body],
      selectedBodyId: body.id,
      updatedAt: "2026-07-29T00:00:00.000Z"
    }));
    assert.equal(JSON.stringify(restored.bodies[0].sketch), before, `${processId}: the sketch did not survive a round trip`);
    assert.equal(JSON.stringify(normalizePartBody(restored.bodies[0]).sketch), before, `${processId}: renormalizing moved it`);
  }
});

test("every process compiles the same body to the same nominal solid", () => {
  // The other half of keeping the solid nominal: two processes, one solid. A compiled
  // volume that moved with the process would mean an export moved with it too, and cycle
  // 09's plan says an export goes out uncompensated.
  const volumes = PROCESS_IDS.map((processId) => measureVolume(compilePartBodyToSolid(plate({ processId }))));
  for (const volume of volumes) assert.equal(volume, volumes[0]);
});

/* ================= R3: processId and the compile signature, in both directions */

test("switching a body's process changes neither its compiled solid nor its compile signature", () => {
  // An all-or-nothing pair. "Changes both" and "changes neither" are the only two green
  // states, and cycle 09 ships the second: the solid is nominal, so nothing needs
  // invalidating. The state to catch is the mixed one, which fails no test on its own -
  // the user switches to laser, the cache serves the printed solid, and the symptom is a
  // stale preview.
  const printed = plate({ processId: "fdm" });
  const cut = plate({ processId: "laser" });
  assert.notEqual(printed.processId, cut.processId, "the premise: these are two processes");

  assert.equal(COMPILE_SIGNATURE_FIELDS.includes("processId"), false);
  assert.equal(bodyCompileSignature(printed), bodyCompileSignature(cut));
  assert.equal(
    measureVolume(compilePartBodyToSolid(printed)),
    measureVolume(compilePartBodyToSolid(cut))
  );

  // Asserted in both directions: a field that *is* in the signature must change it, so
  // the equality above is a statement about `processId` rather than about a signature
  // that ignores everything.
  const deeper = plate({ processId: "fdm", extrudeDepthMm: 9 });
  assert.notEqual(bodyCompileSignature(printed), bodyCompileSignature(deeper));
  assert.notEqual(
    measureVolume(compilePartBodyToSolid(printed)),
    measureVolume(compilePartBodyToSolid(deeper))
  );
});

/* ============ R4: every compensation parameter is a process.js profile field */

test("every compensation parameter is a registered profile field, in both directions", () => {
  for (const field of PROCESS_COMPENSATION_FIELDS) {
    assert.ok(PROCESS_PROFILE_FIELDS.includes(field), `${field} must be registered`);
    for (const processId of PROCESS_IDS) {
      assert.ok(Object.hasOwn(getProcessProfile(processId), field), `${processId} is missing ${field}`);
    }
  }
});

test("moving one compensation parameter moves the geometry, and it is the only way to", () => {
  // The plan's "a test moves one parameter and observes the geometry change". Through an
  // override rather than by editing a profile, which is what makes raising a kerf a data
  // change rather than a code change.
  const body = plate({ processId: "laser" });
  const base = bodyCompensationReport(body);
  const widened = bodyCompensationReport(body, { processOverrides: { kerfWidthMm: 0.6 } });

  assert.ok(base.compensationMm < 0, "a kerf removes material");
  assert.equal(widened.compensationMm, -0.3, "half of the full kerf width");
  assert.ok(widened.asMade.areaMm2 < base.asMade.areaMm2, "a wider kerf leaves less material");
  assert.equal(widened.nominal.areaMm2, base.nominal.areaMm2, "and moves the drawing not at all");

  // A hole gauges over by the whole kerf, which is the number a user measures with a pin.
  // Compared to float tolerance, not exactly: the figure is `d - 2 * (-kerf / 2)`, so it
  // is a halve and a double of a decimal and lands on 0.5999999999999996.
  const [holeA] = widened.holes;
  assert.ok(Math.abs(holeA.asMadeDiameterMm - holeA.nominalDiameterMm - 0.6) < 1e-9);
});

test("an override naming an unregistered field still throws", () => {
  assert.throws(
    () => resolveProcessProfile("laser", { kerfMm: 0.2 }),
    (error) => error instanceof UnknownProcessProfileFieldError && error.field === "kerfMm"
  );
});

test("null means no compensation and zero means compensate by nothing, and they differ", () => {
  // A2, and the one distinction in this cycle that is invisible in the geometry: both
  // produce an identical solid, so only the report can tell them apart. Cycle 06 shipped
  // exactly this defect on `maxStockThicknessMm`, where `Number(null)` read as `0` and
  // turned FDM's absent ceiling into a 0 mm one.
  const absent = resolveProcessProfile("cnc");
  assert.equal(absent.kerfWidthMm, null);
  assert.equal(absent.depositionOversizeMm, null);
  assert.equal(processCompensationMm(absent), null, "no compensation is null, never 0");
  assert.equal(describeProcessCompensation(absent), null, "and there is no sentence to show");

  const measuredZero = resolveProcessProfile("cnc", { kerfWidthMm: 0 });
  assert.equal(processCompensationMm(measuredZero), 0, "a measured zero is a number");
  assert.notEqual(processCompensationMm(measuredZero), processCompensationMm(absent));
  assert.match(describeProcessCompensation(measuredZero).text, /exactly where it is drawn/u);

  // The coercion that would collapse them, refused at the helper.
  assert.equal(compensationTermMm(null), null);
  assert.equal(compensationTermMm(undefined), null);
  assert.equal(compensationTermMm(0), 0);
  assert.equal(Number(null), 0, "the premise: this is why the helper exists");

  // And a caller who mistypes a kerf is told, rather than having compensation silently
  // switched off - which is what returning null for a bad value would have done.
  for (const bad of ["0.2mm", -0.1, Number.NaN, true, {}]) {
    assert.throws(
      () => resolveProcessProfile("laser", { kerfWidthMm: bad }),
      (error) => error instanceof InvalidCompensationValueError,
      `kerfWidthMm: ${JSON.stringify(bad)} should throw`
    );
  }
  assert.doesNotThrow(() => resolveProcessProfile("laser", { kerfWidthMm: null }), "null is a legitimate value");
});

/* ============================= R5: expansions.offset, re-measured and recorded */

test("the composite-region offset defect cycle 06 recorded still reproduces", () => {
  // Re-measured before being relied on, and recorded either way, because a silent
  // difference between the two uses would be the worst outcome. Cycle 09's R5 guessed
  // that a per-profile offset before the boolean might be unaffected by a defect found
  // on a composite region. It is, and this pins both halves.
  const { booleans, expansions, primitives } = jscad;
  const outer = primitives.rectangle({ center: [0, 0], size: [60, 30] });
  const holesAt = (gap) => [
    primitives.circle({ center: [-gap / 2, 0], radius: 5, segments: 64 }),
    primitives.circle({ center: [gap / 2, 0], radius: 5, segments: 64 })
  ];

  // The defect: two dilated holes pass through one another instead of merging. Dilating
  // r5 holes 12 mm apart by 1.5 mm makes them r6.5 at 12 mm centres, so they overlap by
  // 1 mm and the 2 mm web between them should be gone - one opening where there were
  // two. The composite offset keeps three outlines, which is the plate plus two holes
  // that never saw each other.
  const narrow = booleans.subtract(outer, ...holesAt(12));
  const dilate = (region) => expansions.offset({ delta: -1.5, corners: "edge", segments: 64 }, region);
  assert.equal(geometries.geom2.toOutlines(narrow).length, 3, "the premise: a plate and two holes");
  assert.equal(geometries.geom2.toOutlines(dilate(narrow)).length, 3, "the web survives a cut that should remove it");

  // The same call on a plate whose holes are far enough apart to stay separate is
  // indistinguishable, which is the second half of the proof: the composite offset is
  // not merely imprecise about the merge, it does not model one.
  const wide = booleans.subtract(outer, ...holesAt(30));
  assert.equal(geometries.geom2.toOutlines(dilate(wide)).length, 3);
  assert.ok(
    Math.abs(measureArea(dilate(narrow)) - measureArea(dilate(wide))) < 1,
    "two plates that should differ by a consumed web measure within a square millimetre"
  );

  // A region thinner than the offset depth still returns a negative area.
  const thin = primitives.rectangle({ center: [0, 0], size: [20, 1] });
  assert.equal(measureArea(thin), 20);
  assert.ok(measureArea(expansions.offset({ delta: -0.6, corners: "edge", segments: 64 }, thin)) < 0);

  // The per-profile route, which is what shipped: the boolean does the merging, so the
  // same two holes at the same delta consume the web and leave two outlines.
  const perProfile = booleans.subtract(
    primitives.rectangle({ center: [0, 0], size: [60 - 3, 30 - 3] }),
    primitives.circle({ center: [-6, 0], radius: 6.5, segments: 64 }),
    primitives.circle({ center: [6, 0], radius: 6.5, segments: 64 })
  );
  assert.equal(geometries.geom2.toOutlines(perProfile).length, 2, "the correct answer, from the same delta");
});

test("compensating a circle, a rectangle and a slot is exact rather than morphological", () => {
  // Which is why the per-profile route costs nothing in accuracy for three of the four
  // profile types: a compensated circle is a circle with a different radius, not a
  // dilated polygon. Asserted as an area identity against the primitive itself.
  const region = compileSketchToGeom2(
    { outerProfile: { id: "outer", type: "circle", x: 0, z: 0, radius: 10 }, cutProfiles: [] },
    { compensationMm: -0.075 }
  );
  // Segments from the *nominal* radius in both, which is deliberate in the source: a
  // tenth of a millimetre of compensation must not change a hole's tessellation density,
  // or two bodies drawn identically would mesh differently on two processes.
  const exact = jscad.primitives.circle({
    center: [0, 0],
    radius: 10 - 0.075,
    segments: circleSegmentsForRadius(10)
  });
  assert.equal(measureArea(region), measureArea(exact), "a compensated circle is a circle, not a dilated polygon");
});

/* ================================== R8: both numbers, and never one of them */

test("the report states both numbers for every hole, and never one without the other", () => {
  const body = plate({ processId: "fdm" });
  const report = bodyCompensationReport(body);

  assert.ok(report.compensationMm > 0, "a nozzle leaves more material than drawn");
  assert.equal(report.holes.length, 2, "circles only; a slot is not a hole");
  for (const hole of report.holes) {
    assert.ok(Number.isFinite(hole.nominalDiameterMm) && hole.nominalDiameterMm > 0);
    assert.ok(Number.isFinite(hole.asMadeDiameterMm));
    assert.notEqual(hole.asMadeDiameterMm, hole.nominalDiameterMm, "two numbers, not one repeated");
    // A printed hole comes out narrower than drawn. Getting this sign backwards is the
    // most likely defect in the whole cycle and the least visible.
    assert.ok(hole.asMadeDiameterMm < hole.nominalDiameterMm);
  }

  assert.ok(report.asMade.areaMm2 > report.nominal.areaMm2, "a printed plate is fatter than drawn");
  assert.match(report.compensationText, /narrower than drawn/u);
});

test("a laser widens holes and narrows the part, from the same one number", () => {
  const report = bodyCompensationReport(plate({ processId: "laser" }));
  assert.ok(report.compensationMm < 0);
  for (const hole of report.holes) assert.ok(hole.asMadeDiameterMm > hole.nominalDiameterMm);
  assert.ok(report.asMade.areaMm2 < report.nominal.areaMm2);
  assert.match(report.compensationText, /wider than drawn/u);
  assert.match(report.compensationText, /kerf/u);
});

test("a process with no compensation reports absence as absence, never as zero", () => {
  // A2 at the report boundary, which is the last place a null could become a 0.000 in a
  // cell. Every as-made field is null and the nominal side is still present, so a card
  // can show the drawing and say plainly that there is no second number.
  const report = bodyCompensationReport(plate({ processId: "cnc" }));
  assert.equal(report.compensationMm, null);
  assert.equal(report.compensationText, null);
  assert.equal(report.kerfWidthMm, null);
  assert.equal(report.depositionOversizeMm, null);
  assert.equal(report.asMade, null);
  assert.ok(report.nominal.areaMm2 > 0, "the drawing is still measurable");
  for (const hole of report.holes) {
    assert.equal(hole.asMadeDiameterMm, null);
    assert.ok(hole.nominalDiameterMm > 0);
  }
});

test("a template body reports both numbers through the same path as a hand-drawn one", () => {
  // Nothing about compensation is template-specific, and this is the assertion that says
  // so: a retrofitted M3 clearance hole is 3.4 mm drawn and something else printed, and
  // the report gets there without knowing it came from a template.
  const report = bodyCompensationReport(createBodyFromTemplate("base_plate"));
  assert.equal(report.processId, "fdm");
  assert.equal(report.holes.length, 4);
  for (const hole of report.holes) {
    assert.equal(hole.nominalDiameterMm, 3.4);
    assert.equal(hole.asMadeDiameterMm, 3.4 - 2 * report.compensationMm);
  }
});

test("a feature the compensation closes up goes absent with a reason, and does not throw", () => {
  // Found by reviewing this cycle's own code rather than by a failing test. The geometry
  // path is right to throw on a feature smaller than the compensation - a compile must
  // not build a solid it cannot describe - but the report is read on every render of the
  // Manufacturability card, so the same throw there would take the inspector down over a
  // 0.05 mm slot that `dfm-min-feature` has already reported in gentler words.
  // FDM rather than laser, which the first draft of this test got backwards. A kerf
  // *widens* a hole, so no hole ever closes on a subtractive process - it is the additive
  // one, laying material into the void, that can consume a small hole entirely. The
  // mirror case is an outer profile too thin to survive a kerf, and it is the same guard.
  const body = plate({ processId: "fdm" });
  body.sketch.cutProfiles.push({ id: "hairline", type: "circle", x: 0, z: -12, radius: 0.02 });
  const compensationMm = bodyCompensationReport(body).compensationMm;
  assert.ok(compensationMm > 0.02, "the premise: the nozzle lays more material than this hole is wide");

  // The premise: the geometry path does refuse it.
  assert.throws(() => compileSketchToGeom2(body.sketch, { compensationMm }), /closes up under/u);

  // And the report survives, with the nominal side intact and the as-made side absent
  // for a stated reason rather than absent silently or fabricated as a negative.
  const report = bodyCompensationReport(body);
  assert.ok(report.nominal.areaMm2 > 0, "the drawing is still measurable");
  assert.equal(report.asMade, null);
  assert.match(report.asMadeUnavailableReason, /hairline/u, "the reason names the feature");

  const hairline = report.holes.find((hole) => hole.id === "hairline");
  assert.equal(hairline.nominalDiameterMm, 0.04, "what was asked for");
  assert.equal(hairline.asMadeDiameterMm, null, "a closed-up hole has no diameter, not a negative one");
  // The holes the process can actually make still report both numbers, so one bad
  // feature does not blank the rest of the card.
  const holeA = report.holes.find((hole) => hole.id === "hole_a");
  assert.ok(holeA.asMadeDiameterMm > 0 && holeA.asMadeDiameterMm < holeA.nominalDiameterMm);
});

test("a compensation that is not a number throws instead of quietly meaning nominal", () => {
  // The same defect class as null-read-as-zero, committed inside the function that exists
  // to prevent it: a NaN falling back to 0 would disable compensation and look exactly
  // like a process with no kerf. Absent still means nominal, because that is what every
  // pre-cycle-09 caller means by passing nothing.
  const { sketch } = plate();
  assert.doesNotThrow(() => compileSketchToGeom2(sketch));
  assert.doesNotThrow(() => compileSketchToGeom2(sketch, {}));
  assert.doesNotThrow(() => compileSketchToGeom2(sketch, { compensationMm: null }));
  for (const bad of [Number.NaN, "0.1mm", {}, Number.POSITIVE_INFINITY]) {
    assert.throws(() => compileSketchToGeom2(sketch, { compensationMm: bad }), /finite number/u, JSON.stringify(bad));
  }
});

test("a body with no sketch reports the process and refuses to invent geometry", () => {
  const report = bodyCompensationReport({ id: "gear", processId: "laser" });
  assert.equal(report.processId, "laser");
  assert.ok(report.compensationMm < 0, "the process still has a kerf");
  assert.deepEqual(report.holes, []);
  assert.equal(report.nominal, null, "and no area, rather than an area of zero");
  assert.equal(report.asMade, null);
});
