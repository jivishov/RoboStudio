/**
 * Hole features: a fastener standard resolved into geometry.
 *
 * ## Why this module exists
 *
 * Before this, a hole was a circle with a radius, and the radius was whatever a
 * template author typed - which is how `base_plate` shipped 6.4 mm holes for M3
 * screws. A designer could not ask for "M3 clearance, normal fit" and could not
 * ask for a counterbore at all.
 *
 * A cut profile may now carry a `hole` object, and this module turns
 * `{ standard, size, fit, style }` into the diameters and depths the compiler,
 * the exporters and the inspector all read. `standards/fasteners.js` owns the
 * numbers; this file owns nothing but the resolution.
 *
 * ## The refusal rule, which is the whole contract
 *
 * **Nothing is interpolated.** A combination the fastener table does not hold is
 * refused with a reason that names the combination, and no geometry is produced
 * from a number this page invented. A heat-set insert bore for M2.5 is not the
 * mean of the M2 and M4 bores; it is a value nobody has published, so asking for
 * it gets a refusal rather than a hole that looks authoritative and is wrong.
 *
 * A dimension the table holds but flags as unverified against a published
 * standard is a different case: it is emitted, and it is emitted *labelled*. The
 * machined counterbore diameter is quoted from DIN 974-1 row 1 and carries
 * `confidence: "unverified"` through `provenance`, so a caller that needs to
 * warn can, and a caller that does not is still not handed a silent guess.
 *
 * ## The two-part geometry
 *
 * Every hole style resolves to a **pilot** - the through feature, a circle in the
 * sketch plane - and optionally a **pocket** - a blind 3D feature cut from one
 * face after extrusion.
 *
 * | Style | Pilot | Pocket |
 * |---|---|---|
 * | `through` | ISO 273 clearance at the requested fit | none |
 * | `tapped` | tap drill, nominal minus pitch (`fit` is unused) | none |
 * | `counterbore` | ISO 273 clearance | cylinder at the counterbore diameter |
 * | `countersink` | ISO 273 clearance | 90-degree cone to the ISO 7046 head diameter |
 * | `nutTrap` | ISO 273 clearance | hexagonal prism at the ISO 4032 across-flats |
 * | `heatSetInsert` | ISO 273 clearance | cylinder at the vendor insert bore |
 *
 * The pilot is always a through cut because a `hole` lives on a **cut profile**,
 * and a cut profile is by construction a through opening in the 2D sketch. That
 * makes a heat-set insert a stepped hole - the insert bore from the chosen face
 * plus a clearance hole through - rather than a blind boss, so a screw longer than
 * the insert does not bottom out. A blind pocket with no through opening is not
 * expressible as a cut profile and is not attempted here.
 *
 * `fromFace` is per hole, so a body may carry pockets on both faces by giving
 * each hole its own face. What one `hole` object cannot say is "counterbored from
 * both ends": it has one `style` and one `fromFace`. That is undesigned rather
 * than approximated.
 *
 * The module is DOM-free and JSCAD-free: it runs in the CAD worker, on the main
 * thread, and under `node:test`.
 */

import { createIssue } from "./issues.js";
import {
  CLEARANCE_FITS,
  FASTENER_SIZES,
  clearanceHoleDiameterMm,
  counterboreMm,
  countersinkMm,
  getFastener,
  heatSetInsertMm,
  isFastenerSize,
  nutTrapMm,
  tapDrillDiameterMm
} from "./standards/fasteners.js";

export const HOLE_STANDARD_ISO_METRIC = "ISO metric";
export const HOLE_STANDARDS = Object.freeze([HOLE_STANDARD_ISO_METRIC]);
export const HOLE_STYLES = Object.freeze([
  "through",
  "counterbore",
  "countersink",
  "tapped",
  "heatSetInsert",
  "nutTrap"
]);
/** Styles that add a post-extrude 3D pocket. The rest are pure 2D cuts. */
export const HOLE_POCKET_STYLES = Object.freeze(["counterbore", "countersink", "heatSetInsert", "nutTrap"]);
export const HOLE_PROCESSES = Object.freeze(["fdm", "machined"]);
export const HOLE_FACES = Object.freeze(["top", "bottom"]);
export const HOLE_POCKET_SHAPES = Object.freeze(["cylinder", "cone", "hexPrism"]);

export const HOLE_DEFAULT_STANDARD = HOLE_STANDARD_ISO_METRIC;
export const HOLE_DEFAULT_FIT = "normal";
export const HOLE_DEFAULT_STYLE = "through";
export const HOLE_DEFAULT_PROCESS = "fdm";
export const HOLE_DEFAULT_FACE = "top";

/**
 * Refusal codes. These are diagnostic strings on a resolution result, not
 * `validateBody` issues: a hole that cannot resolve leaves the profile's own
 * radius alone and must never block a compile. Cycle 06 owns manufacturability
 * findings, and `AGENTS.md` keeps them out of the compile gate.
 */
export const HOLE_UNSUPPORTED_STANDARD = "hole-unsupported-standard";
export const HOLE_UNSUPPORTED_SIZE = "hole-unsupported-size";
export const HOLE_UNSUPPORTED_FIT = "hole-unsupported-fit";
export const HOLE_UNSUPPORTED_STYLE = "hole-unsupported-style";
export const HOLE_UNSUPPORTED_PROCESS = "hole-unsupported-process";
export const HOLE_UNSUPPORTED_FACE = "hole-unsupported-face";
export const HOLE_NO_PUBLISHED_VALUE = "hole-no-published-value";
export const HOLE_DEGENERATE_COUNTERSINK = "hole-degenerate-countersink";

/** Compile-result warning codes. Reports, never `validateBody` issues. */
export const REFUSED_HOLE_CODE = "unresolvable-hole-standard";
export const POCKET_BREAKTHROUGH_CODE = "hole-pocket-breaks-through";

/** Long enough for any real designation, short enough that a typo cannot bloat the record. */
const HOLE_TOKEN_MAX_LENGTH = 40;

function holeToken(value) {
  return String(value ?? "").trim().slice(0, HOLE_TOKEN_MAX_LENGTH);
}

function describeRequest(spec) {
  const parts = [spec.standard, spec.size, `${spec.style} style`, `${spec.fit} fit`];
  if (spec.style === "counterbore") parts.push(`${spec.process} process`);
  return parts.filter(Boolean).join(", ");
}

/**
 * Normalize a hole object, or report that there is not one.
 *
 * Registered through `createCircleProfile`, so this is the shape that reaches
 * IndexedDB. Two rules follow from that.
 *
 * The author's own strings survive verbatim (trimmed and length-capped) even when
 * they name nothing the table holds. A normalizer that silently dropped an
 * unrecognised size would hide the refusal, and the user would reopen the project
 * to a plain circle with no explanation.
 *
 * `size` is the one field with no default: a hole with no size is
 * indistinguishable from no hole, so it resolves to `null` and the profile stays
 * exactly the circle it was.
 */
export function normalizeHoleSpec(hole) {
  if (!hole || typeof hole !== "object" || Array.isArray(hole)) return null;
  const size = holeToken(hole.size);
  if (!size) return null;

  return {
    standard: holeToken(hole.standard) || HOLE_DEFAULT_STANDARD,
    size,
    fit: holeToken(hole.fit) || HOLE_DEFAULT_FIT,
    style: holeToken(hole.style) || HOLE_DEFAULT_STYLE,
    process: holeToken(hole.process) || HOLE_DEFAULT_PROCESS,
    fromFace: holeToken(hole.fromFace) || HOLE_DEFAULT_FACE,
    // Defaults to locked. A hole that knows it is an M3 should stay an M3 unless
    // the author explicitly says otherwise, which is landmine three's whole point.
    lockSize: hole.lockSize !== false
  };
}

function refuse(spec, code, reason) {
  return { ok: false, spec, code, reason, pilotDiameterMm: null, pocket: null };
}

function cylinderPocket(style, spec, diameterMm, depthMm) {
  return {
    shape: "cylinder",
    style,
    fromFace: spec.fromFace,
    diameterMm,
    depthMm
  };
}

/**
 * Resolve a hole request into geometry.
 *
 * Returns `null` when the profile carries no hole at all, a result with
 * `ok: true` when every number it needs is published, and a result with
 * `ok: false` plus a `reason` naming the combination otherwise. It never throws
 * and never returns a partial resolution: a refused hole has a `null` pilot.
 */
export function resolveHole(hole) {
  const spec = normalizeHoleSpec(hole);
  if (!spec) return null;

  if (!HOLE_STANDARDS.includes(spec.standard)) {
    return refuse(
      spec,
      HOLE_UNSUPPORTED_STANDARD,
      `No hole standard named "${spec.standard}" is published here. Supported: ${HOLE_STANDARDS.join(", ")}.`
    );
  }
  if (!isFastenerSize(spec.size)) {
    return refuse(
      spec,
      HOLE_UNSUPPORTED_SIZE,
      `${spec.standard} size ${spec.size} is not in the fastener table. Published sizes: ${FASTENER_SIZES.join(", ")}.`
    );
  }
  if (!CLEARANCE_FITS.includes(spec.fit)) {
    return refuse(
      spec,
      HOLE_UNSUPPORTED_FIT,
      `No clearance fit named "${spec.fit}" is published for ${spec.size}. Supported: ${CLEARANCE_FITS.join(", ")}.`
    );
  }
  if (!HOLE_STYLES.includes(spec.style)) {
    return refuse(
      spec,
      HOLE_UNSUPPORTED_STYLE,
      `No hole style named "${spec.style}" exists. Supported: ${HOLE_STYLES.join(", ")}.`
    );
  }
  if (!HOLE_PROCESSES.includes(spec.process)) {
    return refuse(
      spec,
      HOLE_UNSUPPORTED_PROCESS,
      `No hole process named "${spec.process}" exists. Supported: ${HOLE_PROCESSES.join(", ")}.`
    );
  }
  if (!HOLE_FACES.includes(spec.fromFace)) {
    return refuse(
      spec,
      HOLE_UNSUPPORTED_FACE,
      `A pocket can only be cut from ${HOLE_FACES.join(" or ")}, not "${spec.fromFace}".`
    );
  }

  const provenance = [];
  let pilotDiameterMm;

  if (spec.style === "tapped") {
    pilotDiameterMm = tapDrillDiameterMm(spec.size);
    provenance.push({
      dimension: "pilot",
      source: "tap drill, nominal minus pitch",
      confidence: "verified"
    });
  } else {
    pilotDiameterMm = clearanceHoleDiameterMm(spec.size, spec.fit);
    provenance.push({
      dimension: "pilot",
      source: `ISO 273 clearance, ${spec.fit} fit`,
      confidence: "verified"
    });
  }

  // Belt and braces: every branch above went through `isFastenerSize`, so this is
  // unreachable today. It stays because the alternative to a refusal here would be
  // a hole of diameter `null`, which is exactly the silent fabrication this module
  // exists to prevent.
  if (!Number.isFinite(Number(pilotDiameterMm)) || Number(pilotDiameterMm) <= 0) {
    return refuse(
      spec,
      HOLE_NO_PUBLISHED_VALUE,
      `No published pilot diameter for ${describeRequest(spec)}.`
    );
  }
  pilotDiameterMm = Number(pilotDiameterMm);

  let pocket = null;

  if (spec.style === "counterbore") {
    const counterbore = counterboreMm(spec.size, spec.process);
    if (!counterbore) {
      return refuse(spec, HOLE_NO_PUBLISHED_VALUE, `No published counterbore for ${describeRequest(spec)}.`);
    }
    pocket = cylinderPocket("counterbore", spec, counterbore.diameterMm, counterbore.depthMm);
    provenance.push({
      dimension: "counterbore",
      // The FDM diameter is head diameter plus a stated allowance, so it is as
      // trustworthy as the ISO 4762 head it derives from. The machined column is
      // quoted from DIN 974-1 row 1 and `standards/fasteners.js` flags it as
      // needing a standard lookup, so it is emitted labelled rather than silently.
      source: spec.process === "fdm"
        ? "ISO 4762 head diameter plus the printed allowance"
        : "DIN 974-1 row 1",
      confidence: spec.process === "fdm" ? "verified" : "unverified"
    });
    provenance.push({
      dimension: "counterboreDepth",
      source: "ISO 4762 head height plus allowance",
      confidence: "verified"
    });
  }

  if (spec.style === "countersink") {
    const countersink = countersinkMm(spec.size);
    if (!countersink) {
      return refuse(spec, HOLE_NO_PUBLISHED_VALUE, `No published countersink for ${describeRequest(spec)}.`);
    }
    const halfAngleRad = (countersink.includedAngleDeg / 2) * (Math.PI / 180);
    const depthMm = (countersink.headDiameterMm - pilotDiameterMm) / 2 / Math.tan(halfAngleRad);
    if (!(depthMm > 0)) {
      return refuse(
        spec,
        HOLE_DEGENERATE_COUNTERSINK,
        `A ${spec.fit}-fit ${spec.size} pilot of ${pilotDiameterMm} mm is not smaller than the ${countersink.headDiameterMm} mm countersink head, so there is no cone to cut.`
      );
    }
    pocket = {
      shape: "cone",
      style: "countersink",
      fromFace: spec.fromFace,
      // At the face the cone is the head diameter; at `depthMm` below it, the pilot.
      topDiameterMm: countersink.headDiameterMm,
      bottomDiameterMm: pilotDiameterMm,
      includedAngleDeg: countersink.includedAngleDeg,
      depthMm
    };
    provenance.push({
      dimension: "countersink",
      // ISO 7046 is the metric 90-degree series the table publishes. ISO 10642
      // flat socket head is a different and larger series and is deliberately
      // absent from the table, so it cannot be resolved from here.
      source: `ISO 7046, ${countersink.includedAngleDeg} degrees included`,
      confidence: "verified"
    });
  }

  if (spec.style === "nutTrap") {
    const nut = nutTrapMm(spec.size);
    if (!nut) {
      return refuse(spec, HOLE_NO_PUBLISHED_VALUE, `No published nut trap for ${describeRequest(spec)}.`);
    }
    pocket = {
      shape: "hexPrism",
      style: "nutTrap",
      fromFace: spec.fromFace,
      acrossFlatsMm: nut.acrossFlatsMm,
      acrossCornersMm: nut.acrossCornersMm,
      depthMm: nut.thicknessMm
    };
    provenance.push({
      dimension: "nutTrap",
      source: "ISO 4032 across-flats and thickness; across-corners derived exactly",
      confidence: "verified"
    });
  }

  if (spec.style === "heatSetInsert") {
    const insert = heatSetInsertMm(spec.size);
    if (!insert) {
      // The one refusal that matters most. Heat-set inserts are vendor
      // specifications, not a standard, and the table holds only the Ruthex sizes
      // that have been checked against a datasheet. Scaling M2 or M4 to reach
      // M2.5 would produce a bore nobody has published.
      return refuse(
        spec,
        HOLE_NO_PUBLISHED_VALUE,
        `No published heat-set insert bore for ${describeRequest(spec)}. Insert bores are vendor specifications, not a standard, and only the verified sizes are held.`
      );
    }
    pocket = cylinderPocket("heatSetInsert", spec, insert.boreDiameterMm, insert.boreDepthMm);
    provenance.push({
      dimension: "insertBore",
      source: `${insert.vendor} datasheet insert bore`,
      confidence: "verified"
    });
  }

  return {
    ok: true,
    spec,
    pilotDiameterMm,
    pilotRadiusMm: pilotDiameterMm / 2,
    nominalMm: getFastener(spec.size).nominalMm,
    pocket,
    provenance,
    unverifiedDimensions: provenance.filter((entry) => entry.confidence !== "verified").map((entry) => entry.dimension),
    label: describeHole(spec)
  };
}

/** A short human label for a hole spec, for the inspector and status line. */
export function describeHole(hole) {
  const spec = normalizeHoleSpec(hole);
  if (!spec) return null;
  const style = spec.style === "through" ? "through hole" : spec.style;
  const suffix = HOLE_POCKET_STYLES.includes(spec.style) ? ` from ${spec.fromFace}` : "";
  return `${spec.size} ${style}, ${spec.fit} fit${suffix}`;
}

/**
 * The radius a profile should have, given its hole.
 *
 * `null` means "keep whatever radius the profile already has": either there is no
 * hole, or its combination is refused, or the author has unlocked it. Only a
 * resolved, locked hole gets to overwrite an author's number, so a refusal never
 * silently changes geometry.
 */
export function holeDerivedRadiusMm(hole) {
  const resolved = resolveHole(hole);
  if (!resolved?.ok || !resolved.spec.lockSize) return null;
  return resolved.pilotRadiusMm;
}

/** Whether a profile's dimensions must survive a resize untouched. */
export function profileSizeIsLocked(profile) {
  return normalizeHoleSpec(profile?.hole)?.lockSize === true;
}

/** The resolved hole on a profile, or `null` if it carries none. */
export function profileHoleResolution(profile) {
  return resolveHole(profile?.hole);
}

/**
 * Every pocket a sketch's cut profiles ask for, with the profile that asked.
 *
 * Ignores profiles whose hole is refused, because a refused hole produces no
 * geometry at all - not a pocket, and not a changed pilot.
 */
export function sketchHolePockets(sketch) {
  const pockets = [];
  for (const profile of sketch?.cutProfiles ?? []) {
    const resolved = resolveHole(profile?.hole);
    if (!resolved?.ok || !resolved.pocket) continue;
    pockets.push({ profile, resolved, pocket: resolved.pocket });
  }
  return pockets;
}

/** Whether a body's sketch carries any post-extrude pocket. */
export function sketchHasHolePockets(sketch) {
  return sketchHolePockets(sketch).length > 0;
}

/** Cut profiles whose hole names a combination the table cannot resolve. */
export function refusedSketchHoles(sketch) {
  const refused = [];
  for (const profile of sketch?.cutProfiles ?? []) {
    const resolved = resolveHole(profile?.hole);
    if (!resolved || resolved.ok) continue;
    refused.push({ profile, resolved });
  }
  return refused;
}

/**
 * A refused hole, as a compile-result warning.
 *
 * A warning and never a `validateBody` issue, for the reason `AGENTS.md` states:
 * `validateBody` refuses to compile a body whose issue list is non-empty at any
 * severity, so routing this through it would make an unresolvable size code block
 * the preview, the handoff and every export - including the DXF of the perfectly
 * good pilot circle the profile still has. The refusal costs the author the
 * *derived* geometry, which they never got, not the geometry they already had.
 */
export function detectRefusedHoles(sketch, options = {}) {
  const refused = refusedSketchHoles(sketch);
  if (!refused.length) return null;
  const named = refused
    .slice(0, 3)
    .map(({ profile, resolved }) => `${profile.id}: ${resolved.reason}`)
    .join(" ");
  return createIssue(
    REFUSED_HOLE_CODE,
    `${refused.length} hole${refused.length === 1 ? "" : "s"} could not be resolved from the fastener table, so ${refused.length === 1 ? "its" : "their"} profile radius is unchanged and no standards geometry was produced. ${named}`,
    options.path ?? "sketch.cutProfiles",
    "warning",
    { holeCount: refused.length, profileIds: refused.map(({ profile }) => profile.id) }
  );
}

/**
 * Pockets deep enough to break through the far face, as a warning.
 *
 * The resulting solid is still closed and still measurable - a pocket that reaches
 * the far face is just a wider through hole - so this is a report about intent
 * rather than a fault. A 5.8 mm insert bore in a 3 mm plate is almost certainly
 * not what the author meant, and saying so is cheaper than letting them measure it.
 */
export function detectHolePocketBreakthrough(body, options = {}) {
  const thicknessMm = Number(body?.extrudeDepthMm);
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) return null;

  const broken = sketchHolePockets(body?.sketch).filter(({ pocket }) => Number(pocket.depthMm) >= thicknessMm);
  if (!broken.length) return null;

  const named = broken
    .slice(0, 3)
    .map(({ profile, pocket }) => `${profile.id} (${pocket.style}, ${pocket.depthMm} mm)`)
    .join(", ");
  return createIssue(
    POCKET_BREAKTHROUGH_CODE,
    `${broken.length} hole pocket${broken.length === 1 ? " is" : "s are"} at least as deep as the ${thicknessMm} mm thickness, so ${broken.length === 1 ? "it opens" : "they open"} through the far face instead of staying blind: ${named}.`,
    options.path ?? "sketch.cutProfiles",
    "warning",
    { pocketCount: broken.length, profileIds: broken.map(({ profile }) => profile.id) }
  );
}
