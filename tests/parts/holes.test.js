import assert from "node:assert/strict";
import test from "node:test";

import {
  HOLE_DEFAULT_FACE,
  HOLE_DEFAULT_FIT,
  HOLE_DEFAULT_PROCESS,
  HOLE_DEFAULT_STANDARD,
  HOLE_DEFAULT_STYLE,
  HOLE_DEGENERATE_COUNTERSINK,
  HOLE_FACES,
  HOLE_NO_PUBLISHED_VALUE,
  HOLE_POCKET_STYLES,
  HOLE_STYLES,
  HOLE_UNSUPPORTED_FIT,
  HOLE_UNSUPPORTED_SIZE,
  HOLE_UNSUPPORTED_STANDARD,
  HOLE_UNSUPPORTED_STYLE,
  POCKET_BREAKTHROUGH_CODE,
  REFUSED_HOLE_CODE,
  describeHole,
  detectHolePocketBreakthrough,
  detectRefusedHoles,
  holeDerivedRadiusMm,
  normalizeHoleSpec,
  profileSizeIsLocked,
  resolveHole,
  sketchHasHolePockets,
  sketchHolePockets
} from "../../src/parts/holes.js";
import {
  CLEARANCE_FITS,
  FASTENER_SIZES,
  clearanceHoleDiameterMm,
  counterboreMm,
  countersinkMm,
  heatSetInsertMm,
  nutTrapMm,
  tapDrillDiameterMm
} from "../../src/parts/standards/fasteners.js";

function cut(hole, overrides = {}) {
  return { id: "h1", type: "circle", x: 0, z: 0, radius: 5, hole, ...overrides };
}

test("a through hole takes its diameter from the fastener table, not from a literal", () => {
  for (const size of FASTENER_SIZES) {
    for (const fit of CLEARANCE_FITS) {
      const resolved = resolveHole({ size, fit });
      assert.ok(resolved.ok, `${size} ${fit} resolves`);
      // Asserted against the table's own accessor: a test that repeated the number
      // could not catch the table being wrong.
      assert.equal(resolved.pilotDiameterMm, clearanceHoleDiameterMm(size, fit));
      assert.equal(resolved.pilotRadiusMm, clearanceHoleDiameterMm(size, fit) / 2);
      assert.equal(resolved.pocket, null, "a through hole has no pocket");
    }
  }
});

test("a tapped hole uses the tap drill and ignores the clearance fit", () => {
  for (const size of FASTENER_SIZES) {
    const tight = resolveHole({ size, style: "tapped", fit: "close" });
    const slack = resolveHole({ size, style: "tapped", fit: "loose" });
    assert.equal(tight.pilotDiameterMm, tapDrillDiameterMm(size));
    assert.equal(slack.pilotDiameterMm, tapDrillDiameterMm(size), "fit does not move a tap drill");
    assert.ok(tight.pilotDiameterMm < clearanceHoleDiameterMm(size, "close"), "tap drill is tighter than clearance");
    assert.equal(tight.pocket, null);
  }
});

test("a counterbore carries the process it was asked for and labels the unverified column", () => {
  for (const size of FASTENER_SIZES) {
    const printed = resolveHole({ size, style: "counterbore", process: "fdm" });
    const machined = resolveHole({ size, style: "counterbore", process: "machined" });

    assert.equal(printed.pocket.diameterMm, counterboreMm(size, "fdm").diameterMm);
    assert.equal(printed.pocket.depthMm, counterboreMm(size, "fdm").depthMm);
    assert.equal(machined.pocket.diameterMm, counterboreMm(size, "machined").diameterMm);
    assert.equal(printed.pocket.shape, "cylinder");

    // The pilot is still the clearance hole: the screw passes through, the head sits
    // in the pocket.
    assert.equal(printed.pilotDiameterMm, clearanceHoleDiameterMm(size, "normal"));
    assert.ok(printed.pocket.diameterMm > printed.pilotDiameterMm, "a counterbore is wider than its pilot");

    // The printed diameter derives from an ISO 4762 head; the machined one is quoted
    // from DIN 974-1 row 1, which `standards/fasteners.js` flags as needing a lookup.
    // It is emitted labelled rather than either withheld or laundered.
    assert.deepEqual(printed.unverifiedDimensions, []);
    assert.deepEqual(machined.unverifiedDimensions, ["counterbore"]);
  }
});

test("a countersink is a cone from the ISO 7046 head down to the pilot", () => {
  const size = "M3";
  const resolved = resolveHole({ size, style: "countersink" });
  const table = countersinkMm(size);

  assert.equal(resolved.pocket.shape, "cone");
  assert.equal(resolved.pocket.topDiameterMm, table.headDiameterMm);
  assert.equal(resolved.pocket.bottomDiameterMm, clearanceHoleDiameterMm(size, "normal"));
  assert.equal(resolved.pocket.includedAngleDeg, table.includedAngleDeg);
  // Depth follows from the half-angle rather than being a second stored number, so
  // it cannot disagree with the angle.
  const halfAngle = (table.includedAngleDeg / 2) * (Math.PI / 180);
  assert.equal(
    resolved.pocket.depthMm,
    (table.headDiameterMm - clearanceHoleDiameterMm(size, "normal")) / 2 / Math.tan(halfAngle)
  );
});

test("a nut trap is a hex prism at the ISO 4032 across-flats", () => {
  const resolved = resolveHole({ size: "M4", style: "nutTrap" });
  const nut = nutTrapMm("M4");

  assert.equal(resolved.pocket.shape, "hexPrism");
  assert.equal(resolved.pocket.acrossFlatsMm, nut.acrossFlatsMm);
  assert.equal(resolved.pocket.acrossCornersMm, nut.acrossCornersMm);
  assert.equal(resolved.pocket.depthMm, nut.thicknessMm);
  assert.ok(resolved.pocket.acrossCornersMm > resolved.pocket.acrossFlatsMm);
});

test("a heat-set insert hole is a stepped hole: vendor bore plus a clearance pilot", () => {
  const resolved = resolveHole({ size: "M3", style: "heatSetInsert" });
  const insert = heatSetInsertMm("M3");

  assert.equal(resolved.pocket.diameterMm, insert.boreDiameterMm);
  assert.equal(resolved.pocket.depthMm, insert.boreDepthMm);
  assert.equal(resolved.pilotDiameterMm, clearanceHoleDiameterMm("M3", "normal"));
  assert.ok(resolved.pocket.diameterMm > resolved.pilotDiameterMm);
});

test("a heat-set insert bore is refused for every size without a verified datasheet", () => {
  const unpublished = FASTENER_SIZES.filter((size) => heatSetInsertMm(size) == null);
  assert.ok(unpublished.length, "the table deliberately holds only some insert sizes");

  for (const size of unpublished) {
    const resolved = resolveHole({ size, style: "heatSetInsert" });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, HOLE_NO_PUBLISHED_VALUE);
    assert.equal(resolved.pilotDiameterMm, null, "a refusal produces no geometry at all");
    assert.equal(resolved.pocket, null);
    // The reason has to name the combination, not just say no.
    assert.match(resolved.reason, new RegExp(size.replace(".", "\\.")));
    assert.match(resolved.reason, /heatSetInsert/u);
  }
});

test("an M2.5 insert bore is not interpolated from the M2 and M4 bores that surround it", () => {
  const resolved = resolveHole({ size: "M2.5", style: "heatSetInsert" });
  assert.equal(resolved.ok, false);
  // The interpolation this refuses would have been perfectly plausible, which is
  // exactly why the refusal is worth pinning: 4.1 mm looks like a real bore.
  const wouldHaveBeen = (heatSetInsertMm("M2").boreDiameterMm + heatSetInsertMm("M4").boreDiameterMm) / 2;
  assert.ok(Number.isFinite(wouldHaveBeen));
  assert.equal(resolved.pocket, null);
});

test("every unsupported field is refused with its own code and a reason naming the request", () => {
  const badStandard = resolveHole({ standard: "UNC", size: "M3" });
  assert.equal(badStandard.code, HOLE_UNSUPPORTED_STANDARD);
  assert.match(badStandard.reason, /UNC/u);

  const badSize = resolveHole({ size: "M3.5" });
  assert.equal(badSize.code, HOLE_UNSUPPORTED_SIZE);
  assert.match(badSize.reason, /M3\.5/u);

  const badFit = resolveHole({ size: "M3", fit: "snug" });
  assert.equal(badFit.code, HOLE_UNSUPPORTED_FIT);
  assert.match(badFit.reason, /snug/u);

  const badStyle = resolveHole({ size: "M3", style: "reamed" });
  assert.equal(badStyle.code, HOLE_UNSUPPORTED_STYLE);
  assert.match(badStyle.reason, /reamed/u);

  for (const refusal of [badStandard, badSize, badFit, badStyle]) {
    assert.equal(refusal.ok, false);
    assert.equal(refusal.pilotDiameterMm, null);
    assert.equal(refusal.pocket, null);
  }
});

test("no published size and fit produces a degenerate countersink cone", () => {
  // The `HOLE_DEGENERATE_COUNTERSINK` guard is unreachable through the public API
  // today, and this test is what makes that a checked claim rather than an
  // assumption: it is the loosest fit of every published size that would trip it
  // first. The guard stays because a future table row could, and a cone of negative
  // depth would be geometry from a number nobody meant.
  for (const size of FASTENER_SIZES) {
    const loosestPilot = clearanceHoleDiameterMm(size, "loose");
    const head = countersinkMm(size).headDiameterMm;
    assert.ok(loosestPilot < head, `${size} loose pilot ${loosestPilot} fits inside a ${head} head`);

    const resolved = resolveHole({ size, style: "countersink", fit: "loose" });
    assert.equal(resolved.ok, true);
    assert.notEqual(resolved.code, HOLE_DEGENERATE_COUNTERSINK);
    assert.ok(resolved.pocket.depthMm > 0, `${size} countersink has positive depth`);
  }
});

test("no published size, fit and style reaches the non-finite pilot guard", () => {
  // The sibling of the degenerate-countersink property test, for the other guard in
  // `resolveHole` that no public input can reach: the one refusing a pilot that is
  // not a finite positive number. It is reached *before* any pocket lookup, so a
  // hole whose pocket is legitimately unpublished - a heat-set insert on a size with
  // no datasheet - must still have got a real pilot on its way to that refusal.
  // Sweeping every combination is what makes the unreachability a checked claim: a
  // table row that lost its clearance or tap-drill entry fails here rather than
  // silently making a dead branch live.
  for (const size of FASTENER_SIZES) {
    for (const fit of CLEARANCE_FITS) {
      for (const style of HOLE_STYLES) {
        const resolved = resolveHole({ size, fit, style });
        const where = `${size} ${fit} ${style}`;

        assert.ok(!/No published pilot diameter/u.test(resolved.reason ?? ""), `${where} reached the pilot guard`);

        // The pilot the table publishes for this combination, through the accessors
        // rather than through a literal (audit A4). This is the guard's input, so
        // asserting it is finite and positive is asserting the guard cannot fire.
        const pilot = style === "tapped" ? tapDrillDiameterMm(size) : clearanceHoleDiameterMm(size, fit);
        assert.equal(typeof pilot, "number", `${where} has a numeric pilot`);
        assert.ok(Number.isFinite(pilot) && pilot > 0, `${where} pilot ${pilot} is finite and positive`);

        if (resolved.ok) {
          assert.equal(resolved.pilotDiameterMm, pilot, `${where} resolves to the published pilot`);
        } else {
          // The only refusals left are about a pocket the table does not publish,
          // and those produce no pilot at all rather than a partial resolution.
          assert.equal(resolved.code, HOLE_NO_PUBLISHED_VALUE, `${where} refused for an unexpected reason`);
          assert.equal(resolved.pilotDiameterMm, null, `${where} refused but kept a pilot`);
          assert.ok(HOLE_POCKET_STYLES.includes(style), `${where} refused on a style that has no pocket to be missing`);
        }
      }
    }
  }
});

test("normalizeHoleSpec fills every default and keeps an unrecognised size verbatim", () => {
  assert.deepEqual(normalizeHoleSpec({ size: "M3" }), {
    standard: HOLE_DEFAULT_STANDARD,
    size: "M3",
    fit: HOLE_DEFAULT_FIT,
    style: HOLE_DEFAULT_STYLE,
    process: HOLE_DEFAULT_PROCESS,
    fromFace: HOLE_DEFAULT_FACE,
    lockSize: true
  });

  // The author's typo survives so the refusal is visible on reload. A normalizer
  // that dropped it would leave a plain circle and no explanation.
  assert.equal(normalizeHoleSpec({ size: " M3.5 " }).size, "M3.5");
  assert.equal(normalizeHoleSpec({ size: "M3", standard: "UNC" }).standard, "UNC");
});

test("a hole with no size is not a hole, and neither is a non-object", () => {
  assert.equal(normalizeHoleSpec({}), null);
  assert.equal(normalizeHoleSpec({ size: "   " }), null);
  assert.equal(normalizeHoleSpec(null), null);
  assert.equal(normalizeHoleSpec("M3"), null);
  assert.equal(normalizeHoleSpec([{ size: "M3" }]), null);
  assert.equal(resolveHole(null), null, "absent is distinguishable from refused");
});

test("lockSize defaults to true and decides whether the standard owns the radius", () => {
  assert.equal(normalizeHoleSpec({ size: "M3" }).lockSize, true);
  assert.equal(normalizeHoleSpec({ size: "M3", lockSize: false }).lockSize, false);

  assert.equal(holeDerivedRadiusMm({ size: "M3" }), clearanceHoleDiameterMm("M3", "normal") / 2);
  assert.equal(holeDerivedRadiusMm({ size: "M3", lockSize: false }), null, "an unlocked hole keeps the author's radius");
  assert.equal(holeDerivedRadiusMm({ size: "M3.5" }), null, "a refused hole never changes geometry");
  assert.equal(holeDerivedRadiusMm(null), null);

  assert.equal(profileSizeIsLocked(cut({ size: "M3" })), true);
  assert.equal(profileSizeIsLocked(cut({ size: "M3", lockSize: false })), false);
  assert.equal(profileSizeIsLocked({ id: "plain", type: "circle", radius: 3 }), false);
});

test("pocket styles are exactly the styles that produce a pocket", () => {
  for (const style of HOLE_STYLES) {
    const resolved = resolveHole({ size: "M3", style });
    assert.ok(resolved.ok, `${style} resolves for M3`);
    assert.equal(
      Boolean(resolved.pocket),
      HOLE_POCKET_STYLES.includes(style),
      `${style} pocket presence matches HOLE_POCKET_STYLES`
    );
  }
});

test("a pocket names the face it is cut from, and each hole names its own", () => {
  for (const face of HOLE_FACES) {
    assert.equal(resolveHole({ size: "M3", style: "counterbore", fromFace: face }).pocket.fromFace, face);
  }

  const sketch = {
    cutProfiles: [
      cut({ size: "M3", style: "counterbore", fromFace: "top" }, { id: "top_hole" }),
      cut({ size: "M4", style: "nutTrap", fromFace: "bottom" }, { id: "bottom_hole" })
    ]
  };
  const pockets = sketchHolePockets(sketch);
  assert.deepEqual(pockets.map(({ pocket }) => pocket.fromFace), ["top", "bottom"]);
  assert.equal(sketchHasHolePockets(sketch), true);
});

test("refused and pocket-free holes contribute no pockets", () => {
  assert.equal(sketchHasHolePockets({ cutProfiles: [cut({ size: "M3" })] }), false);
  assert.equal(
    sketchHasHolePockets({ cutProfiles: [cut({ size: "M2.5", style: "heatSetInsert" })] }),
    false,
    "a refused hole produces no pocket"
  );
  assert.equal(sketchHasHolePockets({ cutProfiles: [] }), false);
  assert.equal(sketchHasHolePockets(null), false);
});

test("a refused hole is reported as a warning that names the profile and the reason", () => {
  const issue = detectRefusedHoles({
    cutProfiles: [cut({ size: "M9" }, { id: "mystery" }), cut({ size: "M3" }, { id: "fine" })]
  });

  assert.equal(issue.code, REFUSED_HOLE_CODE);
  assert.equal(issue.severity, "warning");
  assert.deepEqual(issue.profileIds, ["mystery"]);
  assert.match(issue.message, /mystery/u);
  assert.match(issue.message, /M9/u);
  assert.equal(detectRefusedHoles({ cutProfiles: [cut({ size: "M3" })] }), null);
});

test("a pocket at least as deep as the plate is reported as breaking through", () => {
  const insert = heatSetInsertMm("M3");
  const thin = {
    extrudeDepthMm: insert.boreDepthMm - 1,
    sketch: { cutProfiles: [cut({ size: "M3", style: "heatSetInsert" }, { id: "insert" })] }
  };
  const thick = {
    extrudeDepthMm: insert.boreDepthMm + 1,
    sketch: { cutProfiles: [cut({ size: "M3", style: "heatSetInsert" }, { id: "insert" })] }
  };

  const issue = detectHolePocketBreakthrough(thin);
  assert.equal(issue.code, POCKET_BREAKTHROUGH_CODE);
  assert.equal(issue.severity, "warning");
  assert.deepEqual(issue.profileIds, ["insert"]);
  assert.match(issue.message, /insert/u);
  assert.equal(detectHolePocketBreakthrough(thick), null, "a blind pocket is not a finding");
});

test("describeHole names the size, style, fit, and face for a pocketed hole only", () => {
  assert.equal(describeHole({ size: "M3" }), "M3 through hole, normal fit");
  assert.equal(describeHole({ size: "M3", style: "counterbore", fromFace: "bottom" }), "M3 counterbore, normal fit from bottom");
  assert.equal(describeHole({ size: "M4", style: "tapped", fit: "close" }), "M4 tapped, close fit");
  assert.equal(describeHole(null), null);
});

test("a resolution states where every number came from", () => {
  const resolved = resolveHole({ size: "M3", style: "countersink", fit: "close" });
  const dimensions = resolved.provenance.map((entry) => entry.dimension);
  assert.deepEqual(dimensions, ["pilot", "countersink"]);
  assert.match(resolved.provenance[0].source, /ISO 273/u);
  assert.match(resolved.provenance[0].source, /close/u);
  // ISO 10642 flat socket head is a larger series the table deliberately does not
  // publish, so nothing here may claim it.
  assert.ok(resolved.provenance.every((entry) => !/10642/u.test(entry.source)));
});
