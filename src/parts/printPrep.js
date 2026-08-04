/**
 * Print preparation: how to make the part, for someone who did not draw it.
 *
 * ## It consumes manufacturability; it does not re-derive it
 *
 * `validateManufacturability` already returns findings with a severity, a substrate and
 * the measurements behind them, and every threshold it used is a field on a `process.js`
 * profile. Deriving "this needs supports" a second time here would put the overhang limit
 * in two places, and the second copy would be the one nobody re-baselines when a printer
 * profile changes. So the support answer is **read from the findings**, by code, and the
 * test asserts the two agree by comparing them rather than by pinning a string - a pinned
 * string passes on a tree where they have diverged.
 *
 * Anything print prep needs that DFM does not report is either a DFM gap - raise it, do
 * not patch it here - or genuinely orientation-specific, which is the one thing DFM does
 * not model.
 *
 * ## Orientation is a recommendation, not a persisted field
 *
 * `bedFace` is a **process profile** field: `null` for FDM's default and `"bottom"`
 * elsewhere. It is not per body, and a part printed at an angle is not expressible in this
 * project. Making it per body would be a new persisted field and a new normalizer entry,
 * with a round-trip test in the same commit - so this module derives a recommendation from
 * the geometry the project already holds and says what it is based on, rather than
 * inventing a place to store an orientation nobody can set.
 *
 * ## Print time is out of scope, and not as an empty cell
 *
 * A time estimate needs a slicer: layer height, infill, perimeters, speeds and
 * acceleration limits, none of which this project holds. There is deliberately **no time
 * field at all** here, absent or otherwise. A row whose only content is a refusal is not a
 * row - it is a promise the page cannot keep, rendered.
 *
 * ## DOM-free
 *
 * Returns data. The page appends it.
 */

import {
  DFM_BRIDGE_SPAN,
  DFM_POCKET_UNSUPPORTED,
  DFM_SOURCE_KIND_UNCHECKED,
  DFM_STOCK_THICKNESS,
  DFM_STOCK_NOT_STOCKED,
  DFM_UNSUPPORTED_OVERHANG,
  bodyProcessId,
  validateManufacturability
} from "./dfm.js";
import { SKETCH_EXTRUDE_KIND } from "./contracts.js";
import { getProcessProfile } from "./process.js";
import { normalizeMaterialId, stockThicknessesMm } from "./materials.js";
import { sketchHolePockets } from "./holes.js";

/**
 * The findings that mean "this will not print without help".
 *
 * Named as a list rather than tested one at a time so the set is visible, and so a rule
 * added to `dfm.js` that belongs here is a one-line change in one place. Support is about
 * material printed over air: an overhang, a bridge, and a pocket the process cannot make
 * blind.
 */
export const SUPPORT_FINDING_CODES = Object.freeze([
  DFM_UNSUPPORTED_OVERHANG,
  DFM_BRIDGE_SPAN,
  DFM_POCKET_UNSUPPORTED
]);

/** The findings that are about stock rather than about geometry. */
export const STOCK_FINDING_CODES = Object.freeze([DFM_STOCK_THICKNESS, DFM_STOCK_NOT_STOCKED]);

/** Processes whose input is a sheet of a stocked thickness rather than a spool. */
const SHEET_PROCESSES = Object.freeze(["laser", "cnc"]);

/**
 * Whether this body's thickness is a thickness you can buy.
 *
 * `materials.stockThicknessesMm` is the authority and returns `null` for a material that
 * does not come in sheets - which is a different answer from "no thickness matches", and
 * the two must not collapse into one. `matches: null` means the question does not apply.
 */
function stockMatch(body, processId) {
  const materialId = normalizeMaterialId(body?.materialId);
  const thicknessMm = Number(body?.extrudeDepthMm);
  const stocked = stockThicknessesMm(materialId);

  if (!SHEET_PROCESSES.includes(processId)) {
    return {
      thicknessMm: Number.isFinite(thicknessMm) ? thicknessMm : null,
      stockThicknessesMm: stocked,
      matches: null,
      reason: "This process builds the thickness rather than buying it, so no stock thickness applies."
    };
  }
  if (!stocked?.length) {
    return {
      thicknessMm: Number.isFinite(thicknessMm) ? thicknessMm : null,
      stockThicknessesMm: null,
      matches: null,
      reason: "No sheet thicknesses are published for this material, so this cannot be checked."
    };
  }
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    return { thicknessMm: null, stockThicknessesMm: stocked, matches: null, reason: "This body has no usable thickness." };
  }

  const nearest = stocked.reduce(
    (best, value) => (Math.abs(value - thicknessMm) < Math.abs(best - thicknessMm) ? value : best),
    stocked[0]
  );
  const matches = Math.abs(nearest - thicknessMm) < 1e-9;
  return {
    thicknessMm,
    stockThicknessesMm: stocked,
    nearestStockMm: nearest,
    matches,
    reason: matches
      ? null
      : `${thicknessMm} mm is not a stocked thickness for this material. The nearest is ${nearest} mm; `
        + "cutting it from something else means machining the face, which is a different job."
  };
}

/**
 * A recommended orientation, derived rather than stored.
 *
 * The recommendation is the one the page's own geometry already implies: a sketch body is
 * a plate and prints flat, because that is the orientation `orientSolidToPartPlane`
 * produces and the one every pocket depth in the project was authored against. What makes
 * this a recommendation rather than a statement is that a user who prints it on edge has
 * neither an overhang nor a bridge - and `bedFace` is the process-profile field that says
 * so, which they can clear.
 */
function orientationRecommendation(body, processProfile, pockets) {
  const kind = body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
  if (!processProfile?.additive) {
    return {
      recommendation: null,
      why: "This process cuts from stock, so there is no build orientation to choose."
    };
  }
  if (kind !== SKETCH_EXTRUDE_KIND) {
    return {
      recommendation: "Not derived for this body kind.",
      why:
        `A ${kind} body has no sketch plane, so the page has no basis for an orientation `
        + "recommendation and does not guess one."
    };
  }
  const fromBed = pockets.filter((entry) => entry.pocket.fromFace === (processProfile.bedFace ?? "bottom"));
  if (fromBed.length) {
    return {
      recommendation: "Flip the part, or accept supports.",
      why:
        `${fromBed.length} pocket${fromBed.length === 1 ? "" : "s"} are cut from the `
        + `${processProfile.bedFace ?? "bottom"} face, which is the face on the bed, so their roofs print over air. `
        + "Printing the other way up puts them on top."
    };
  }
  return {
    recommendation: "Sketch plane flat on the bed.",
    why: "This is the orientation the part was drawn in, and no pocket is cut from the bed face."
  };
}

/**
 * Print preparation for one body.
 *
 * `options` is passed straight through to `validateManufacturability`, so a caller stating
 * a printer whose bridging differs from the default gets a support answer against that
 * printer rather than against the default one.
 */
export function bodyPrintPrep(body, options = {}) {
  const processId = bodyProcessId(body);
  const processProfile = getProcessProfile(processId);
  const findings = validateManufacturability(body, options);
  const pockets = sketchHolePockets(body?.sketch);

  // Read, not re-derived. See the module comment.
  const supportFindings = findings.filter((finding) => SUPPORT_FINDING_CODES.includes(finding.code));
  const stockFindings = findings.filter((finding) => STOCK_FINDING_CODES.includes(finding.code));
  const unchecked = findings.find((finding) => finding.code === DFM_SOURCE_KIND_UNCHECKED) ?? null;

  return {
    bodyId: body?.id ?? null,
    name: body?.name ?? null,
    processId,
    processLabel: processProfile?.label ?? processId,
    additive: processProfile?.additive === true,
    bedFace: processProfile?.bedFace ?? null,
    supports: {
      required: supportFindings.length > 0,
      // Carried whole rather than reduced to a sentence, so the panel can show the same
      // measurement the Manufacturability card shows and the two cannot disagree.
      findings: supportFindings.map((finding) => ({ code: finding.code, severity: finding.severity, message: finding.message })),
      summary: supportFindings.length
        ? `${supportFindings.length} finding${supportFindings.length === 1 ? "" : "s"} describe material printed over air.`
        : "Nothing in this body prints over air at this process's limits."
    },
    stock: { ...stockMatch(body, processId), findings: stockFindings.map((finding) => ({ code: finding.code, message: finding.message })) },
    orientation: orientationRecommendation(body, processProfile, pockets),
    // Stated rather than silently absent: a body whose sketch rules did not run has a
    // print-prep answer that is narrower than it looks, and the reader should know which.
    uncheckedNote: unchecked?.message ?? null
  };
}

/** Print preparation for every body in a project, in project order. */
export function projectPrintPrep(project, options = {}) {
  return (project?.bodies ?? []).map((body) => bodyPrintPrep(body, { ...options, path: `bodies.${body.id}` }));
}
