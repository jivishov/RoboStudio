/**
 * Manufacturing process profiles: the thresholds a DFM rule reads, and the two
 * numbers that say how far the part will differ from the drawing.
 *
 * ## Why the numbers live here and not in the rules
 *
 * A minimum wall is not a property of geometry. It is a property of the machine
 * that has to make the geometry, and it moves: 1.2 mm is a sane floor for a
 * 0.4 mm nozzle and meaningless for a router. `src/parts/dfm.js` therefore owns
 * no numbers at all. Every rule reads a field from a profile, so raising a
 * threshold is a data change and never a code change - which is the property the
 * cycle-06 plan asks to be demonstrated by a test.
 *
 * The meta plan names one of these explicitly: **the FDM bridge limit is printer
 * and cooling dependent and must be a profile parameter, never a constant.** It is
 * `maxBridgeSpanMm`, and `resolveProcessProfile` accepts overrides so a caller who
 * knows their printer can say so. Every other threshold is treated the same way by
 * default; the three that are deliberately universal are marked in the table below.
 *
 * ## Thickness-relative thresholds
 *
 * Two limits are not absolute. A laser's practical minimum wall and minimum hole
 * are both roughly the stock thickness, because the kerf is a slot with a taper
 * and a heat-affected zone on both sides - a 1 mm web in 6 mm ply burns away. So
 * `minWallMm` and `minFeatureMm` each have a companion `*ThicknessFactor`, and the
 * effective limit is the larger of the absolute floor and the thickness multiple.
 * A factor of `0` makes the limit purely absolute, which is what FDM wants.
 *
 * ## Printer compensation: two parameters, one signed number
 *
 * A 1.2 mm web cut on a laser is thinner than 1.2 mm, and a 3.4 mm hole printed on
 * an FDM machine is narrower than 3.4 mm. Both are the same geometric statement -
 * the boundary between material and air does not land where the drawing put it -
 * and `processCompensationMm` reduces them to one signed radial figure that
 * `cadCompile.js` applies in exactly one place.
 *
 * Two fields rather than one, because they are different phenomena with names a
 * user recognises, and both are stated as the **total width** a datasheet quotes:
 *
 * - `kerfWidthMm` - the width of material a subtractive cut consumes, centred on
 *   the programmed contour. Half of it comes off each side, so the finished region
 *   retreats by `kerf / 2`.
 * - `depositionOversizeMm` - how much wider than nominal an additive process lays
 *   its perimeter, measured across the wall. The finished region advances by half
 *   of it, which is why a printed hole comes out undersize.
 *
 * `null` on both means **this process compensates for nothing**, and that is not
 * the same statement as zero. CNC is the null case and means it honestly: a cutter
 * is offset by its own radius in CAM so the finished contour is the programmed one,
 * and there is nothing here for this page to pre-empt. Zero would claim the page
 * had measured the difference and found none.
 *
 * That distinction is load-bearing rather than pedantic, and it has already shipped
 * broken once. Cycle 06 guarded `maxStockThicknessMm` with a bare `Number.isFinite`,
 * `Number(null)` read as `0`, FDM's absent ceiling became a 0 mm ceiling, and
 * `dfm-stock-thickness` fired on all twenty templates. Compensation has the same
 * shape and is worse: **compensating by zero looks exactly like not compensating**,
 * so the same mistake here produces no visible symptom at all. Hence
 * `compensationTermMm` below, and hence `resolveProcessProfile` rejecting a
 * compensation override that is neither null nor a finite non-negative number
 * instead of coercing it.
 *
 * ## Confidence
 *
 * These are shop practice, not published standards, and are labelled as such
 * through `note`. They differ in kind from `standards/fasteners.js`, whose numbers
 * are quoted from ISO and DIN and are never interpolated, and from
 * `standards/fits.js`, whose tolerance bands are read off ISO 286-2. A DFM
 * threshold and a kerf width are defaults a user is expected to measure on their
 * own machine and change; a clearance hole diameter and an H7 limit are not.
 *
 * The module is DOM-free and JSCAD-free.
 */

export const PROCESS_FDM = "fdm";
export const PROCESS_LASER = "laser";
export const PROCESS_CNC = "cnc";

export const PROCESS_IDS = Object.freeze([PROCESS_FDM, PROCESS_LASER, PROCESS_CNC]);
export const DEFAULT_PROCESS_ID = PROCESS_FDM;

/**
 * Every numeric or boolean threshold a rule may read.
 *
 * Exported so `dfm.test.js` can assert that a rule reads a *registered* field
 * rather than one it invented, and so `resolveProcessProfile` can reject an
 * override that names nothing.
 */
export const PROCESS_PROFILE_FIELDS = Object.freeze([
  "minWallMm",
  "minWallThicknessFactor",
  "minFeatureMm",
  "minFeatureThicknessFactor",
  "minInternalCornerRadiusMm",
  "pocketsSupported",
  "minWebUnderPocketMm",
  "maxBridgeSpanMm",
  "maxOverhangAngleDeg",
  "holeEdgeDistanceFactor",
  "maxHoleDepthRatio",
  "minThreadEngagementDiameters",
  "minStockThicknessMm",
  "maxStockThicknessMm",
  "bedFace",
  "kerfWidthMm",
  "depositionOversizeMm"
]);

/**
 * The compensation fields, which is the subset `resolveProcessProfile` validates.
 *
 * Registered separately from `PROCESS_PROFILE_FIELDS` rather than detected by name,
 * so adding a third compensation parameter is a deliberate two-line edit and a
 * field called `kerfNoteMm` cannot be swept into the numeric validation by accident.
 */
export const PROCESS_COMPENSATION_FIELDS = Object.freeze(["kerfWidthMm", "depositionOversizeMm"]);

function profile(entry) {
  return Object.freeze({
    // A null limit means "this process has no such limit", which is different from
    // zero. A rule that reads null skips rather than comparing against nothing.
    maxBridgeSpanMm: null,
    maxOverhangAngleDeg: null,
    maxHoleDepthRatio: null,
    maxStockThicknessMm: null,
    bedFace: null,
    // Absent by default for the same reason as the limits above: a process that has
    // not been measured compensates for nothing, which is a different claim from
    // compensating by nothing.
    kerfWidthMm: null,
    depositionOversizeMm: null,
    minWallThicknessFactor: 0,
    minFeatureThicknessFactor: 0,
    pocketsSupported: true,
    ...entry
  });
}

export const PROCESS_PROFILES = Object.freeze([
  profile({
    id: PROCESS_FDM,
    label: "FDM 3D printing",
    additive: true,
    // The part lies with its sketch plane on the bed and +Y up, which is how a
    // plate is printed and what `orientSolidToPartPlane` already produces. A pocket
    // cut from this face therefore prints over air. Stated as a parameter rather
    // than assumed, because a user who prints the part on edge has neither an
    // overhang nor a bridge and can say so by clearing it.
    bedFace: "bottom",
    // Matches `materials.js` FDM_DEFAULT_PROFILE: three perimeters of a 0.4 mm
    // nozzle. Per-material FDM profiles there override it through `options`.
    minWallMm: 1.2,
    minFeatureMm: 0.8,
    // A nozzle leaves a corner radius of roughly its own radius, which is below
    // anything a designer would draw, so this limit is inert for FDM by design.
    minInternalCornerRadiusMm: 0,
    minWebUnderPocketMm: 0.8,
    // Printer and cooling dependent, named as such in the meta plan.
    //
    // It bounds the **unsupported horizontal run** a flat roof may make over air.
    // The roof of a pocket cut from the bed face is an annular ledge anchored on
    // the pocket wall with a pilot hole in the middle, and a hole supports
    // nothing, so the run is half the difference between the two diameters. 2 mm
    // is a cantilever figure for an open-frame printer with a part-cooling fan -
    // lower than the 10-or-more a bridge anchored at both ends manages, because
    // this material is held at one edge only.
    maxBridgeSpanMm: 2,
    // Measured from vertical: 45 degrees is the usual unsupported limit, and a
    // 90-degree-included countersink cut from the bed face sits exactly on it.
    maxOverhangAngleDeg: 45,
    holeEdgeDistanceFactor: 1,
    // Tapping printed plastic strips easily, so more engagement is wanted than a
    // machinist would ask for in metal.
    minThreadEngagementDiameters: 2,
    minStockThicknessMm: 0.4,
    // A nozzle lays a bead slightly wider than it is told to, and the wall ends up
    // fatter than the drawing on both sides - which is why a printed hole gauges
    // undersize and a printed boss gauges over. 0.16 mm across the wall is a
    // typical figure for a well-tuned 0.4 mm nozzle, so a 3.4 mm hole prints at
    // about 3.32. Measure it on the machine and change it: it moves with material,
    // flow calibration and temperature, and this default is a starting point.
    depositionOversizeMm: 0.16,
    note: "Shop practice for a 0.4 mm nozzle. The bridge limit is printer and cooling dependent and the deposition oversize is printer and material dependent; change them rather than trusting them."
  }),
  profile({
    id: PROCESS_LASER,
    label: "Laser cutting",
    additive: false,
    minWallMm: 0.8,
    // The kerf is a tapered slot with a heat-affected zone on both sides, so a web
    // narrower than the stock is thickness burns through.
    minWallThicknessFactor: 1,
    minFeatureMm: 0.5,
    minFeatureThicknessFactor: 1,
    // A laser makes a genuinely sharp internal corner. Universal for this process
    // rather than a parameter, because there is no tool radius to change.
    minInternalCornerRadiusMm: 0,
    // A laser cuts through or not at all. There is no depth control, so a blind
    // pocket is not a tight tolerance here - it is not a feature this process has.
    pocketsSupported: false,
    minWebUnderPocketMm: 0,
    // Heat softens the material around the cut, so a fastener wants more edge than
    // the fastener table's practice figure.
    holeEdgeDistanceFactor: 1.5,
    minThreadEngagementDiameters: 1,
    minStockThicknessMm: 0.5,
    maxStockThicknessMm: 12,
    // The beam removes a slot of its own width centred on the contour, so half of
    // it comes out of the part and half out of the offcut: every hole gauges 0.15 mm
    // over and every web 0.15 mm under. This is cycle 06's own closing limit - "a
    // laser removes half its kerf from each side of every cut, so a web this rule
    // calls 1.2 mm is thinner in the part" - now a number rather than a caveat.
    // 0.15 mm is a CO2 figure on thin sheet and moves with power, speed and focus.
    kerfWidthMm: 0.15,
    note: "CO2 practice. Minimum wall and minimum hole both track the stock thickness, and the kerf is machine dependent."
  }),
  profile({
    id: PROCESS_CNC,
    label: "CNC machining",
    additive: false,
    minWallMm: 0.8,
    minFeatureMm: 1,
    // An end mill cannot cut a corner sharper than its own radius; 0.5 mm is a
    // 1 mm cutter, which is the smallest most shops will quote without a surcharge.
    minInternalCornerRadiusMm: 0.5,
    minWebUnderPocketMm: 0.5,
    // A drill runs out and a cutter deflects past roughly six diameters without
    // pecking or an extended holder.
    maxHoleDepthRatio: 6,
    holeEdgeDistanceFactor: 1,
    minThreadEngagementDiameters: 1,
    minStockThicknessMm: 0.5,
    maxStockThicknessMm: 100,
    // Both compensation fields stay null, and that is the answer rather than an
    // omission: CAM offsets the toolpath by the cutter's own radius, so the finished
    // contour is the programmed contour and there is no systematic difference for
    // this page to pre-empt. Writing 0 here would claim somebody had measured a
    // machine and found no difference, which nobody has.
    note: "Three-axis practice. The corner radius is half the smallest routinely stocked end mill. No compensation: CAM offsets the tool, so the cut contour is the drawn contour."
  })
]);

const PROFILES_BY_ID = new Map(PROCESS_PROFILES.map((entry) => [entry.id, entry]));

export function listProcessProfiles() {
  return PROCESS_PROFILES;
}

/** The named profile, or `null` for an id this build does not hold. */
export function getProcessProfile(id) {
  return PROFILES_BY_ID.get(id) ?? null;
}

/**
 * Normalizer for the persisted `PartBody.processId`.
 *
 * An unknown or missing id falls back to the default rather than being kept, for
 * the same reason `normalizeMaterialId` does: a body must always name a process
 * this build holds thresholds for, so no rule ever has to invent one. A project
 * saved by a newer build naming a process this one does not have therefore loads
 * as FDM, which is the documented one-way loss in the meta plan's schema section.
 */
export function normalizeProcessId(value) {
  return PROFILES_BY_ID.has(value) ? value : DEFAULT_PROCESS_ID;
}

export class UnknownProcessProfileFieldError extends Error {
  constructor(field) {
    super(`No process profile field named "${field}". Known fields: ${PROCESS_PROFILE_FIELDS.join(", ")}.`);
    this.name = "UnknownProcessProfileFieldError";
    this.field = field;
  }
}

export class InvalidCompensationValueError extends Error {
  constructor(field, value) {
    super(
      `Process profile field "${field}" must be null or a finite millimetre value of zero or more, not ${JSON.stringify(value)}. `
        + "null means this process compensates for nothing; 0 means it compensates by nothing, and they are different claims."
    );
    this.name = "InvalidCompensationValueError";
    this.field = field;
    this.value = value;
  }
}

/**
 * A compensation parameter as either a number or a declared absence.
 *
 * The whole point of the function. `Number(null)` is `0`, so any guard shaped like
 * `Number.isFinite(Number(value))` turns "this process has no kerf" into "this process
 * has a kerf of zero" - which is cycle 06's shipped `maxStockThicknessMm` defect, and
 * here it would be invisible because compensating by zero and not compensating produce
 * identical geometry.
 *
 * Keeps its own name rather than calling `contracts.js`, and it is the sharpest example
 * in the tree of why one of these helpers is not the others: `asFiniteNumber`
 * substitutes a fallback, `isFiniteNumber` answers yes or no, and `positiveOrZero` below
 * coerces to zero - and every one of those three would turn a declared absence into a
 * measured zero, which is the whole defect. `undefined` is absent for the same reason
 * `null` is; anything else non-numeric is a caller error rather than an absence, and it
 * is not this function's job to decide that quietly - `resolveProcessProfile` throws on
 * it before a profile is built, and this returns `null` only for the two absent values.
 */
export function compensationTermMm(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * How far the material boundary of a finished part sits from the drawn contour, signed.
 *
 * Positive means the part comes out with more material than drawn, so a hole gauges
 * undersize and an outside edge over: additive processes. Negative means material is
 * lost, so a hole gauges over and a web under: subtractive cuts with a kerf. `null`
 * means the process declares no compensation, and a caller must treat that as "apply
 * nothing" rather than as zero, so that a process which genuinely measures zero one
 * day is distinguishable from one that never measured.
 *
 * Both terms are halved because both parameters are stated as the full width a
 * datasheet quotes and the geometry needs the one-sided figure. The halving lives here
 * and nowhere else.
 */
export function processCompensationMm(processProfile) {
  const kerf = compensationTermMm(processProfile?.kerfWidthMm);
  const oversize = compensationTermMm(processProfile?.depositionOversizeMm);
  if (kerf === null && oversize === null) return null;
  return (oversize ?? 0) / 2 - (kerf ?? 0) / 2;
}

/**
 * A sentence stating what a process will do to a drawn dimension, or the absence of one.
 *
 * Lives here rather than in the page so the words and the number come from the same
 * place: a UI that formatted its own sentence could describe a kerf as growing a hole
 * while the geometry shrank it. Returns `null` when the process compensates for
 * nothing, so a caller cannot render "0.000 mm" for an absence (audit A2).
 */
export function describeProcessCompensation(processProfile) {
  const compensationMm = processCompensationMm(processProfile);
  if (compensationMm === null) return null;
  const kerf = compensationTermMm(processProfile?.kerfWidthMm);
  const oversize = compensationTermMm(processProfile?.depositionOversizeMm);
  const terms = [];
  if (kerf !== null) terms.push(`a ${kerf} mm kerf`);
  if (oversize !== null) terms.push(`${oversize} mm of deposition oversize`);

  const magnitude = Math.abs(compensationMm).toFixed(3);
  const direction = compensationMm === 0
    ? "leaves every edge exactly where it is drawn"
    : compensationMm > 0
      ? `leaves ${magnitude} mm more material at every edge, so a hole comes out ${(compensationMm * 2).toFixed(3)} mm narrower than drawn`
      : `takes ${magnitude} mm of material off every edge, so a hole comes out ${(Math.abs(compensationMm) * 2).toFixed(3)} mm wider than drawn`;

  return {
    compensationMm,
    kerfWidthMm: kerf,
    depositionOversizeMm: oversize,
    text: `${terms.join(" and ")} ${direction}.`
  };
}

/**
 * The profile a rule should read, from an id, a profile, or neither.
 *
 * `source` may be a process id, an already-resolved profile object, or `null` for
 * the default. `overrides` is a partial profile merged on top, which is how a
 * caller states a printer whose bridging is better or worse than the default -
 * and how a test changes a threshold without editing a rule.
 *
 * An override naming a field no rule reads **throws**, rather than being merged
 * and silently ignored. A user who mistypes `maxBridgeMm` has said something about
 * their printer that this page would otherwise drop on the floor.
 *
 * A compensation override that is neither `null` nor a finite non-negative number
 * throws too, for a sharper reason: `compensationTermMm` would answer `null` for it,
 * which reads as "this process compensates for nothing" - so a typo'd kerf would
 * silently turn compensation off rather than announce itself. Nothing else about the
 * resulting geometry would look wrong.
 */
export function resolveProcessProfile(source = null, overrides = null) {
  const base = typeof source === "string" || source == null
    ? getProcessProfile(normalizeProcessId(source)) ?? getProcessProfile(DEFAULT_PROCESS_ID)
    : source;

  if (!overrides) return base;
  for (const field of Object.keys(overrides)) {
    if (!PROCESS_PROFILE_FIELDS.includes(field)) throw new UnknownProcessProfileFieldError(field);
    if (!PROCESS_COMPENSATION_FIELDS.includes(field)) continue;
    const value = overrides[field];
    if (value === null) continue;
    if (!Number.isFinite(Number(value)) || Number(value) < 0 || typeof value === "boolean" || value === "") {
      throw new InvalidCompensationValueError(field, value);
    }
  }
  return Object.freeze({ ...base, ...overrides });
}

/**
 * A positive number, or `0`.
 *
 * No shared equivalent, and deliberately so: `asFiniteNumber(value, 0)` would pass a
 * negative through, and the two callers below feed `Math.max` and a multiplication, so a
 * negative factor in a hand-edited profile would quietly *lower* a manufacturing limit.
 * Zero is the identity for both callers - an absent floor and an absent thickness
 * multiple both mean "this profile does not constrain that", which is what the other
 * term of the `Math.max` is for. Distinct from the absent-not-zero contract, which
 * governs numbers that are *reported*; nothing here reaches a cell.
 */
function positiveOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * The minimum wall for this profile at this stock thickness.
 *
 * The larger of the absolute floor and the thickness multiple, so a process with a
 * zero factor is purely absolute and a laser's limit grows with the sheet.
 */
export function effectiveMinWallMm(processProfile, thicknessMm) {
  return Math.max(
    positiveOrZero(processProfile?.minWallMm),
    positiveOrZero(processProfile?.minWallThicknessFactor) * positiveOrZero(thicknessMm)
  );
}

/** The minimum makeable void - hole diameter or slot width - at this thickness. */
export function effectiveMinFeatureMm(processProfile, thicknessMm) {
  return Math.max(
    positiveOrZero(processProfile?.minFeatureMm),
    positiveOrZero(processProfile?.minFeatureThicknessFactor) * positiveOrZero(thicknessMm)
  );
}

/** A short human label for a process id, for the inspector and findings. */
export function describeProcess(id) {
  return getProcessProfile(normalizeProcessId(id))?.label ?? null;
}
