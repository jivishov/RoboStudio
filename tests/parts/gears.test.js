/**
 * Gear geometry, asserted by measuring the emitted profile.
 *
 * The point-count assertion this file used to open with (`96`) was the whole problem
 * in miniature: it passed for a tooth that was four points in polar coordinates and
 * it would pass for any other shape with the same vertex budget. Cycle 07's plan
 * sanctions replacing it, and the replacements are all **measurements of the emitted
 * geometry** rather than re-derivations of the generator's own arithmetic - a test
 * that recomputes `r * cos(alpha)` proves only that the formula was typed twice.
 *
 * The helpers below therefore know nothing about gears. They take a closed polygon
 * and measure it: where it crosses a circle, how wide the material is there, which
 * way the boundary runs, whether it crosses itself.
 */

import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { validateManufacturability, DFM_GEAR_UNDERCUT, DFM_GEAR_DEGENERATE_TOOTH } from "../../src/parts/dfm.js";
import {
  createSpurGearBody,
  createSpurGearProfilePoints,
  normalizeSpurGearSpec,
  spurGearGeometry,
  spurGearModuleForTipDiameterMm,
  spurGearTipDiameterMm,
  validateSpurGearSpec,
  MAX_TOOTH_COUNT,
  SPUR_GEAR_SPEC_FIELDS
} from "../../src/parts/gears.js";
import {
  spurGearPairReport,
  GEAR_PAIR_MODULE_MISMATCH,
  GEAR_PAIR_NO_CLEARANCE,
  GEAR_PAIR_TIP_INTERFERENCE
} from "../../src/parts/gearPair.js";
import { bodyGeometryProperties } from "../../src/parts/massProperties.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import {
  ISO_53_PROFILE_ANGLE_DEG,
  basicRackDeviatesFromStandard,
  basicRackProfile,
  involuteAngle,
  inverseInvoluteAngle,
  undercutLimitToothCount
} from "../../src/parts/standards/gears.js";
import { DEFAULT_CHORD_TOLERANCE_MM } from "../../src/parts/tessellation.js";
import { solidWatertightReport } from "../../src/parts/watertight.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;

/** Fine enough that a sampled chord is the tangent to within a hundredth of a degree. */
const FINE_TOLERANCE_MM = 1e-6;
const DEG = 180 / Math.PI;

/* ------------------------------------------------- polygon measurement helpers */

function radius(point) {
  return Math.hypot(point[0], point[1]);
}

function signedArea(points) {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    total += a[0] * b[1] - b[0] * a[1];
  }
  return total / 2;
}

function segmentsProperlyCross(p1, p2, p3, p4) {
  const denominator = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(denominator) < 1e-15) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / denominator;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / denominator;
  return t > 1e-12 && t < 1 - 1e-12 && u > 1e-12 && u < 1 - 1e-12;
}

/** The first pair of non-adjacent edges that cross, or null. */
function selfIntersection(points) {
  const count = points.length;
  for (let first = 0; first < count; first += 1) {
    for (let second = first + 1; second < count; second += 1) {
      if ((second + 1) % count === first || (first + 1) % count === second) continue;
      if (segmentsProperlyCross(points[first], points[(first + 1) % count], points[second], points[(second + 1) % count])) {
        return [first, second];
      }
    }
  }
  return null;
}

/**
 * Where the polygon boundary crosses a circle, with the direction of the crossing
 * edge and whether it is entering or leaving the material.
 */
function circleCrossings(points, circleRadius) {
  const crossings = [];
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % count];
    const radiusA = radius(a);
    const radiusB = radius(b);
    if ((radiusA - circleRadius) * (radiusB - circleRadius) >= 0) continue;
    const fraction = (circleRadius - radiusA) / (radiusB - radiusA);
    const x = a[0] + fraction * (b[0] - a[0]);
    const y = a[1] + fraction * (b[1] - a[1]);
    crossings.push({
      angleRad: Math.atan2(y, x),
      // Positive when the boundary is moving outward, which for a counter-clockwise
      // polygon means this is a flank running up toward the tip.
      outward: radiusB > radiusA,
      edge: [a, b]
    });
  }
  return crossings.sort((first, second) => first.angleRad - second.angleRad);
}

/**
 * Angle between the boundary's direction at a circle crossing and the radial
 * direction there, in degrees. This is the pressure angle when the circle is the
 * pitch circle, and it converges to the true tangent as the chord tolerance falls.
 */
function crossingTangentVsRadialDeg(crossing, circleRadius) {
  const [a, b] = crossing.edge;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const x = Math.cos(crossing.angleRad) * circleRadius;
  const y = Math.sin(crossing.angleRad) * circleRadius;
  const cosine = Math.abs((dx * x + dy * y) / (Math.hypot(dx, dy) * circleRadius));
  return Math.acos(Math.min(1, cosine)) * DEG;
}

/**
 * The angular width of each block of material where a circle of this radius passes
 * through the gear: one entry per tooth, measured from the polygon alone.
 */
function toothArcHalfAngles(points, circleRadius) {
  const crossings = circleCrossings(points, circleRadius);
  const widths = [];
  for (let index = 0; index < crossings.length; index += 1) {
    const start = crossings[index];
    const end = crossings[(index + 1) % crossings.length];
    // A counter-clockwise boundary leaves the material going outward on the tooth's
    // trailing flank, so an outward crossing followed by an inward one brackets a
    // tooth rather than a space.
    if (!start.outward || end.outward) continue;
    let width = end.angleRad - start.angleRad;
    if (width < 0) width += 2 * Math.PI;
    widths.push(width / 2);
  }
  return widths;
}

/** Tooth count, counted from the profile: one material block per tooth at the tip. */
function countTeeth(points) {
  const maximum = Math.max(...points.map(radius));
  // Just inside the tip circle, so a tip land contributes one block rather than none.
  return toothArcHalfAngles(points, maximum * 0.999).length;
}

/**
 * Pitch radius measured from the profile: the radius at which a tooth's angular
 * half-width is a quarter of the angular pitch, which is what "the pitch circle is
 * where tooth and space are equal" means. No gear parameter is consulted.
 */
function measurePitchRadius(points) {
  const toothCount = countTeeth(points);
  const target = Math.PI / (2 * toothCount);
  const radii = points.map(radius);
  let low = Math.min(...radii);
  let high = Math.max(...radii);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    const widths = toothArcHalfAngles(points, middle);
    const average = widths.reduce((sum, value) => sum + value, 0) / widths.length;
    // The tooth narrows outward, so a half-width above the target means this radius
    // is still inside the pitch circle.
    if (average > target) low = middle;
    else high = middle;
  }
  return { toothCount, pitchRadiusMm: (low + high) / 2 };
}

/**
 * Base radius measured from the profile.
 *
 * The normal to an involute is tangent to its base circle, so the distance from the
 * gear axis to the normal line at any flank point is the base radius. The normal is
 * taken perpendicular to the local boundary chord, which makes this a measurement of
 * the emitted polygon and not of the involute equation.
 */
function measureBaseRadius(points, atRadiusMm) {
  const crossings = circleCrossings(points, atRadiusMm).filter((crossing) => crossing.outward);
  const distances = crossings.map((crossing) => {
    const [a, b] = crossing.edge;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    // Distance from the origin to the line through the chord midpoint along the
    // chord's normal, which is |midpoint x tangent| / |tangent|.
    return Math.abs(midX * dx + midY * dy) / length;
  });
  return distances.reduce((sum, value) => sum + value, 0) / distances.length;
}

function gearProfile(gear, options = {}) {
  return createSpurGearProfilePoints(gear, { toleranceMm: FINE_TOLERANCE_MM, ...options });
}

/* ------------------------------------------------------------- spec and schema */

test("normalizes and validates spur gear parameters", () => {
  const gear = normalizeSpurGearSpec({
    toothCount: 24,
    moduleMm: 2,
    pressureAngleDeg: 20,
    boreDiameterMm: 6,
    thicknessMm: 5
  });

  assert.deepEqual(validateSpurGearSpec(gear), []);
  assert.equal(gear.toothCount, 24);
  // The cycle-07 defaults: an unshifted, backlash-free ISO 53 profile A tooth, so a
  // project saved before this cycle opens as the nominal gear.
  assert.equal(gear.rackProfileId, "A");
  assert.equal(gear.profileShiftCoefficient, 0);
  assert.equal(gear.backlashMm, 0);
  assert.equal(gear.rootFilletFactor, null);
  assert.equal(gear.helixAngleDeg, 0);
  // The normalizer is a whitelist, and `SPUR_GEAR_SPEC_FIELDS` is the claim about
  // what it holds. Asserting both directions is what stops the two drifting.
  assert.deepEqual(Object.keys(gear).sort(), [...SPUR_GEAR_SPEC_FIELDS].sort());
  assert.equal(normalizeSpurGearSpec({ ...gear, unregistered: 7 }).unregistered, undefined);
});

test("reports invalid spur gear parameters before compile", () => {
  const issues = validateSpurGearSpec({
    toothCount: 4,
    moduleMm: 0,
    pressureAngleDeg: 45,
    boreDiameterMm: "not-a-number",
    thicknessMm: -1
  });

  assert.ok(issues.some((issue) => issue.code === "invalid-gear-tooth-count"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-module"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-pressure-angle"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-thickness"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-bore"));
});

test("the cycle-07 fields are validated too, and backlash cannot eat the whole tooth", () => {
  const issues = validateSpurGearSpec({
    toothCount: 24,
    moduleMm: 2,
    pressureAngleDeg: 20,
    boreDiameterMm: 6,
    thicknessMm: 6,
    profileShiftCoefficient: 4,
    backlashMm: -1,
    rootFilletFactor: -0.2,
    helixAngleDeg: 80
  });
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-profile-shift"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-backlash"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-root-fillet"));
  assert.ok(issues.some((issue) => issue.code === "invalid-gear-helix-angle"));

  // A backlash wider than the tooth is not a thin tooth, it is no tooth, and the
  // clamped normalizer cannot express it - so the check is on the raw spec.
  const eaten = validateSpurGearSpec({
    toothCount: 24,
    moduleMm: 2,
    pressureAngleDeg: 20,
    boreDiameterMm: 6,
    thicknessMm: 6,
    profileShiftCoefficient: 0,
    backlashMm: 4,
    rootFilletFactor: null,
    helixAngleDeg: 0
  });
  assert.ok(eaten.some((issue) => issue.code === "invalid-gear-backlash"));

  // A normalized spec is always compilable, which is the normalizer's job.
  assert.deepEqual(
    validateSpurGearSpec(normalizeSpurGearSpec({ profileShiftCoefficient: 4, backlashMm: -1, helixAngleDeg: 80 })),
    []
  );
});

test("the bore is checked against the root the profile shift actually cuts", () => {
  // A negative shift cuts the root deeper, so a bore that clears the nominal root
  // may not clear the shifted one. The old check used the unshifted root, because
  // nothing could shift it.
  const spec = { toothCount: 12, moduleMm: 2, pressureAngleDeg: 20, thicknessMm: 6, backlashMm: 0, rootFilletFactor: null, helixAngleDeg: 0 };
  const unshifted = spurGearGeometry({ ...spec, profileShiftCoefficient: 0 });
  const shifted = spurGearGeometry({ ...spec, profileShiftCoefficient: -0.9 });
  assert.ok(shifted.rootRadiusMm < unshifted.rootRadiusMm);

  const bore = 2 * shifted.rootRadiusMm * 0.9;
  assert.deepEqual(validateSpurGearSpec({ ...spec, profileShiftCoefficient: 0, boreDiameterMm: bore }), []);
  assert.ok(
    validateSpurGearSpec({ ...spec, profileShiftCoefficient: -0.9, boreDiameterMm: bore })
      .some((issue) => issue.code === "invalid-gear-bore")
  );
});

/* ---------------------------------------------------------- the four radii used */

test("the generator states the four radii and each comes from the basic rack", () => {
  const geometry = spurGearGeometry({ toothCount: 24, moduleMm: 2, pressureAngleDeg: 20 });
  const rack = basicRackProfile("A");
  const points = gearProfile(geometry.gear);
  const radii = points.map(radius);

  // Tip and root are measured off the emitted profile rather than read back.
  assert.ok(Math.abs(Math.max(...radii) - geometry.tipRadiusMm) < 1e-9);
  assert.ok(Math.abs(Math.min(...radii) - geometry.rootRadiusMm) < 1e-9);

  // Addendum and dedendum are the rack's, in millimetres.
  assert.ok(Math.abs(geometry.tipRadiusMm - geometry.pitchRadiusMm - rack.addendumFactor * 2) < 1e-9);
  assert.ok(Math.abs(geometry.pitchRadiusMm - geometry.rootRadiusMm - rack.dedendumFactor * 2) < 1e-9);
  // The fillet is the rack's tip radius, and the profile keeps it.
  assert.ok(Math.abs(geometry.rootFilletRadiusMm - rack.filletRadiusFactor * 2) < 1e-9);
  assert.equal(geometry.rootFilletClampedMm, null);

  // Pitch and base radii, measured from the polygon by two independent routes.
  const measured = measurePitchRadius(points);
  assert.equal(measured.toothCount, 24);
  assert.ok(Math.abs(measured.pitchRadiusMm - geometry.pitchRadiusMm) < 5e-4, `${measured.pitchRadiusMm}`);
  const measuredBase = measureBaseRadius(points, geometry.pitchRadiusMm);
  assert.ok(Math.abs(measuredBase - geometry.baseRadiusMm) < 1e-4, `${measuredBase} vs ${geometry.baseRadiusMm}`);
});

test("a tooth cut at any angle but 20 degrees is reported as a generalisation of ISO 53", () => {
  // The departure from the standard was computable from the first commit of
  // `standards/gears.js` and reachable by nobody: `basicRackDeviatesFromStandard`
  // had no caller in `src/`, so the page stated "ISO 53 basic rack" for a 25 degree
  // tooth. It is now on the geometry, which is the object every consumer reads.
  //
  // Both branches are asserted. A one-sided check here would pass just as well on a
  // flag hardcoded to `true`.
  const standard = spurGearGeometry({ toothCount: 24, moduleMm: 2, pressureAngleDeg: ISO_53_PROFILE_ANGLE_DEG });
  assert.equal(standard.rackDeviatesFromStandard, false);

  for (const pressureAngleDeg of [14.5, 25, 35, 10]) {
    const geometry = spurGearGeometry({ toothCount: 24, moduleMm: 2, pressureAngleDeg });
    assert.equal(geometry.rackDeviatesFromStandard, true, `${pressureAngleDeg} degrees is not ISO 53`);
    // And the flag agrees with the accessor rather than re-deriving the comparison,
    // so there is one answer to this question in the page (audit A4's shape).
    assert.equal(geometry.rackDeviatesFromStandard, basicRackDeviatesFromStandard(pressureAngleDeg));
    // The departure is about proportions only: the involute is exact at any angle,
    // which is why the base radius still follows `r cos a` here.
    assert.ok(
      Math.abs(geometry.baseRadiusMm - geometry.pitchRadiusMm * Math.cos((pressureAngleDeg * Math.PI) / 180)) < 1e-12
    );
  }

  // The default spec is the standard tooth, so an untouched gear claims ISO 53 and is
  // entitled to.
  assert.equal(spurGearGeometry({}).rackDeviatesFromStandard, false);
});

/* --------------------------------------------- pressure angle reaches geometry */

test("the flank crosses the pitch circle at the pressure angle, measured from the points", () => {
  // The acceptance criterion, and the whole cycle in one assertion: before this the
  // pressure angle changed nothing about the shape at all.
  //
  // The stated tolerance is 0.05 degrees at a 1e-6 mm chord tolerance, and it is a
  // property of the *measurement* rather than of the geometry. A chord's direction
  // equals the tangent somewhere along it, and the pressure angle changes with radius
  // at about 6.5 degrees per millimetre here, so a finite chord reads slightly low.
  // The convergence test below is what pins that this is sampling error and not a
  // wrong flank: the error must fall as the chords shorten.
  const measureWorstErrorDeg = (pressureAngleDeg, toleranceMm) => {
    const gear = { toothCount: 24, moduleMm: 2, pressureAngleDeg };
    const geometry = spurGearGeometry(gear);
    const crossings = circleCrossings(
      createSpurGearProfilePoints(gear, { toleranceMm }),
      geometry.pitchRadiusMm
    );
    assert.equal(crossings.length, 2 * geometry.toothCount, "each tooth crosses the pitch circle twice");
    return Math.max(
      ...crossings.map((crossing) => Math.abs(crossingTangentVsRadialDeg(crossing, geometry.pitchRadiusMm) - pressureAngleDeg))
    );
  };

  for (const pressureAngleDeg of [14.5, 20, 25, 30]) {
    const worst = measureWorstErrorDeg(pressureAngleDeg, FINE_TOLERANCE_MM);
    assert.ok(worst < 0.05, `at ${pressureAngleDeg} deg the flank tangent was ${worst.toFixed(4)} deg out`);
  }

  const errors = [0.02, 1e-4, 1e-6, 1e-8].map((toleranceMm) => measureWorstErrorDeg(20, toleranceMm));
  for (let index = 1; index < errors.length; index += 1) {
    assert.ok(
      errors[index] < errors[index - 1],
      `the measured pressure angle must converge on 20 degrees: ${errors.map((value) => value.toFixed(5)).join(" -> ")}`
    );
  }
  // It flattens out around here because the sampler's recursion depth is capped, which
  // is the intended trade: 0.005 degrees is far below anything a tooth form cares about.
  assert.ok(errors[errors.length - 1] < 0.005, `${errors[errors.length - 1]}`);
});

test("changing the pressure angle changes the compiled solid, measured rather than counted", () => {
  const build = (pressureAngleDeg) => {
    const body = normalizePartBody(
      createSpurGearBody({ gear: { toothCount: 24, moduleMm: 2, pressureAngleDeg, boreDiameterMm: 6, thicknessMm: 6 } })
    );
    return measureVolume(compilePartBodyToSolid(body));
  };
  // Same tooth count, module, tip and root radii: only the flank shape differs, so a
  // point count could not tell these apart and a volume can.
  const twenty = build(20);
  const thirty = build(30);
  assert.ok(Math.abs(twenty - thirty) / twenty > 0.005, `${twenty} vs ${thirty}`);

  // And the direction is the one the geometry requires: a steeper pressure angle
  // gives a smaller base circle and a tooth that widens faster below the pitch line.
  assert.ok(thirty > twenty, "a 30 degree tooth carries more material than a 20 degree one");
});

/* ------------------------------------------------- the profile is a real profile */

test("the profile is closed, counter-clockwise and free of self-intersection", () => {
  const specs = [
    {},
    { toothCount: 6, boreDiameterMm: 1 },
    { toothCount: 8, boreDiameterMm: 2 },
    { toothCount: 120, moduleMm: 1, pressureAngleDeg: 35, boreDiameterMm: 20 },
    { toothCount: 24, pressureAngleDeg: 10 },
    { toothCount: 24, pressureAngleDeg: 35 },
    { profileShiftCoefficient: 0.8 },
    { profileShiftCoefficient: -0.9 },
    { backlashMm: 0.4 },
    { rootFilletFactor: 0 },
    { rootFilletFactor: 1.5 },
    { rackProfileId: "D" },
    { toothCount: 8, profileShiftCoefficient: 0.8, boreDiameterMm: 2 }
  ];

  for (const spec of specs) {
    const label = JSON.stringify(spec);
    const points = createSpurGearProfilePoints(spec);
    assert.ok(points.length > 3, label);
    assert.equal(selfIntersection(points), null, `${label} self-intersects`);
    assert.ok(signedArea(points) > 0, `${label} is not counter-clockwise`);
    // No repeated vertex: the loop is stitched from six spans per tooth and a
    // duplicate at a join would be a zero-length edge in the extruded solid.
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-12, `${label} repeats a vertex at ${index}`);
    }
  }
});

test("tooth pitch is uniform, measured as the angular spacing of the emitted teeth", () => {
  for (const toothCount of [6, 17, 24, 41]) {
    const points = gearProfile({ toothCount, moduleMm: 2 });
    const geometry = spurGearGeometry({ toothCount, moduleMm: 2 });
    const crossings = circleCrossings(points, geometry.pitchRadiusMm).filter((crossing) => crossing.outward);
    assert.equal(crossings.length, toothCount);

    const expected = (2 * Math.PI) / toothCount;
    for (let index = 0; index < crossings.length; index += 1) {
      const next = crossings[(index + 1) % crossings.length];
      let spacing = next.angleRad - crossings[index].angleRad;
      if (spacing < 0) spacing += 2 * Math.PI;
      assert.ok(Math.abs(spacing - expected) < 1e-9, `tooth ${index} of ${toothCount} sits ${spacing} from its neighbour`);
    }

    // And every tooth is the same width, which a rotated copy guarantees but a
    // per-tooth generator would not.
    const widths = toothArcHalfAngles(points, geometry.pitchRadiusMm);
    assert.equal(widths.length, toothCount);
    assert.ok(Math.max(...widths) - Math.min(...widths) < 1e-9);
  }
});

test("a tooth has a root land of non-zero width, so adjacent teeth do not meet at a point", () => {
  // The defect this cycle exists to remove: the old generator put the two flanks of
  // adjacent teeth at the same angle at the root radius, so they met at a single
  // point and there was no land at all.
  for (const spec of [{}, { toothCount: 8 }, { toothCount: 40 }, { pressureAngleDeg: 25 }, { rootFilletFactor: 0 }, { rackProfileId: "D" }]) {
    const geometry = spurGearGeometry(spec);
    const points = gearProfile(spec);
    assert.ok(geometry.rootLandWidthMm > 0, `${JSON.stringify(spec)} reports no root land`);
    assert.equal(geometry.rootPointed, false);

    // Measured on the polygon: the space at the root circle is an arc of positive
    // width, so more than two vertices sit at exactly the root radius.
    const atRoot = points.filter((point) => Math.abs(radius(point) - geometry.rootRadiusMm) < 1e-9);
    assert.ok(atRoot.length >= 2 * geometry.toothCount, `${JSON.stringify(spec)} has ${atRoot.length} points on the root circle`);

    const spaces = toothArcHalfAngles(points, geometry.rootRadiusMm + 1e-9);
    const halfPitch = Math.PI / geometry.toothCount;
    for (const halfWidth of spaces) {
      assert.ok(halfWidth < halfPitch - 1e-9, "the tooth cannot be as wide as the pitch at the root");
    }
  }
});

test("the root fillet is tangent to both the root circle and the flank", () => {
  // The fillet is solved rather than approximated, so the two tangency conditions
  // hold to machine precision. Measured through the reported centre, which is what
  // the arc is actually drawn around.
  const geometry = spurGearGeometry({ toothCount: 24, moduleMm: 2 });
  const { tangency } = geometry.fillet;
  assert.ok(tangency);
  assert.ok(
    Math.abs(tangency.centreRadiusMm - (geometry.rootRadiusMm + geometry.rootFilletRadiusMm)) < 1e-9,
    "the centre sits one fillet radius outside the root circle"
  );

  // Distance from the fillet centre to the flank point equals the fillet radius, and
  // the flank point is the closest point on the flank, which is what tangency means.
  const centre = [
    tangency.centreRadiusMm * Math.cos(tangency.centreAngleRad),
    tangency.centreRadiusMm * Math.sin(tangency.centreAngleRad)
  ];
  const flankPoint = geometry.flank.pointAt(tangency.tangencyRadiusMm);
  assert.ok(Math.abs(Math.hypot(centre[0] - flankPoint[0], centre[1] - flankPoint[1]) - geometry.rootFilletRadiusMm) < 1e-9);
  for (const offset of [-0.05, -0.01, 0.01, 0.05]) {
    const other = geometry.flank.pointAt(tangency.tangencyRadiusMm + offset);
    assert.ok(
      Math.hypot(centre[0] - other[0], centre[1] - other[1]) >= geometry.rootFilletRadiusMm - 1e-12,
      "no other flank point is closer to the fillet centre than the tangency"
    );
  }
});

test("an oversized root fillet is clamped to keep a root land, and says so", () => {
  const asked = spurGearGeometry({ toothCount: 24, moduleMm: 2, rootFilletFactor: 1.5 });
  assert.ok(asked.rootFilletClampedMm != null, "a clamp must be reported, not silent");
  assert.ok(asked.rootFilletRadiusMm < asked.requestedRootFilletRadiusMm);
  assert.ok(asked.rootLandWidthMm > 0);
  assert.equal(selfIntersection(createSpurGearProfilePoints(asked.gear)), null);
});

/* --------------------------------------------------- tessellation is a tolerance */

test("the point count follows the chord tolerance and is pinned by no test", () => {
  const counts = [0.02, 0.01, 0.005, 0.0025].map(
    (toleranceMm) => createSpurGearProfilePoints({ toothCount: 24, moduleMm: 2 }, { toleranceMm }).length
  );
  for (let index = 1; index < counts.length; index += 1) {
    assert.ok(counts[index] > counts[index - 1], `halving the tolerance must add points: ${counts.join(" -> ")}`);
  }
  // The default is the shared chord tolerance, not a count of this module's own.
  assert.equal(
    createSpurGearProfilePoints({ toothCount: 24, moduleMm: 2 }).length,
    createSpurGearProfilePoints({ toothCount: 24, moduleMm: 2 }, { toleranceMm: DEFAULT_CHORD_TOLERANCE_MM }).length
  );
});

test("every emitted point lies on the curve a finer sampling traces", () => {
  // A chord tolerance describes how far the polygon may sit from the curve, so
  // changing it must refine the same curve rather than draw a different one. Every
  // coarse vertex therefore has to sit on the fine polyline - not on a fine vertex,
  // which would be a different and false claim, since the arcs are sampled at
  // whatever angles their own segment counts land on.
  const fineToleranceMm = 0.0005;
  const coarse = createSpurGearProfilePoints({ toothCount: 24, moduleMm: 2 }, { toleranceMm: 0.02 });
  const fine = createSpurGearProfilePoints({ toothCount: 24, moduleMm: 2 }, { toleranceMm: fineToleranceMm });

  for (const point of coarse) {
    let closest = Infinity;
    for (let index = 0; index < fine.length; index += 1) {
      const a = fine[index];
      const b = fine[(index + 1) % fine.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq)) : 0;
      closest = Math.min(closest, Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy)));
      if (closest < 1e-12) break;
    }
    // The fine polyline is inscribed, so a point exactly on the curve sits at most
    // the fine tolerance outside it.
    assert.ok(closest < fineToleranceMm, `a coarse vertex at ${point} is ${closest} from the fine profile`);
  }
});

test("no CURVE_SEGMENTS constant survives in the gear module", async () => {
  // `AGENTS.md` forbids reintroducing it, and cycle 03 removed it everywhere except
  // here. A source-level assertion catches the one somebody adds back in six months.
  const { promises } = await import("node:fs");
  const source = await promises.readFile(new URL("../../src/parts/gears.js", import.meta.url), "utf8");
  // Assembled so this file does not itself contain the token it is grepping for.
  const forbidden = ["CURVE", "SEGMENTS"].join("_");
  assert.ok(!source.includes(forbidden), "gears.js must take its segment counts from a chord tolerance");
  // And the tessellation module it must read them through is actually imported.
  assert.ok(source.includes("circleSegmentsForRadius"));
});

/* ------------------------------------------------------------- shift, backlash */

test("zero profile shift and zero backlash reproduce the nominal gear", () => {
  const nominal = createSpurGearProfilePoints({ toothCount: 24, moduleMm: 2, pressureAngleDeg: 20 });
  const explicit = createSpurGearProfilePoints({
    toothCount: 24,
    moduleMm: 2,
    pressureAngleDeg: 20,
    profileShiftCoefficient: 0,
    backlashMm: 0,
    rootFilletFactor: null,
    rackProfileId: "A",
    helixAngleDeg: 0
  });
  assert.deepEqual(explicit, nominal, "an existing saved gear must open unchanged in shape");

  const geometry = spurGearGeometry({ toothCount: 24, moduleMm: 2 });
  // The nominal tooth thickness is half the circular pitch, which is the definition
  // of an unshifted, backlash-free tooth.
  assert.ok(Math.abs(geometry.referenceToothThicknessMm - geometry.circularPitchMm / 2) < 1e-12);
  assert.equal(geometry.twistAngleRad, 0);
  assert.equal(geometry.twistSteps, 1);
});

test("a profile shift moves the tip and the root by the stated amount", () => {
  const base = spurGearGeometry({ toothCount: 20, moduleMm: 2 });
  for (const shift of [-0.5, -0.25, 0.25, 0.5]) {
    const shifted = spurGearGeometry({ toothCount: 20, moduleMm: 2, profileShiftCoefficient: shift });
    const expected = shift * base.moduleMm;
    assert.ok(Math.abs(shifted.nominalTipRadiusMm - base.tipRadiusMm - expected) < 1e-12, `tip at x=${shift}`);
    assert.ok(Math.abs(shifted.rootRadiusMm - base.rootRadiusMm - expected) < 1e-12, `root at x=${shift}`);
    // The base circle does not move: a shift slides the same involute along the same
    // base circle, which is the property that lets two shifted gears still mesh.
    assert.ok(Math.abs(shifted.baseRadiusMm - base.baseRadiusMm) < 1e-12);
    // And it is visible in the emitted profile, not only in the report.
    const radii = createSpurGearProfilePoints(shifted.gear).map(radius);
    assert.ok(Math.abs(Math.max(...radii) - shifted.tipRadiusMm) < 1e-9);
    assert.ok(Math.abs(Math.min(...radii) - shifted.rootRadiusMm) < 1e-9);
  }
});

test("backlash thins the tooth by its own width at the pitch circle, and only there", () => {
  const backlashMm = 0.2;
  const nominal = spurGearGeometry({ toothCount: 24, moduleMm: 2 });
  const loose = spurGearGeometry({ toothCount: 24, moduleMm: 2, backlashMm });

  assert.ok(Math.abs(nominal.referenceToothThicknessMm - loose.referenceToothThicknessMm - backlashMm) < 1e-12);
  // The radii are untouched: backlash is a tooth-thickness allowance, not a depth.
  assert.ok(Math.abs(nominal.tipRadiusMm - loose.tipRadiusMm) < 1e-12);
  assert.ok(Math.abs(nominal.rootRadiusMm - loose.rootRadiusMm) < 1e-12);

  // Measured on the polygon, at the pitch circle, in millimetres of arc.
  const measure = (geometry) => {
    const widths = toothArcHalfAngles(gearProfile(geometry.gear), geometry.pitchRadiusMm);
    return 2 * (widths.reduce((sum, value) => sum + value, 0) / widths.length) * geometry.pitchRadiusMm;
  };
  assert.ok(Math.abs(measure(nominal) - measure(loose) - backlashMm) < 2e-6);
});

/* ------------------------------------------------------------------- undercut */

test("undercut is a manufacturability finding and never blocks a compile", () => {
  // The plan's task 3, decided the way it predicted: an undercut gear is
  // manufacturable and merely weak, and `validateBody` refuses to compile on
  // anything it holds.
  const body = normalizePartBody(
    createSpurGearBody({ gear: { toothCount: 10, moduleMm: 2, pressureAngleDeg: 20, boreDiameterMm: 3, thicknessMm: 6 } })
  );
  assert.deepEqual(validateSpurGearSpec(body.gear), [], "undercut must not reach the compile gate");
  assert.ok(compilePartBodyToSolid(body), "and the gear must still compile");

  const findings = validateManufacturability(body);
  const undercut = findings.find((issue) => issue.code === DFM_GEAR_UNDERCUT);
  assert.ok(undercut, `expected an undercut finding, got ${findings.map((issue) => issue.code).join(", ")}`);
  assert.equal(undercut.severity, "warning");
  assert.equal(undercut.toothCount, 10);
  // The threshold is the closed form from the standards module, not a literal here.
  assert.equal(
    undercut.thresholdToothCount,
    undercutLimitToothCount({ profileId: "A", pressureAngleDeg: 20, profileShiftCoefficient: 0, filletRadiusFactor: 0.38 })
  );
  assert.ok(undercut.message.includes("10 teeth"));
});

test("the undercut limit lands on the classical 20 degree figure and moves with the parameters", () => {
  // Not an assertion against a number copied out of the implementation: 17.1 is the
  // textbook minimum tooth count for a 20 degree full-depth tooth, and the formula
  // producing it is what makes the rest of this trustworthy.
  const standard = undercutLimitToothCount({ profileId: "A", pressureAngleDeg: 20, profileShiftCoefficient: 0 });
  assert.ok(standard > 17 && standard < 17.2, `${standard}`);

  // A steeper pressure angle undercuts later; positive shift relieves it.
  assert.ok(undercutLimitToothCount({ profileId: "A", pressureAngleDeg: 25 }) < standard);
  assert.ok(undercutLimitToothCount({ profileId: "A", pressureAngleDeg: 14.5 }) > standard);
  assert.ok(undercutLimitToothCount({ profileId: "A", pressureAngleDeg: 20, profileShiftCoefficient: 0.5 }) < standard);

  // And the minimum shift that clears a given tooth count is the same inequality:
  // applying it must remove the finding.
  const geometry = spurGearGeometry({ toothCount: 10, moduleMm: 2, pressureAngleDeg: 20 });
  assert.equal(geometry.undercut, true);
  const relieved = spurGearGeometry({
    toothCount: 10,
    moduleMm: 2,
    pressureAngleDeg: 20,
    profileShiftCoefficient: geometry.minimumProfileShiftCoefficient
  });
  assert.equal(relieved.undercut, false);
});

test("a degenerate tooth form is reported rather than silently drawn", () => {
  // A pointed tip from too much positive shift.
  const pointed = normalizePartBody(
    createSpurGearBody({ gear: { toothCount: 8, moduleMm: 2, profileShiftCoefficient: 0.8, boreDiameterMm: 2, thicknessMm: 6 } })
  );
  const pointedGeometry = spurGearGeometry(pointed.gear);
  assert.equal(pointedGeometry.tipPointed, true);
  // Exactly zero, not "nearly": the half-angle at the crossing radius comes back as
  // some 1e-16 from the solve, and a land one point wide would put a duplicate vertex
  // in the profile, so the generator snaps it.
  assert.equal(pointedGeometry.tipLandWidthMm, 0);
  assert.ok(pointedGeometry.tipRadiusMm < pointedGeometry.nominalTipRadiusMm);
  const pointedFinding = validateManufacturability(pointed).find((issue) => issue.code === DFM_GEAR_DEGENERATE_TOOTH);
  assert.ok(pointedFinding);
  assert.equal(pointedFinding.tipPointed, true);

  // A pointed root, where the flanks converge above the rack's root circle. The
  // generator clamps the root up to the apex; a zero-width root land is exactly the
  // defect this cycle removes, so where geometry forces one it is reported.
  const vRoot = normalizePartBody(
    createSpurGearBody({ gear: { toothCount: 120, moduleMm: 1, pressureAngleDeg: 35, boreDiameterMm: 20, thicknessMm: 6 } })
  );
  const vGeometry = spurGearGeometry(vRoot.gear);
  assert.equal(vGeometry.rootPointed, true);
  assert.equal(vGeometry.rootLandWidthMm, 0);
  assert.ok(vGeometry.rootRadiusMm > vGeometry.nominalRootRadiusMm);
  assert.equal(selfIntersection(createSpurGearProfilePoints(vRoot.gear)), null, "and it is still a valid polygon");
  const vFinding = validateManufacturability(vRoot).find((issue) => issue.code === DFM_GEAR_DEGENERATE_TOOTH);
  assert.ok(vFinding);
  assert.equal(vFinding.rootPointed, true);

  // A healthy gear reports neither.
  const healthy = normalizePartBody(createSpurGearBody());
  const codes = validateManufacturability(healthy).map((issue) => issue.code);
  assert.ok(!codes.includes(DFM_GEAR_DEGENERATE_TOOTH));
  assert.ok(!codes.includes(DFM_GEAR_UNDERCUT));
});

/* ------------------------------------------------------------------ the solid */

test("compiles a reliable spur gear body with a bore", () => {
  const body = createSpurGearBody({
    gear: {
      toothCount: 18,
      moduleMm: 2,
      pressureAngleDeg: 20,
      boreDiameterMm: 5,
      thicknessMm: 6
    }
  });
  const solid = compilePartBodyToSolid(body);
  const [min, max] = measureBoundingBox(solid);

  assert.equal(body.source.kind, "spurGear");
  assert.equal(Number((max[1] - min[1]).toFixed(3)), 6);
  assert.ok(max[0] - min[0] > 38);
  assert.ok(measureVolume(solid) > 0);
});

test("the compiled gear is watertight and states a mass", () => {
  // A self-intersecting profile shows up downstream as a missing mass rather than as
  // a crash, so watertightness is asserted rather than trusted.
  const specs = [
    { toothCount: 24, moduleMm: 2, boreDiameterMm: 6, thicknessMm: 6 },
    { toothCount: 6, moduleMm: 2, boreDiameterMm: 1, thicknessMm: 4 },
    { toothCount: 8, moduleMm: 2, boreDiameterMm: 2, thicknessMm: 6, profileShiftCoefficient: 0.8 },
    { toothCount: 120, moduleMm: 1, pressureAngleDeg: 35, boreDiameterMm: 20, thicknessMm: 5 },
    { toothCount: 24, moduleMm: 2, boreDiameterMm: 0, thicknessMm: 6, rootFilletFactor: 0 },
    { toothCount: 24, moduleMm: 2, boreDiameterMm: 6, thicknessMm: 8, helixAngleDeg: 20 }
  ];

  for (const gear of specs) {
    const body = normalizePartBody(createSpurGearBody({ gear }));
    const solid = compilePartBodyToSolid(body);
    const report = solidWatertightReport(solid);
    assert.equal(report.watertight, true, `${JSON.stringify(gear)} left ${report.unmatchedEdgeCount} unmatched edges`);

    const properties = bodyGeometryProperties(body, solid);
    assert.ok(properties.volumeMm3 > 0, `${JSON.stringify(gear)} has no volume`);
    assert.notEqual(properties.volumeMm3, null);
  }
});

test("the outside diameter the page reports is the one the solid has", () => {
  // `resize.js` used to compute `(z + 2) m` itself, which a profile shift makes wrong.
  for (const gear of [{}, { profileShiftCoefficient: 0.5 }, { profileShiftCoefficient: -0.5 }, { toothCount: 8, profileShiftCoefficient: 0.8, boreDiameterMm: 2 }]) {
    const body = normalizePartBody(createSpurGearBody({ gear }));
    const [min, max] = measureBoundingBox(compilePartBodyToSolid(body));
    const reported = spurGearTipDiameterMm(body.gear);
    // The tip land is sampled with an even segment count, so a vertex sits on each
    // tooth's centreline and the diameter is the nominal one rather than a chord's
    // width under it. What is left is the JSCAD 2D bore boolean, which moves boundary
    // vertices by about 1e-4 mm - pipeline behaviour older than this cycle.
    assert.ok(
      Math.abs(max[0] - min[0] - reported) < 1e-3,
      `${JSON.stringify(gear)}: measured ${max[0] - min[0]} against a reported ${reported}`
    );
  }
});

test("the module that gives a target outside diameter is an exact inversion", () => {
  for (const gear of [{}, { profileShiftCoefficient: 0.5 }, { toothCount: 8, profileShiftCoefficient: 0.8 }, { pressureAngleDeg: 30 }]) {
    const spec = normalizeSpurGearSpec(gear);
    for (const target of [12, 40, 137.5]) {
      const moduleMm = spurGearModuleForTipDiameterMm(spec, target);
      assert.ok(Math.abs(spurGearTipDiameterMm({ ...spec, moduleMm }) - target) < 1e-9, `${JSON.stringify(gear)} at ${target}`);
    }
  }
});

/* -------------------------------------------------------------------- helical */

test("the helical twist is derived from the helix angle and holds the chord tolerance", () => {
  const thicknessMm = 10;
  const gear = { toothCount: 24, moduleMm: 2, thicknessMm, helixAngleDeg: 20, boreDiameterMm: 6 };
  const geometry = spurGearGeometry(gear);

  // Over the face width the reference cylinder advances `b tan(beta)` of arc, so the
  // twist is that over the reference radius. Asserted against the arc length rather
  // than against the formula: the twisted profile must displace the reference circle
  // by exactly `b tan(beta)`.
  const arcAdvanceMm = geometry.twistAngleRad * geometry.pitchRadiusMm;
  assert.ok(Math.abs(arcAdvanceMm - thicknessMm * Math.tan(20 / DEG)) < 1e-12);

  // Steps come from the same sagitta relation the 2D features use, so a finer
  // tolerance takes more of them and a coarser one fewer.
  const finer = spurGearGeometry(gear, { toleranceMm: 0.001 });
  const coarser = spurGearGeometry(gear, { toleranceMm: 0.2 });
  assert.ok(finer.twistSteps > geometry.twistSteps);
  assert.ok(coarser.twistSteps <= geometry.twistSteps);

  // Left hand is the negative of right hand and nothing else.
  const left = spurGearGeometry({ ...gear, helixAngleDeg: -20 });
  assert.ok(Math.abs(left.twistAngleRad + geometry.twistAngleRad) < 1e-15);
  assert.equal(left.twistSteps, geometry.twistSteps);
});

test("a concentric bore comes out straight through a helical gear", () => {
  // The bore is subtracted in 2D before the twist, which is correct rather than
  // convenient: a circle centred on the axis of rotation is invariant under a
  // rotation about that axis. This measures it at both faces.
  const boreDiameterMm = 6;
  const thicknessMm = 12;
  const body = normalizePartBody(
    createSpurGearBody({ gear: { toothCount: 24, moduleMm: 2, boreDiameterMm, thicknessMm, helixAngleDeg: 25 } })
  );
  const solid = compilePartBodyToSolid(body);
  const [min, max] = measureBoundingBox(solid);

  // Vertices nearest the axis, taken separately at each face of the gear.
  const faceBoreRadius = (targetY) => {
    let closest = Infinity;
    for (const polygon of jscad.geometries.geom3.toPolygons(solid)) {
      for (const vertex of polygon.vertices) {
        if (Math.abs(vertex[1] - targetY) > 1e-6) continue;
        closest = Math.min(closest, Math.hypot(vertex[0], vertex[2]));
      }
    }
    return closest;
  };

  const bottom = faceBoreRadius(min[1]);
  const top = faceBoreRadius(max[1]);
  assert.ok(Number.isFinite(bottom) && Number.isFinite(top));
  assert.ok(Math.abs(bottom - top) < 1e-9, `bore radius ${bottom} at one face and ${top} at the other`);
  // And it is the bore that was asked for, to within the inscribed chord tolerance.
  assert.ok(Math.abs(bottom - boreDiameterMm / 2) < DEFAULT_CHORD_TOLERANCE_MM);
  assert.equal(Number((max[1] - min[1]).toFixed(6)), thicknessMm);
});

/* ----------------------------------------------------------------- the pair */

test("a 20 and a 40 tooth gear mesh, with the contact ratio measured off the profiles", () => {
  // The acceptance criterion. Every input below is measured from the emitted
  // polygons - tooth count by counting teeth, pitch radius by finding where tooth
  // and space are equal, base radius from the normal to the flank - so this is not
  // the generator's arithmetic checked against itself.
  const pinionSpec = { toothCount: 20, moduleMm: 2, pressureAngleDeg: 20, boreDiameterMm: 6, thicknessMm: 6 };
  const wheelSpec = { ...pinionSpec, toothCount: 40 };
  const pinion = gearProfile(pinionSpec);
  const wheel = gearProfile(wheelSpec);

  const pinionMeasured = measurePitchRadius(pinion);
  const wheelMeasured = measurePitchRadius(wheel);
  assert.equal(pinionMeasured.toothCount, 20);
  assert.equal(wheelMeasured.toothCount, 40);

  const pinionTipMm = Math.max(...pinion.map(radius));
  const wheelTipMm = Math.max(...wheel.map(radius));
  const pinionBaseMm = measureBaseRadius(pinion, pinionMeasured.pitchRadiusMm);
  const wheelBaseMm = measureBaseRadius(wheel, wheelMeasured.pitchRadiusMm);

  // Nominal centre distance is the sum of the measured pitch radii.
  const centreDistanceMm = pinionMeasured.pitchRadiusMm + wheelMeasured.pitchRadiusMm;
  // The pressure angle follows from the measured base and pitch radii, and the two
  // gears must agree on it or they would not be a pair.
  const pinionAlpha = Math.acos(pinionBaseMm / pinionMeasured.pitchRadiusMm);
  const wheelAlpha = Math.acos(wheelBaseMm / wheelMeasured.pitchRadiusMm);
  assert.ok(Math.abs(pinionAlpha - wheelAlpha) < 1e-4);

  // The path of contact runs between the two tip circles along the line of action.
  const actionSpanMm = centreDistanceMm * Math.sin(pinionAlpha);
  const lengthOfActionMm =
    Math.sqrt(pinionTipMm ** 2 - pinionBaseMm ** 2) + Math.sqrt(wheelTipMm ** 2 - wheelBaseMm ** 2) - actionSpanMm;
  // Base pitch measured as the base circumference over the counted tooth count.
  const basePitchMm = (2 * Math.PI * pinionBaseMm) / pinionMeasured.toothCount;
  assert.ok(Math.abs(basePitchMm - (2 * Math.PI * wheelBaseMm) / wheelMeasured.toothCount) < 1e-4);

  const measuredContactRatio = lengthOfActionMm / basePitchMm;
  assert.ok(measuredContactRatio > 1, `measured contact ratio ${measuredContactRatio}`);

  // And the report agrees with the measurement, which is what makes the report
  // trustworthy for the pair the user actually asked about.
  const report = spurGearPairReport(pinionSpec, wheelSpec);
  assert.equal(report.ok, true);
  assert.ok(Math.abs(report.centreDistanceMm - centreDistanceMm) < 1e-3);
  assert.ok(Math.abs(report.contactRatio - measuredContactRatio) < 1e-3, `${report.contactRatio} vs ${measuredContactRatio}`);
  assert.ok(report.contactRatio > 1);
  assert.equal(report.gearRatio, 2);
  assert.equal(report.tipInterference, false);
  assert.ok(report.tipRootClearanceMm > 0);
});

test("a pair that cannot mesh is refused with a reason instead of a number", () => {
  const mismatch = spurGearPairReport({ toothCount: 20, moduleMm: 2 }, { toothCount: 20, moduleMm: 3 });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.centreDistanceMm, undefined, "no centre distance may be invented for gears that do not mesh");
  assert.ok(mismatch.issues.some((issue) => issue.code === GEAR_PAIR_MODULE_MISMATCH));

  const angles = spurGearPairReport({ toothCount: 20, pressureAngleDeg: 20 }, { toothCount: 20, pressureAngleDeg: 25 });
  assert.equal(angles.ok, false);
  assert.ok(angles.issues.some((issue) => issue.code === "gear-pair-pressure-angle-mismatch"));
});

test("profile shift opens the centre distance through the operating pressure angle", () => {
  const nominal = spurGearPairReport({ toothCount: 20, moduleMm: 2 }, { toothCount: 40, moduleMm: 2 });
  assert.ok(Math.abs(nominal.centreDistanceMm - nominal.referenceCentreDistanceMm) < 1e-12);
  assert.ok(Math.abs(nominal.operatingPressureAngleDeg - 20) < 1e-9);

  const shifted = spurGearPairReport(
    { toothCount: 20, moduleMm: 2, profileShiftCoefficient: 0.3 },
    { toothCount: 40, moduleMm: 2, profileShiftCoefficient: 0.3 }
  );
  assert.ok(shifted.centreDistanceMm > nominal.centreDistanceMm);
  assert.ok(shifted.operatingPressureAngleDeg > 20);
  // The relation is the involute one, checked by inverting it rather than by
  // repeating the forward formula.
  const alpha = 20 / DEG;
  const expectedInvolute = involuteAngle(alpha) + (2 * 0.6 * Math.tan(alpha)) / 60;
  assert.ok(Math.abs(shifted.operatingPressureAngleDeg / DEG - inverseInvoluteAngle(expectedInvolute)) < 1e-9);
  // Backlash is per gear, so the pair's is the sum.
  const loose = spurGearPairReport({ toothCount: 20, backlashMm: 0.1 }, { toothCount: 40, backlashMm: 0.15 });
  assert.ok(Math.abs(loose.circumferentialBacklashMm - 0.25) < 1e-12);
});

test("a low contact ratio and a helix mismatch are reported without refusing the pair", () => {
  // Two six-tooth gears have a short path of contact for their base pitch.
  const small = spurGearPairReport({ toothCount: 6, moduleMm: 2 }, { toothCount: 6, moduleMm: 2 });
  assert.ok(small.contactRatio > 0);
  assert.ok(small.issues.some((issue) => issue.code === "gear-pair-tip-interference"));

  const sameHand = spurGearPairReport(
    { toothCount: 20, helixAngleDeg: 20 },
    { toothCount: 40, helixAngleDeg: 20 }
  );
  assert.equal(sameHand.ok, false);
  assert.ok(sameHand.issues.some((issue) => issue.code === "gear-pair-helix-mismatch"));
  assert.ok(sameHand.contactRatio > 1, "the transverse numbers are still stated");

  const opposed = spurGearPairReport(
    { toothCount: 20, helixAngleDeg: 20, thicknessMm: 10 },
    { toothCount: 40, helixAngleDeg: -20, thicknessMm: 10 }
  );
  assert.equal(opposed.ok, true);
  assert.ok(opposed.overlapRatio > 0);
  assert.ok(Math.abs(opposed.totalContactRatio - (opposed.contactRatio + opposed.overlapRatio)) < 1e-12);
});

/* ------------------------------------------------- G12-G19, the second gap sweep */

test("a pair with no bottom clearance is refused, and still states its numbers", () => {
  // ⚠ G12, a refusal path no test reached: `tipRootClearanceMm > 0` was asserted on a
  // healthy pair and nothing ever drove it negative, so the whole issue could be switched
  // off without a failure. Two gears at +1 shift each run out of bottom clearance while
  // their contact ratio stays perfectly healthy - which is exactly why the pair binds
  // before anyone notices from the contact ratio alone.
  const bound = spurGearPairReport(
    { toothCount: 20, moduleMm: 2, profileShiftCoefficient: 1 },
    { toothCount: 40, moduleMm: 2, profileShiftCoefficient: 1 }
  );
  assert.ok(bound.tipRootClearanceMm < 0, "this fixture must really run out of clearance");
  const clearance = bound.issues.find((issue) => issue.code === GEAR_PAIR_NO_CLEARANCE);
  assert.ok(clearance, "no bottom clearance must be reported");
  assert.equal(clearance.severity, "error");
  assert.equal(bound.ok, false);
  assert.ok(bound.contactRatio > 1, "and the numbers stay available - the ratio alone would have looked fine");

  // The other direction, so the branch is shown reachable both ways.
  const healthy = spurGearPairReport({ toothCount: 20, moduleMm: 2 }, { toothCount: 40, moduleMm: 2 });
  assert.ok(healthy.tipRootClearanceMm > 0);
  assert.equal(healthy.issues.some((issue) => issue.code === GEAR_PAIR_NO_CLEARANCE), false);
});

test("tip interference is reported for either gear, not only for the first", () => {
  // ⚠ G17. The existing fixture is a symmetric 6/6 pair, where the two terms of the
  // condition cannot be told apart - dropping the second one left the suite green. A 6/40
  // pair separates them: the pinion's tip stays inside the span and the wheel's does not.
  const pinionSpec = { toothCount: 6, moduleMm: 2 };
  const wheelSpec = { toothCount: 40, moduleMm: 2 };
  const a = spurGearGeometry(pinionSpec);
  const b = spurGearGeometry(wheelSpec);
  const report = spurGearPairReport(pinionSpec, wheelSpec);

  const reachA = Math.sqrt(a.tipRadiusMm ** 2 - a.baseRadiusMm ** 2);
  const reachB = Math.sqrt(b.tipRadiusMm ** 2 - b.baseRadiusMm ** 2);
  assert.ok(reachA < report.actionSpanMm, "the first gear's tip must stay inside the span, or this proves nothing");
  assert.ok(reachB > report.actionSpanMm, "and the second gear's must reach past it");

  assert.equal(report.tipInterference, true);
  assert.ok(report.issues.some((issue) => issue.code === GEAR_PAIR_TIP_INTERFERENCE));
});

test("the pair reports each gear's own tooth count, in the order it was asked", () => {
  // ⚠ G13. `gearRatio` was asserted and the inspector does not render it: the Ratio cell
  // is written `${toothCountB}:${toothCountA}`, and those two fields were asserted nowhere.
  // Swapping them left the suite green and reverses every ratio the page prints.
  const report = spurGearPairReport({ toothCount: 20, moduleMm: 2 }, { toothCount: 40, moduleMm: 2 });
  assert.equal(report.toothCountA, 20);
  assert.equal(report.toothCountB, 40);
  assert.equal(report.gearRatio, report.toothCountB / report.toothCountA, "the ratio and the counts must tell one story");
  assert.equal(`${report.toothCountB}:${report.toothCountA}`, "40:20", "the string the Pair grid renders");
});

test("`helical` and the profile-shift sum report what the pair was actually built from", () => {
  // ⚠ G14 and G16. `helical` chooses which of two different numbers the Allowance grid
  // shows - the total contact ratio or the operating pressure angle - so hard-wiring it
  // false silently swaps one cell for another, under a different label, with no failure.
  const spur = spurGearPairReport({ toothCount: 20, moduleMm: 2 }, { toothCount: 40, moduleMm: 2 });
  assert.equal(spur.helical, false);
  assert.equal(spur.profileShiftSum, 0);

  const helical = spurGearPairReport(
    { toothCount: 20, moduleMm: 2, helixAngleDeg: 20, thicknessMm: 10, profileShiftCoefficient: 0.2 },
    { toothCount: 40, moduleMm: 2, helixAngleDeg: -20, thicknessMm: 10, profileShiftCoefficient: 0.3 }
  );
  assert.equal(helical.helical, true);
  assert.equal(helical.helixOpposed, true);
  // The sum is the input the operating pressure angle was derived from, so a wrong one
  // makes the centre distance unexplainable from the numbers printed beside it.
  assert.ok(Math.abs(helical.profileShiftSum - 0.5) < 1e-12);
  assert.ok(helical.centreDistanceMm > helical.referenceCentreDistanceMm);
});

test("a same-hand helical pair gets no axial overlap", () => {
  // ⚠ G15. The mismatch is refused with a reason, and the overlap ratio beside it was
  // asserted only on the opposed pair - so the same-hand one could be handed an overlap
  // that a pair which cannot mesh has no way to develop. The transverse numbers are
  // deliberately still stated; the axial one is not, because it does not exist.
  const sameHand = spurGearPairReport(
    { toothCount: 20, moduleMm: 2, helixAngleDeg: 20, thicknessMm: 10 },
    { toothCount: 40, moduleMm: 2, helixAngleDeg: 20, thicknessMm: 10 }
  );
  assert.equal(sameHand.helical, true);
  assert.equal(sameHand.helixOpposed, false);
  assert.equal(sameHand.overlapRatio, 0);
  assert.equal(sameHand.totalContactRatio, sameHand.contactRatio, "no axial term to add");

  const opposed = spurGearPairReport(
    { toothCount: 20, moduleMm: 2, helixAngleDeg: 20, thicknessMm: 10 },
    { toothCount: 40, moduleMm: 2, helixAngleDeg: -20, thicknessMm: 10 }
  );
  assert.ok(opposed.overlapRatio > 0, "the other direction, or the assertion above passes on a constant");
});

test("a gear with no stated bore gets one derived from its own root radius", () => {
  // ⚠ G18. Every bore assertion in this file passes an explicit `boreDiameterMm`, so the
  // default the normalizer computes - which is what a newly created gear body gets - was
  // never looked at. A zero default is a gear that cannot go on a shaft.
  const small = normalizeSpurGearSpec({ toothCount: 12, moduleMm: 1 });
  const large = normalizeSpurGearSpec({ toothCount: 60, moduleMm: 3 });
  for (const spec of [small, large]) {
    assert.ok(spec.boreDiameterMm > 0, "a default bore is derived, not left at zero");
    const rootDiameterMm = 2 * spurGearGeometry(spec).rootRadiusMm;
    assert.ok(spec.boreDiameterMm < rootDiameterMm, "and it stays inside the root the generator cuts");
    assert.deepEqual(validateSpurGearSpec(spec), [], "so a default gear validates");
  }
  // It follows the gear rather than being one constant: a 12-tooth module-1 gear has a
  // smaller root circle than a 60-tooth module-3 one and cannot carry the same shaft.
  assert.ok(small.boreDiameterMm < large.boreDiameterMm);
  // And an explicit zero is still honoured - a bore is optional.
  assert.equal(normalizeSpurGearSpec({ toothCount: 24, moduleMm: 2, boreDiameterMm: 0 }).boreDiameterMm, 0);
});

test("the normalizer clamps tooth count to the limit the validator refuses past", () => {
  // ⚠ G19, F1's shape: `normalizeSpurGearSpec` clamps and `validateSpurGearSpec` refuses,
  // both correctly and neither compared against the other. Removing the clamp left the
  // suite green and leaves the two disagreeing - a normalized spec the validator rejects,
  // which is a body that cannot be saved and cannot be fixed from the panel.
  const clamped = normalizeSpurGearSpec({ toothCount: MAX_TOOTH_COUNT + 400, moduleMm: 2 });
  assert.equal(clamped.toothCount, MAX_TOOTH_COUNT);
  assert.deepEqual(validateSpurGearSpec(clamped), [], "whatever the normalizer emits, the validator must accept");
  assert.ok(
    validateSpurGearSpec({ ...clamped, toothCount: MAX_TOOTH_COUNT + 1 }).some((issue) => issue.code === "invalid-gear-tooth-count"),
    "and the validator must really refuse past the cap, or the agreement above is vacuous"
  );
  assert.equal(normalizeSpurGearSpec({ toothCount: -5, moduleMm: 2 }).toothCount >= 6, true, "and the floor clamps too");
});
