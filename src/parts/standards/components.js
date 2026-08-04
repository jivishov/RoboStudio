/**
 * Off-the-shelf component reference data. All dimensions in millimetres.
 *
 * ## Why this sits beside `fasteners.js` rather than inside `hardware.js`
 *
 * `fasteners.js` holds numbers quoted from ISO and DIN and `holes.js` holds the
 * resolution that consumes them, and the split is what makes the refusal rule
 * checkable: a reviewer can read one file and ask only "is this number published?"
 * without reading any logic. A NEMA 17 bolt square and a 608 outer diameter are the
 * same kind of number - somebody else published them and this page quotes them - so
 * they get the same treatment. `hardware.js` authors none of them.
 *
 * ## Two things this file publishes
 *
 * `COMPONENTS` holds what is sourced. Every dimension carries a `source` string
 * detailed enough to re-check and a `confidence` on the same two-value scale
 * `holes.js` uses through `provenance`, and a dimension marked `unverified`
 * additionally carries a `note` saying what is unverified about it.
 *
 * `UNSOURCED_COMPONENTS` holds what is **not** sourced, and it is data rather than
 * an omission on purpose. The meta plan flags MG996R mounting hole diameters, N20
 * and 28BYJ-48 pilot bosses, GT2 tooth arcs and DIN 471 circlip grooves as
 * directionally correct but unverified. Each was looked for and each failed the same
 * way - the figures in circulation disagree with one another and no manufacturer
 * drawing settles them - so no catalogue entry exists for any of them. Recording
 * that here lets `hardware.js` refuse a request for one **by name, with the reason**,
 * instead of answering "no such entry" and leaving the next author to rediscover
 * why. An absent entry with no explanation is an invitation to guess.
 *
 * ## Clearance over a nominal diameter is a fit class, and it is quoted
 *
 * A 22.0 mm bore does not accept a 22.0 mm boss, so a seat has to differ from the
 * component it holds - and by how much is a **fit class**, which is
 * `standards/fits.js` and which this file must not invent. Cycle 08 shipped one named
 * `LOCATING_CLEARANCE_MM = 0.2` here, flagged `unverified`, with a note saying it was
 * shop practice and that cycle 09 would replace it. **It has been replaced and it no
 * longer exists**: each locating feature below names an ISO 286 class instead, and
 * `locatingBoreMm` reads its limits from `fits.js`. There is deliberately not a second
 * clearance mechanism sitting beside the first - the old constant was 0.1 mm of radial
 * room chosen by feel, where H7 on a 22 mm nominal is 0 to 0.021 mm, so keeping both
 * would have meant two answers to one question that differ by an order of magnitude.
 *
 * A `locatingFit` entry carries the class **and its own source and confidence**,
 * separately from the class's limits. The distinction is the point: ISO 286-2 publishes
 * what H7 means, and whether H7 is the right class for a particular feature is a
 * design decision that some components settle and others do not. A NEMA 17 pilot boss
 * is the second kind - NEMA ICS 16-2001 dimensions the boss and does not tolerance it -
 * so that entry ships `unverified` with a note, through the same channel as the
 * DIN 974-1 counterbore.
 *
 * Every accessor returns null for a component this table does not hold. Do not
 * interpolate and do not average two sources that disagree: that is precisely the
 * case `UNSOURCED_COMPONENTS` exists to record.
 *
 * The module is DOM-free and JSCAD-free.
 */

import { fitBoreMm, getFitClass } from "./fits.js";

export const COMPONENT_CONFIDENCES = Object.freeze(["verified", "unverified"]);

/**
 * Sourced components.
 *
 * `dimensions` maps a name to `{ valueMm, source, confidence, note? }`. The shape is
 * flat on purpose: a test walks every dimension of every component and asserts the
 * provenance rules hold, and a nested shape would let a dimension hide from it.
 *
 * `locatingFits` maps a dimension name to the ISO 286 class a bore over it should use,
 * with the source and confidence of **that choice**. A dimension with no entry has no
 * locating bore, which is a refusal rather than a default: guessing H7 for an
 * unconsidered feature is the mistake the retired locating allowance made in a
 * different costume.
 */
const COMPONENTS = Object.freeze({
  nema17: Object.freeze({
    id: "nema17",
    label: "NEMA 17 stepper motor",
    kind: "motor",
    /** The fastener the mounting holes take, resolved through `fasteners.js`. */
    fastenerSize: "M3",
    dimensions: Object.freeze({
      // NEMA ICS 16-2001 is an inch-dimensioned standard, so each figure below
      // records the inch value it converts from. A reviewer can re-check the
      // conversion without the standard in hand, and can re-check the standard
      // with the inch value.
      frameWidthMm: Object.freeze({
        valueMm: 42.3,
        source: "NEMA ICS 16-2001, frame dimension BD, 1.7 in nominal",
        confidence: "verified"
      }),
      boltSpacingMm: Object.freeze({
        valueMm: 31.0,
        source: "NEMA ICS 16-2001, mounting hole pair, 1.220 in square",
        confidence: "verified"
      }),
      pilotDiameterMm: Object.freeze({
        // 0.8661 in x 25.4 = 22.0 mm exactly, which is why the standard's odd-looking
        // inch figure is the right thing to quote rather than the round metric one.
        valueMm: 22.0,
        source: "NEMA ICS 16-2001, pilot dimension N, 0.8661 in",
        confidence: "verified"
      }),
      pilotDepthMm: Object.freeze({
        valueMm: 0.76,
        source: "NEMA ICS 16-2001, pilot depth T, 0.03 in minimum",
        confidence: "verified"
      }),
      motorHoleDiameterMm: Object.freeze({
        // The hole in the motor's own face, not in the plate this page draws. It is
        // here so a reader can see that an M3 screw is what the standard intends.
        valueMm: 3.81,
        source: "NEMA ICS 16-2001, mounting hole dimension S, 0.150 +/- 0.010 in",
        confidence: "verified"
      })
    }),
    locatingFits: Object.freeze({
      pilotDiameterMm: Object.freeze({
        fitClass: "H7/h6",
        source: "H7 over the pilot boss, as the generic ISO 286 locational clearance for a spigot that locates a face",
        confidence: "unverified",
        note:
          "The H7 limits are ISO 286-2 and are not in question. What is unverified is the class: NEMA ICS 16-2001 "
          + "dimensions the pilot boss at 0.8661 in and does not tolerance it, so pairing it with h6 to get a "
          + "locational clearance is a design choice rather than a published fit. A motor whose boss runs oversize "
          + "will not enter an H7 bore, and the recourse is a looser class, not a bigger number typed here."
      })
    })
  }),
  bearing608: Object.freeze({
    id: "bearing608",
    label: "608 deep groove ball bearing",
    kind: "bearing",
    fastenerSize: null,
    dimensions: Object.freeze({
      boreDiameterMm: Object.freeze({
        valueMm: 8.0,
        source: "ISO 15 / ISO 15:2017 boundary dimensions, 608 designation, bore code 08",
        confidence: "verified"
      }),
      outerDiameterMm: Object.freeze({
        valueMm: 22.0,
        source: "ISO 15 / ISO 15:2017 boundary dimensions, 608 designation",
        confidence: "verified"
      }),
      widthMm: Object.freeze({
        valueMm: 7.0,
        source: "ISO 15 / ISO 15:2017 boundary dimensions, 608 designation",
        confidence: "verified"
      })
    }),
    locatingFits: Object.freeze({
      outerDiameterMm: Object.freeze({
        // H7 rather than N7, and the choice is worth stating. N7 is what a rolling
        // bearing wants when the outer ring carries a rotating load and would
        // otherwise creep in its seat; H7 is the recommendation for a stationary
        // outer ring under normal load, which is what a 608 in a printed or
        // machined bearing block is doing. `fits.js` holds N7/h6 as well, so the
        // heavier case is a class change and not a table change.
        fitClass: "H7/h6",
        source:
          "H7 housing bore, the ISO 286 recommendation for a rolling-bearing outer ring that does not rotate in its "
          + "seat under normal load",
        confidence: "verified"
      })
    })
  })
});

/**
 * Components deliberately absent, with the reason.
 *
 * Each of these was flagged by the meta plan as directionally correct but
 * unverified, was looked for, and failed. The `reason` is what `hardware.js` quotes
 * when a caller names one, and it is written for the next author rather than for a
 * log: it says what disagrees with what, so somebody with a real drawing can close
 * the gap instead of re-running the same dead search.
 */
const UNSOURCED_COMPONENTS = Object.freeze({
  mg996r: Object.freeze({
    id: "mg996r",
    label: "MG996R servo",
    reason:
      "The MG996R mounting hole diameter and spacing are not settled by any manufacturer drawing: the figures in "
      + "circulation disagree with one another, quoting mounting hole spacings that differ by more than a factor of "
      + "three, and the TowerPro sheet the clones copy does not dimension the flange holes at all. Averaging them "
      + "would publish a pattern no servo has."
  }),
  servoHorn: Object.freeze({
    id: "servoHorn",
    label: "Servo horn spline",
    reason:
      "A servo horn bolts to a splined output shaft - 25T for the MG996R class - and the spline pitch, major "
      + "diameter and horn screw pattern are vendor art rather than a standard. There is no published series to "
      + "quote, so there is no generic servo horn pattern to resolve."
  }),
  n20: Object.freeze({
    id: "n20",
    label: "N20 micro metal gearmotor",
    reason:
      "N20 is a form factor rather than a specification. The gearbox face pattern and pilot boss differ between "
      + "suppliers of the same nominal motor, and no drawing covering the form factor as a whole exists to quote."
  }),
  stepper28byj48: Object.freeze({
    id: "stepper28byj48",
    label: "28BYJ-48 geared stepper",
    reason:
      "The 28BYJ-48 casing and mounting dimensions are explicitly manufacturer dependent, and the mounting hole "
      + "spacings published for it disagree outright. There is no single pattern to resolve."
  }),
  gt2Belt: Object.freeze({
    id: "gt2Belt",
    label: "GT2 belt and pulley tooth profile",
    reason:
      "GT2's 2.0 mm pitch and 0.254 mm pitch line differential are solid, but the curvilinear tooth arc radii that "
      + "make a GT2 pulley a GT2 pulley are not published in a form this page can quote. A trapezoid drawn at GT2 "
      + "pitch is a T2 pulley wearing the wrong name."
  }),
  din471Circlip: Object.freeze({
    id: "din471Circlip",
    label: "DIN 471 circlip groove",
    reason:
      "The DIN 471 groove diameter, width and corner radius for an 8 mm shaft have not been checked against the "
      + "standard. A circlip groove that is a little too shallow releases under load, so this is not a dimension to "
      + "ship directionally."
  })
});

export const COMPONENT_IDS = Object.freeze(Object.keys(COMPONENTS));
export const UNSOURCED_COMPONENT_IDS = Object.freeze(Object.keys(UNSOURCED_COMPONENTS));

export function isComponentId(id) {
  return Object.prototype.hasOwnProperty.call(COMPONENTS, id);
}

export function getComponent(id) {
  return COMPONENTS[id] ?? null;
}

/** The recorded reason a flagged component is absent, or null if it is not one. */
export function unsourcedComponentReason(id) {
  return UNSOURCED_COMPONENTS[id]?.reason ?? null;
}

/**
 * One dimension of one component, with its provenance, or null.
 *
 * Returns the whole record rather than the number because a caller that publishes
 * the number owes the reader the source: `hardware.js` copies these straight into
 * its resolution `provenance`, so there is no path by which a dimension reaches a
 * profile without the sentence that justifies it.
 */
export function componentDimension(id, name) {
  const dimension = getComponent(id)?.dimensions?.[name];
  return dimension ? { dimension: name, ...dimension } : null;
}

export function componentDimensionMm(id, name) {
  return componentDimension(id, name)?.valueMm ?? null;
}

/** Every dimension record of a component, for a provenance walk. */
export function componentDimensions(id) {
  const component = getComponent(id);
  if (!component) return [];
  return Object.keys(component.dimensions).map((name) => componentDimension(id, name));
}

/** The ISO 286 class a bore over this dimension should use, or null. */
export function locatingFitClass(id, dimensionName) {
  const entry = getComponent(id)?.locatingFits?.[dimensionName];
  return entry ? { dimension: dimensionName, ...entry } : null;
}

/**
 * A bore that locates on a nominal outside diameter, with its provenance.
 *
 * Still **two** provenance entries and not one, and for the same reason cycle 08 gave:
 * the nominal comes from the component's own standard and the fit comes from ISO 286,
 * and collapsing them would cite one document for a number the other contains. What
 * changed is that the second entry is now a quoted tolerance class rather than a
 * hand-fit allowance, so the entry that used to read "0.2 mm over the nominal, shop
 * practice" reads "H7 limits, ISO 286-2" - and where the *choice* of class is itself
 * unverified, that entry says so and carries the note.
 *
 * `diameterMm` is the diameter to draw, which is the middle of the class's own two
 * limits; `minMm` and `maxMm` are the limits it came from, so a caller can state the
 * band rather than only the midpoint. Null when the component, the dimension, or the
 * fit is not held - including when the nominal falls outside every published size
 * band, which refuses rather than scaling the nearest one.
 */
export function locatingBoreMm(id, dimensionName) {
  const nominal = componentDimension(id, dimensionName);
  if (!nominal) return null;
  const fit = locatingFitClass(id, dimensionName);
  if (!fit) return null;
  const bore = fitBoreMm(fit.fitClass, nominal.valueMm);
  if (!bore) return null;

  const classEntry = getFitClass(fit.fitClass);
  const fitProvenance = {
    dimension: `${dimensionName}Fit`,
    source: `${bore.provenance[0].source}; ${fit.source}`,
    confidence: fit.confidence
  };
  if (fit.confidence !== "verified") fitProvenance.note = fit.note;

  return {
    diameterMm: bore.drawnDiameterMm,
    nominalMm: nominal.valueMm,
    minMm: bore.minMm,
    maxMm: bore.maxMm,
    toleranceMm: bore.toleranceMm,
    fitClass: fit.fitClass,
    holeGrade: bore.holeGrade,
    fitLabel: classEntry?.label ?? fit.fitClass,
    provenance: [
      { dimension: `${dimensionName}Nominal`, source: nominal.source, confidence: nominal.confidence },
      fitProvenance
    ]
  };
}
