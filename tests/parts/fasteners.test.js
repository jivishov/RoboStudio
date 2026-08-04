import assert from "node:assert/strict";
import test from "node:test";

import {
  CLEARANCE_FITS,
  COUNTERSINK_INCLUDED_ANGLE_DEG,
  FASTENER_SIZES,
  bossOuterDiameterMm,
  clearanceHoleDiameterMm,
  counterboreMm,
  countersinkMm,
  getFastener,
  heatSetInsertMm,
  isFastenerSize,
  minEdgeDistanceMm,
  nutTrapMm,
  tapDrillDiameterMm,
  washerMm
} from "../../src/parts/standards/fasteners.js";

test("M3 clearance holes match ISO 273 close, normal, and loose", () => {
  assert.equal(clearanceHoleDiameterMm("M3", "close"), 3.2);
  assert.equal(clearanceHoleDiameterMm("M3", "normal"), 3.4);
  assert.equal(clearanceHoleDiameterMm("M3", "loose"), 3.6);
  assert.equal(clearanceHoleDiameterMm("M3"), 3.4, "normal is the default fit");
});

test("clearance widens monotonically from close to loose for every size", () => {
  for (const size of FASTENER_SIZES) {
    const close = clearanceHoleDiameterMm(size, "close");
    const normal = clearanceHoleDiameterMm(size, "normal");
    const loose = clearanceHoleDiameterMm(size, "loose");
    assert.ok(close < normal && normal < loose, `${size} clearance ordering`);
    assert.ok(close > getFastener(size).nominalMm, `${size} clearance exceeds nominal`);
  }
});

test("tap drill equals nominal minus pitch", () => {
  for (const size of FASTENER_SIZES) {
    const entry = getFastener(size);
    const expected = entry.nominalMm - entry.pitchMm;
    assert.ok(
      Math.abs(tapDrillDiameterMm(size) - expected) < 0.06,
      `${size} tap drill ${tapDrillDiameterMm(size)} vs ${expected}`
    );
  }
  assert.equal(tapDrillDiameterMm("M3"), 2.5);
  assert.equal(tapDrillDiameterMm("M5"), 4.2);
});

test("hex nut across-flats matches ISO 4032 and across-corners is derived exactly", () => {
  const m3 = nutTrapMm("M3");
  assert.equal(m3.acrossFlatsMm, 5.5);
  assert.equal(m3.thicknessMm, 2.4);
  assert.ok(Math.abs(m3.acrossCornersMm - 5.5 / Math.cos(Math.PI / 6)) < 1e-12);
  assert.ok(Math.abs(m3.acrossCornersMm - 6.3509) < 1e-3);

  assert.equal(nutTrapMm("M5").acrossFlatsMm, 8.0);
  assert.equal(nutTrapMm("M8").thicknessMm, 6.8);
});

test("counterbore is tighter for printing than for machining and clears the head", () => {
  const printed = counterboreMm("M3", "fdm");
  const machined = counterboreMm("M3", "cnc");
  assert.ok(Math.abs(printed.diameterMm - 6.2) < 1e-9, "head 5.5 plus 0.7 allowance");
  assert.equal(machined.diameterMm, 6.5);
  assert.ok(printed.diameterMm < machined.diameterMm);

  for (const size of FASTENER_SIZES) {
    const entry = getFastener(size);
    assert.ok(
      counterboreMm(size, "fdm").diameterMm > entry.headDiameterMm,
      `${size} counterbore clears the head`
    );
    assert.ok(counterboreMm(size).depthMm >= entry.headHeightMm, `${size} counterbore depth`);
  }
});

test("countersinks are 90 degrees included, not the ANSI 82", () => {
  assert.equal(COUNTERSINK_INCLUDED_ANGLE_DEG, 90);
  assert.equal(countersinkMm("M3").includedAngleDeg, 90);
  assert.equal(countersinkMm("M3").headDiameterMm, 5.6);
});

test("heat-set inserts resolve only for verified vendor sizes", () => {
  assert.equal(heatSetInsertMm("M3").boreDiameterMm, 4.0);
  assert.equal(heatSetInsertMm("M4").boreDiameterMm, 5.0);
  assert.equal(heatSetInsertMm("M2.5"), null, "unverified size must not interpolate");
  assert.equal(heatSetInsertMm("M5"), null);
  assert.equal(heatSetInsertMm("M6"), null);
});

test("unknown sizes and fits resolve to null everywhere", () => {
  assert.equal(isFastenerSize("M3"), true);
  assert.equal(isFastenerSize("M7"), false);
  assert.equal(getFastener("M7"), null);
  assert.equal(clearanceHoleDiameterMm("M7", "normal"), null);
  assert.equal(clearanceHoleDiameterMm("M3", "snug"), null);
  assert.equal(tapDrillDiameterMm("M7"), null);
  assert.equal(counterboreMm("M7"), null);
  assert.equal(countersinkMm("M7"), null);
  assert.equal(nutTrapMm("M7"), null);
  assert.equal(washerMm("M7"), null);
  assert.equal(minEdgeDistanceMm("M7"), null);
});

test("edge distance and boss diameter follow the documented practice rules", () => {
  assert.equal(minEdgeDistanceMm("M3"), 4.5);
  assert.equal(minEdgeDistanceMm("M5"), 7.5);
  // A 4.0 mm M3 heat-set bore with a 1.6 mm wall wants a 7.2 mm boss.
  assert.ok(Math.abs(bossOuterDiameterMm(4.0, 1.6) - 7.2) < 1e-9);
  assert.equal(bossOuterDiameterMm("nonsense"), null);
});

test("washers clear their clearance hole", () => {
  for (const size of FASTENER_SIZES) {
    assert.ok(
      washerMm(size).outerDiameterMm > clearanceHoleDiameterMm(size, "loose"),
      `${size} washer covers the hole`
    );
  }
});

test("declared fits and sizes stay in sync with the table", () => {
  assert.deepEqual([...CLEARANCE_FITS], ["close", "normal", "loose"]);
  for (const size of FASTENER_SIZES) {
    assert.ok(getFastener(size), `${size} present`);
  }
});
