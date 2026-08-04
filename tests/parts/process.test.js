import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROCESS_ID,
  PROCESS_IDS,
  PROCESS_PROFILE_FIELDS,
  PROCESS_PROFILES,
  UnknownProcessProfileFieldError,
  describeProcess,
  effectiveMinFeatureMm,
  effectiveMinWallMm,
  getProcessProfile,
  listProcessProfiles,
  normalizeProcessId,
  resolveProcessProfile
} from "../../src/parts/process.js";
import { MATERIAL_PROCESSES } from "../../src/parts/materials.js";

test("every published profile is listed, frozen, and named by PROCESS_IDS", () => {
  assert.deepEqual(
    listProcessProfiles().map((entry) => entry.id),
    [...PROCESS_IDS]
  );
  for (const entry of PROCESS_PROFILES) {
    assert.ok(Object.isFrozen(entry), `${entry.id} must be frozen`);
    assert.ok(entry.label && entry.note, `${entry.id} must say what it is and how confident it is`);
    assert.equal(getProcessProfile(entry.id), entry);
  }
});

test("a process id is one the material catalog also knows", () => {
  // `materials.js` decides which materials a process can make, so a profile id
  // that is not in its vocabulary would make the material rule permanently silent.
  for (const id of PROCESS_IDS) {
    assert.ok(MATERIAL_PROCESSES.includes(id), `${id} must be a material-catalog process`);
  }
});

test("every threshold a rule may read is registered, and nothing else is present", () => {
  const structural = new Set(["id", "label", "note", "additive"]);
  for (const entry of PROCESS_PROFILES) {
    for (const field of Object.keys(entry)) {
      if (structural.has(field)) continue;
      assert.ok(
        PROCESS_PROFILE_FIELDS.includes(field),
        `${entry.id}.${field} is not a registered profile field, so no rule can be trusted to read it`
      );
    }
    // The converse: a registered field absent from a profile would read as
    // `undefined` in a rule rather than as an explicit "no such limit".
    for (const field of PROCESS_PROFILE_FIELDS) {
      assert.ok(field in entry, `${entry.id} is missing ${field}`);
    }
  }
});

test("normalizeProcessId falls back rather than keeping an id this build has no thresholds for", () => {
  assert.equal(normalizeProcessId("cnc"), "cnc");
  assert.equal(normalizeProcessId("laser"), "laser");
  assert.equal(normalizeProcessId(undefined), DEFAULT_PROCESS_ID);
  assert.equal(normalizeProcessId(null), DEFAULT_PROCESS_ID);
  assert.equal(normalizeProcessId("waterjet"), DEFAULT_PROCESS_ID);
  assert.equal(normalizeProcessId("sheet"), DEFAULT_PROCESS_ID, "a material process with no profile is not a process id");
});

test("resolveProcessProfile takes an id, a profile, or neither", () => {
  assert.equal(resolveProcessProfile("cnc").id, "cnc");
  assert.equal(resolveProcessProfile().id, DEFAULT_PROCESS_ID);
  assert.equal(resolveProcessProfile("nonsense").id, DEFAULT_PROCESS_ID);
  const explicit = getProcessProfile("laser");
  assert.equal(resolveProcessProfile(explicit), explicit);
});

test("an override changes a threshold without touching the published profile", () => {
  const base = getProcessProfile("fdm");
  const overridden = resolveProcessProfile("fdm", { maxBridgeSpanMm: 0.5 });

  assert.equal(overridden.maxBridgeSpanMm, 0.5);
  assert.equal(overridden.id, "fdm");
  assert.equal(base.maxBridgeSpanMm, getProcessProfile("fdm").maxBridgeSpanMm);
  assert.notEqual(base.maxBridgeSpanMm, 0.5, "the published profile must not have been mutated");
});

test("an override naming no known field is refused rather than silently dropped", () => {
  // A user who mistypes `maxBridgeMm` has said something about their printer, and
  // merging it would mean the page ignored them while appearing to agree.
  assert.throws(
    () => resolveProcessProfile("fdm", { maxBridgeMm: 4 }),
    (error) => {
      assert.ok(error instanceof UnknownProcessProfileFieldError);
      assert.equal(error.field, "maxBridgeMm");
      assert.match(error.message, /maxBridgeSpanMm/u);
      return true;
    }
  );
});

test("the FDM bridge limit is a profile parameter and not a constant", () => {
  // The meta plan names this one specifically: printer and cooling dependent.
  const fdm = getProcessProfile("fdm");
  assert.ok(Number.isFinite(fdm.maxBridgeSpanMm) && fdm.maxBridgeSpanMm > 0);
  assert.match(fdm.note, /printer and cooling dependent/u);
  assert.equal(resolveProcessProfile("fdm", { maxBridgeSpanMm: 25 }).maxBridgeSpanMm, 25);
});

test("a process with no such limit says null rather than zero", () => {
  // Zero would read as "this process bridges nothing at all", which is the
  // opposite of "this process never bridges".
  const laser = getProcessProfile("laser");
  assert.equal(laser.maxBridgeSpanMm, null);
  assert.equal(laser.maxOverhangAngleDeg, null);
  assert.equal(laser.bedFace, null);
  assert.equal(getProcessProfile("cnc").maxOverhangAngleDeg, null);
  assert.equal(getProcessProfile("fdm").maxHoleDepthRatio, null);
});

test("only the additive process has a bed face", () => {
  for (const entry of PROCESS_PROFILES) {
    assert.equal(Boolean(entry.bedFace), entry.additive, `${entry.id} bedFace must follow whether it is additive`);
  }
  assert.equal(getProcessProfile("fdm").bedFace, "bottom");
});

test("a laser has no blind pockets and the subtractive processes do", () => {
  assert.equal(getProcessProfile("laser").pocketsSupported, false);
  assert.equal(getProcessProfile("cnc").pocketsSupported, true);
  assert.equal(getProcessProfile("fdm").pocketsSupported, true);
});

test("the thickness-relative limits grow with the stock and the absolute ones do not", () => {
  const laser = getProcessProfile("laser");
  const fdm = getProcessProfile("fdm");

  // A laser's practical wall is the stock thickness, so a 6 mm sheet wants 6 mm.
  assert.equal(effectiveMinWallMm(laser, 6), 6);
  assert.equal(effectiveMinFeatureMm(laser, 6), 6);
  // Below the thickness where the factor takes over, the absolute floor holds.
  assert.equal(effectiveMinWallMm(laser, 0.5), laser.minWallMm);
  // FDM has a zero factor, so its limit is the same at every thickness.
  assert.equal(effectiveMinWallMm(fdm, 2), fdm.minWallMm);
  assert.equal(effectiveMinWallMm(fdm, 40), fdm.minWallMm);
  assert.equal(effectiveMinFeatureMm(fdm, 40), fdm.minFeatureMm);
});

test("a missing or nonsense thickness falls back to the absolute floor", () => {
  const laser = getProcessProfile("laser");
  assert.equal(effectiveMinWallMm(laser, null), laser.minWallMm);
  assert.equal(effectiveMinWallMm(laser, Number.NaN), laser.minWallMm);
  assert.equal(effectiveMinWallMm(laser, -3), laser.minWallMm);
});

test("describeProcess names the process a finding is judged against", () => {
  assert.equal(describeProcess("cnc"), getProcessProfile("cnc").label);
  assert.equal(describeProcess("nonsense"), getProcessProfile(DEFAULT_PROCESS_ID).label);
});
