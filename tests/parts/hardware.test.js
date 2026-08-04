import assert from "node:assert/strict";
import test from "node:test";

import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { createSketchExtrudeBody } from "../../src/parts/contracts.js";
import { profileHoleResolution } from "../../src/parts/holes.js";
import {
  HARDWARE_CATEGORIES,
  HARDWARE_ENTRY_IDS,
  HARDWARE_INVALID_PLACEMENT,
  HARDWARE_UNKNOWN_ENTRY,
  HARDWARE_UNRESOLVABLE_HOLE,
  HARDWARE_UNSOURCED_COMPONENT,
  appendHardwarePatternToSketch,
  getHardwareEntry,
  listHardwareEntries,
  resolveHardwarePattern
} from "../../src/parts/hardware.js";
import { normalizePartBody, normalizePartProject } from "../../src/parts/projectState.js";
import { parsePartProjectJson, serializePartProject } from "../../src/parts/serialization.js";
import {
  COMPONENT_CONFIDENCES,
  COMPONENT_IDS,
  UNSOURCED_COMPONENT_IDS,
  componentDimensionMm,
  componentDimensions,
  locatingBoreMm,
  locatingFitClass
} from "../../src/parts/standards/components.js";
import { fitBoreMm } from "../../src/parts/standards/fits.js";
import { clearanceHoleDiameterMm, heatSetInsertMm } from "../../src/parts/standards/fasteners.js";
import { validateBody } from "../../src/parts/validation.js";

/** A 120 by 80 plate with nothing in it, for a pattern to be applied to. */
function plate() {
  return normalizePartBody({
    id: "plate",
    name: "Plate",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 120, height: 80 },
      cutProfiles: []
    }
  });
}

/* ------------------------------------------------------- the provenance rule */

test("every catalogue entry resolves with provenance for every dimension it publishes", () => {
  for (const id of HARDWARE_ENTRY_IDS) {
    const resolved = resolveHardwarePattern(id, { centerX: 0, centerZ: 0 });
    assert.ok(resolved.ok, `${id} should resolve at its defaults: ${resolved.reason ?? ""}`);
    assert.ok(resolved.profiles.length > 0, `${id} should produce at least one cut`);
    assert.ok(resolved.provenance.length > 0, `${id} should cite something`);

    for (const entry of resolved.provenance) {
      assert.ok(entry.dimension, `${id} has a provenance entry with no dimension`);
      assert.ok(entry.source && entry.source.length > 10, `${id}/${entry.dimension} needs a re-checkable source`);
      assert.ok(COMPONENT_CONFIDENCES.includes(entry.confidence), `${id}/${entry.dimension} confidence`);
    }
  }
});

test("no entry publishes an unverified dimension without a provenance note", () => {
  // The acceptance criterion, and the reason `confidence` is not decorative: a number
  // nobody has checked against a standard may still ship - withholding a value the
  // page holds would be as dishonest as laundering it - but it may not ship silently.
  // The note is what a reader needs to decide whether to trust it.
  for (const id of HARDWARE_ENTRY_IDS) {
    const resolved = resolveHardwarePattern(id, { centerX: 0, centerZ: 0 });
    for (const entry of resolved.provenance) {
      if (entry.confidence === "verified") continue;
      assert.ok(
        entry.note && entry.note.length > 20,
        `${id}/${entry.dimension} is unverified and must carry a note saying what is unverified about it`
      );
      assert.ok(resolved.unverifiedDimensions.includes(entry.dimension), `${id} should name ${entry.dimension}`);
    }
  }
});

test("the same rule holds for every dimension in the component table, entry or not", () => {
  // Asserted at the data rather than only through the entries that happen to consume
  // it. A dimension added to `components.js` for a future entry is covered from the
  // moment it is written, not from the moment somebody resolves it.
  for (const id of COMPONENT_IDS) {
    const dimensions = componentDimensions(id);
    assert.ok(dimensions.length > 0, `${id} publishes nothing`);
    for (const dimension of dimensions) {
      assert.ok(Number.isFinite(dimension.valueMm) && dimension.valueMm > 0, `${id}/${dimension.dimension}`);
      assert.ok(dimension.source.length > 10, `${id}/${dimension.dimension} needs a source`);
      if (dimension.confidence !== "verified") {
        assert.ok(dimension.note, `${id}/${dimension.dimension} is unverified and needs a note`);
      }
    }
  }
});

test("a locating bore is two provenance entries, because they come from two documents", () => {
  // Cycle 08's test, re-based rather than deleted. It asserted the seat was the nominal
  // plus `LOCATING_CLEARANCE_MM` and that the allowance's provenance entry admitted to
  // being shop practice. That constant is gone, so the same ground is covered against
  // what replaced it: the seat is now the H7 bore at the same nominal, and the second
  // provenance entry cites ISO 286-2 instead of confessing. Deleting the assertion with
  // the constant would have lost the evidence that the replacement covers the ground.
  const seat = locatingBoreMm("bearing608", "outerDiameterMm");
  const nominalMm = componentDimensionMm("bearing608", "outerDiameterMm");
  assert.equal(seat.nominalMm, nominalMm);

  // Through the fits accessor, never a literal: a test that writes 22.0105 proves the
  // midpoint arithmetic was done twice.
  assert.equal(seat.diameterMm, fitBoreMm("H7/h6", nominalMm).drawnDiameterMm);
  assert.equal(seat.fitClass, locatingFitClass("bearing608", "outerDiameterMm").fitClass);
  assert.ok(seat.minMm < seat.diameterMm && seat.diameterMm < seat.maxMm, "the drawn bore sits inside the band");

  // Still two entries and still for cycle 08's reason: the nominal is ISO 15 and the
  // fit is ISO 286, and a single "22.0105 mm from ISO 15" would cite one document for a
  // number the other contains.
  assert.equal(seat.provenance.length, 2);
  const [nominal, fit] = seat.provenance;
  assert.equal(nominal.confidence, "verified");
  assert.match(nominal.source, /ISO 15/u);
  assert.match(fit.source, /ISO 286-2/u);
  assert.notEqual(nominal.source, fit.source);
  // And the retired allowance left nothing behind. A note deferring to a future cycle
  // is the shape of the thing that was replaced.
  assert.equal(Object.hasOwn(seat, "allowanceMm"), false);
  assert.equal(fit.note, undefined, "a verified class choice needs no note");
});

test("a locating fit whose class choice is unverified says so, and names what is unverified", () => {
  // The NEMA pilot is the honest half of the pair. ISO 286-2 publishes what H7 means;
  // NEMA ICS 16-2001 dimensions the boss and does not tolerance it, so pairing the two
  // is a design choice. It ships labelled rather than withheld - cycle 05's rule - and
  // it is what keeps the unverified-needs-a-note machinery about a real dimension.
  const pilot = locatingBoreMm("nema17", "pilotDiameterMm");
  const [nominal, fit] = pilot.provenance;

  assert.equal(nominal.confidence, "verified");
  assert.match(nominal.source, /NEMA ICS 16-2001/u);
  assert.equal(fit.confidence, "unverified");
  assert.match(fit.source, /ISO 286-2/u, "the limits are published even where the class choice is not");
  assert.match(fit.note, /does not tolerance it/u);
});

test("a locating bore refuses for a dimension with no recorded fit class", () => {
  // Not a default. A bore over an unconsidered dimension is the mistake the retired
  // allowance made - one number applied to every seat because it was there.
  assert.equal(locatingFitClass("bearing608", "boreDiameterMm"), null);
  assert.equal(locatingBoreMm("bearing608", "boreDiameterMm"), null);
  assert.equal(locatingBoreMm("nema17", "frameWidthMm"), null);
  assert.equal(locatingBoreMm("nema17", "notADimension"), null);
  assert.equal(locatingBoreMm("mg996r", "outerDiameterMm"), null);
});

/* ------------------------------------------------------------- the refusals */

test("an unsourced component refuses by name, with the reason it is absent", () => {
  // The whole point of `UNSOURCED_COMPONENTS`. Each of these was flagged by the meta
  // plan as directionally correct and unverified; each is refused rather than shipped,
  // and the refusal says which one and why, so the next author does not repeat the
  // search that failed.
  for (const id of UNSOURCED_COMPONENT_IDS) {
    const refused = resolveHardwarePattern(id, { centerX: 0, centerZ: 0 });
    assert.equal(refused.ok, false, `${id} must not resolve`);
    assert.equal(refused.code, HARDWARE_UNSOURCED_COMPONENT);
    assert.equal(refused.profiles, null, "a refusal produces no geometry at all");
    assert.match(refused.reason, new RegExp(id, "u"), "the reason must name the component");
    assert.ok(refused.reason.length > 80, `${id} needs a reason a reader can act on`);
  }

  // And they are genuinely not entries, rather than entries that happen to refuse.
  for (const id of UNSOURCED_COMPONENT_IDS) {
    assert.equal(HARDWARE_ENTRY_IDS.includes(id), false);
    assert.equal(getHardwareEntry(id), null);
  }
});

test("a typo refuses differently from a decision, and lists what does exist", () => {
  // The two codes must be two codes. One is a typo and the other is a decision somebody
  // made and wrote down, and a caller that cannot tell them apart cannot show the
  // recorded reason - which is the entire value of `UNSOURCED_COMPONENTS`.
  assert.notEqual(HARDWARE_UNKNOWN_ENTRY, HARDWARE_UNSOURCED_COMPONENT);

  const refused = resolveHardwarePattern("nema18_face", { centerX: 0, centerZ: 0 });
  assert.equal(refused.code, HARDWARE_UNKNOWN_ENTRY);
  assert.match(refused.reason, /nema18_face/u);
  for (const id of HARDWARE_ENTRY_IDS) assert.match(refused.reason, new RegExp(id, "u"));
});

test("an unsourced fastener combination refuses through the one refusal rule on the page", () => {
  // Delegated to `resolveHole` rather than reimplemented: a heat-set insert bore for
  // M2.5 is not the mean of the M2 and M4 bores, and the sentence saying so should be
  // the same sentence a single hole would give.
  assert.equal(heatSetInsertMm("M2.5"), null, "the premise: the table holds no M2.5 insert");

  const refused = resolveHardwarePattern("heatset_boss_group", { size: "M2.5", count: 3 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, HARDWARE_UNRESOLVABLE_HOLE);
  assert.equal(refused.profiles, null);
  assert.match(refused.reason, /M2\.5/u);
  assert.match(refused.reason, /vendor specifications/u);

  // A size the table does not hold at all refuses too, and names the published set.
  const unknown = resolveHardwarePattern("fastener_bolt_circle", { size: "M3.5" });
  assert.equal(unknown.code, HARDWARE_UNRESOLVABLE_HOLE);
  assert.match(unknown.reason, /M3\.5/u);
});

test("a refusal is all or nothing, never a partial pattern", () => {
  // Four of six bolt holes look deliberate, which makes a partial pattern worse than
  // no pattern. `resolveHole` refuses at the first hole and the entry abandons the rest.
  const refused = resolveHardwarePattern("fastener_bolt_circle", { count: 6, size: "M10" });
  assert.equal(refused.ok, false);
  assert.equal(refused.profiles, null);
});

test("a placement that is not a number refuses instead of producing NaN geometry", () => {
  for (const options of [
    { centerX: Number.NaN },
    { centerZ: "middle" },
    { count: 0 },
    { pitchRadiusMm: -5 }
  ]) {
    const refused = resolveHardwarePattern("fastener_bolt_circle", options);
    assert.equal(refused.ok, false, JSON.stringify(options));
    assert.equal(refused.code, HARDWARE_INVALID_PLACEMENT);
  }
});

/* ------------------------------------------------------------ the geometry */

test("the NEMA 17 face pattern is the published bolt square and pilot, not a copy of them", () => {
  const resolved = resolveHardwarePattern("nema17_face", { centerX: 0, centerZ: 0 });
  const bolts = resolved.profiles.filter((profile) => profile.hole);
  const pilot = resolved.profiles.find((profile) => !profile.hole);

  assert.equal(bolts.length, 4);
  // Asserted through the accessor. A test that writes 15.5 proves the number was typed
  // twice; this one proves the pattern and the standard cannot drift apart.
  const half = componentDimensionMm("nema17", "boltSpacingMm") / 2;
  assert.deepEqual(
    bolts.map((profile) => [profile.x, profile.z]).sort(),
    [[-half, -half], [-half, half], [half, -half], [half, half]].sort()
  );
  for (const bolt of bolts) {
    assert.equal(bolt.radius, clearanceHoleDiameterMm("M3", "normal") / 2);
    assert.ok(profileHoleResolution(bolt).ok);
  }

  // The bore has to be larger than the boss or the motor does not go in, which is the
  // defect the shipped 22.0 mm bore had.
  assert.ok(pilot);
  assert.equal(pilot.radius, locatingBoreMm("nema17", "pilotDiameterMm").diameterMm / 2);
  assert.ok(pilot.radius * 2 > componentDimensionMm("nema17", "pilotDiameterMm"));
  assert.equal(Object.hasOwn(pilot, "hole"), false, "a locating boss is not a screw");
});

test("the 608 seat accepts a 608 at a published fit, which the template's old bore did not", () => {
  const resolved = resolveHardwarePattern("bearing_seat_608", { centerX: 0, centerZ: 0 });
  const [seat] = resolved.profiles;
  const outerDiameter = componentDimensionMm("bearing608", "outerDiameterMm");

  assert.equal(resolved.profiles.length, 1);
  assert.ok(seat.radius * 2 > outerDiameter, `a ${seat.radius * 2} mm bore must exceed a ${outerDiameter} mm race`);
  // Re-based off `LOCATING_CLEARANCE_MM` onto the fits table, and asserted through its
  // accessor. The old bore was 0.2 mm over nominal by feel; H7 at 22 mm is 0 to
  // 0.021 mm, so this is an order of magnitude tighter and quoted rather than felt.
  assert.equal(seat.radius, fitBoreMm("H7/h6", outerDiameter).drawnDiameterMm / 2);
  assert.ok(seat.radius * 2 - outerDiameter < 0.05, "an H7 seat is a fit, not a rattle");
});

test("a heat-set group resolves to insert bores at the vendor's own diameter", () => {
  const resolved = resolveHardwarePattern("heatset_boss_group", { size: "M3", count: 3, spacingMm: 15 });
  assert.equal(resolved.profiles.length, 3);
  assert.deepEqual(resolved.profiles.map((profile) => profile.x), [-15, 0, 15]);

  for (const profile of resolved.profiles) {
    const hole = profileHoleResolution(profile);
    assert.equal(hole.pocket.style, "heatSetInsert");
    assert.equal(hole.pocket.diameterMm, heatSetInsertMm("M3").boreDiameterMm);
    // The pilot is still a through clearance hole, so a screw longer than the insert
    // does not bottom out - cycle 05's stepped-hole decision, inherited whole.
    assert.equal(profile.radius, clearanceHoleDiameterMm("M3", "normal") / 2);
  }
});

test("a bolt circle and a corner square place holes the fastener table sizes", () => {
  const circle = resolveHardwarePattern("fastener_bolt_circle", {
    count: 4,
    pitchRadiusMm: 20,
    size: "M4",
    fit: "loose",
    startAngleDeg: 45
  });
  assert.equal(circle.profiles.length, 4);
  for (const profile of circle.profiles) {
    assert.equal(profile.radius, clearanceHoleDiameterMm("M4", "loose") / 2);
    assert.ok(Math.abs(Math.hypot(profile.x, profile.z) - 20) < 1e-9);
  }

  const square = resolveHardwarePattern("fastener_corner_square", { spacingMm: 50, size: "M5" });
  assert.equal(square.profiles.length, 4);
  for (const profile of square.profiles) {
    assert.equal(Math.abs(profile.x), 25, "spacing is centre-to-centre, so the entry halves it");
    assert.equal(profile.radius, clearanceHoleDiameterMm("M5", "normal") / 2);
  }
});

test("the catalogue listing is metadata only and carries no geometry", () => {
  const entries = listHardwareEntries();
  assert.equal(entries.length, HARDWARE_ENTRY_IDS.length);
  for (const entry of entries) {
    assert.ok(entry.label && entry.category && entry.summary);
    const keys = Object.keys(entry).sort();
    assert.deepEqual(keys, ["category", "componentId", "id", "label", "summary"]);
    // The vocabulary is checked rather than documented. A typo'd category would open a
    // silent one-entry group in the Advanced card, which reads as a missing feature.
    assert.ok(HARDWARE_CATEGORIES.includes(entry.category), `${entry.id} category ${entry.category}`);
    // A component entry names a component the table holds; a fastener pattern names none.
    if (entry.componentId !== null) {
      assert.ok(COMPONENT_IDS.includes(entry.componentId), `${entry.id} names ${entry.componentId}`);
    }
  }
});

/* ------------------------------------------------ applying one to a body */

test("applying a pattern twice does not collide with the ids already in the sketch", () => {
  const body = plate();
  const first = appendHardwarePatternToSketch(body.sketch, "fastener_corner_square", { spacingMm: 60 });
  assert.equal(first.ok, true);
  const second = appendHardwarePatternToSketch(first.sketch, "fastener_corner_square", { spacingMm: 40 });
  assert.equal(second.ok, true);

  const ids = second.sketch.cutProfiles.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id among ${ids.join(", ")}`);
  assert.equal(ids.length, 8);
});

test("appending returns a new sketch rather than mutating the one it was given", () => {
  const body = plate();
  const before = body.sketch.cutProfiles.length;
  appendHardwarePatternToSketch(body.sketch, "bearing_seat_608", {});
  assert.equal(body.sketch.cutProfiles.length, before);
});

test("a refused pattern leaves the sketch exactly as it was", () => {
  const body = plate();
  const result = appendHardwarePatternToSketch(body.sketch, "mg996r", {});
  assert.equal(result.ok, false);
  assert.equal(result.sketch, body.sketch, "the same object, not a copy with nothing added");
  assert.equal(result.resolved.code, HARDWARE_UNSOURCED_COMPONENT);
});

test("a hardware pattern survives save, reload and normalizePartBody unchanged", () => {
  // The acceptance criterion, and the reason nothing is persisted for a hardware
  // pattern: the cuts it produces are ordinary cuts. The round trip is asserted the
  // hard way - a rename after the restore - because an unregistered field's real
  // failure mode is not "did not save", it is "saved fine, gone after the next edit".
  const body = plate();
  const applied = appendHardwarePatternToSketch(body.sketch, "nema17_face", { centerX: 10, centerZ: 5 });
  assert.equal(applied.ok, true);

  const withPattern = normalizePartBody({ ...body, sketch: applied.sketch });
  assert.equal(validateBody(withPattern).length, 0);
  assert.ok(compilePartBodyToSolid(withPattern));

  const project = normalizePartProject({ bodies: [withPattern], selectedBodyId: withPattern.id });
  const restored = parsePartProjectJson(serializePartProject(project));
  assert.deepEqual(restored.bodies[0].sketch, withPattern.sketch);

  const renamed = normalizePartBody({ ...restored.bodies[0], name: "Renamed after restore" });
  assert.deepEqual(renamed.sketch, withPattern.sketch);

  // And no `hardware` field was invented anywhere along the way, on the body or on a
  // profile. If one ever is, it is landmine two and needs registering.
  assert.equal(serializePartProject(project).includes("hardware"), false);
});

test("a resolved pattern is indistinguishable from hand-authored cuts", () => {
  // Which is the whole design: profiles, not a body, and no marker field. A reader of
  // the saved project cannot tell a NEMA pattern from four holes somebody typed, and
  // that is why nothing has to be migrated when the catalogue changes.
  const resolved = resolveHardwarePattern("fastener_corner_square", { spacingMm: 40, size: "M3" });
  for (const profile of resolved.profiles) {
    assert.deepEqual(Object.keys(profile).sort(), ["hole", "id", "radius", "type", "x", "z"]);
    assert.deepEqual(Object.keys(profile.hole).sort(), [
      "fit",
      "fromFace",
      "lockSize",
      "process",
      "size",
      "standard",
      "style"
    ]);
  }
});

test("a body built only from hardware patterns compiles and validates", () => {
  let sketch = {
    outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 90, height: 90, cornerRadius: 3 },
    cutProfiles: []
  };
  for (const [entryId, options] of [
    ["nema17_face", { centerX: 0, centerZ: 0 }],
    ["fastener_corner_square", { spacingMm: 78, size: "M4" }]
  ]) {
    const applied = appendHardwarePatternToSketch(sketch, entryId, options);
    assert.equal(applied.ok, true, applied.resolved?.reason);
    sketch = applied.sketch;
  }

  const body = normalizePartBody(createSketchExtrudeBody({ id: "nema_plate", name: "NEMA plate", sketch }));
  assert.deepEqual(validateBody(body), []);
  assert.ok(compilePartBodyToSolid(body));
  assert.equal(body.sketch.cutProfiles.length, 9);
});

test("a resolved pattern describes itself well enough for a status line", () => {
  const resolved = resolveHardwarePattern("nema17_face", {});
  assert.match(resolved.label, /NEMA 17 motor face/u);
  assert.match(resolved.label, /5 cuts/u);
  assert.match(resolved.label, /M3 through hole/u);
});
