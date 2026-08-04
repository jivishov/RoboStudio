/**
 * Hardware patterns: a named component resolved into the cut profiles that mount it.
 *
 * ## Why this module exists
 *
 * Cycle 05 made a single hole a standard rather than a radius, and the retrofit in
 * `templates.js` made every shipped template use one. That leaves the designer's own
 * geometry: somebody mounting a NEMA 17 on a plate they drew still has to look up a
 * 31 mm bolt square, halve it, remember which fit an M3 clearance is, and type four
 * radii - which is the same arithmetic that shipped 6.4 mm holes for M3 screws in the
 * first place, just relocated from the templates to the user.
 *
 * An entry here names a real thing and yields **cut profiles**, not a body. That is
 * the load-bearing choice: profiles apply to any sketch the user already has, they go
 * through `createCircleProfile` like every other cut, and once appended they are
 * indistinguishable from hand-authored geometry. So there is nothing to persist.
 * `hardware` is not a field on a body or on a profile, no normalizer changes, and
 * landmine two is not in play - a hardware pattern round-trips because the cuts it
 * produced were ordinary cuts before they were ever saved.
 *
 * ## This file authors no numbers
 *
 * Exactly like `holes.js`. Fastener dimensions come from `standards/fasteners.js` via
 * `holes.js`; component dimensions come from `standards/components.js`. What is left
 * here is placement arithmetic - halve a bolt square, walk a bolt circle - and the
 * refusal rule.
 *
 * ## Three refusals, and why each is a refusal rather than a default
 *
 * - **An entry that does not exist.** Including, and this is the interesting case, a
 *   component the meta plan flagged and nobody could source. `standards/components.js`
 *   records MG996R, the servo horn spline, N20, the 28BYJ-48, GT2 and the DIN 471
 *   groove as deliberately absent **with a reason**, and asking for one quotes that
 *   reason. "No such entry" would read as an oversight; the reason says a search
 *   happened and what it found.
 * - **A fastener size the table does not hold.** Delegated wholesale to
 *   `resolveHole`, so a heat-set boss group in M2.5 refuses with the same sentence
 *   the inspector would show for a single M2.5 insert. There is one refusal rule on
 *   this page and this module does not own a second copy of it.
 * - **A placement that is not a number.** A non-finite centre or a count below one
 *   would otherwise produce profiles at NaN, which validate as garbage much later.
 *
 * A refusal produces **no profiles at all**, matching `holes.js`: a partial pattern
 * would be worse than none, because four of six bolt holes look deliberate.
 *
 * ## Fits are not here either, and that stayed true when fits arrived
 *
 * A bearing seat is a fit, and `standards/fits.js` owns fits. Cycle 08 wrote that
 * this module applied the one named locating allowance `components.js` published;
 * cycle 09 replaced that allowance with an ISO 286 class, and **this module did not
 * change**. It still calls `locatingBoreMm` and still authors no number. Which class a
 * 608 housing or a NEMA pilot wants is recorded beside the component's own dimensions,
 * where a reviewer can read the choice and its source without reading any logic - not
 * moved in here to save touching two files. An entry with an `H7` in it would be this
 * module authoring a fit.
 *
 * The module is DOM-free and JSCAD-free.
 */

import { asFiniteNumber, sanitizePartId, uniquePartId } from "./contracts.js";
import { describeHole, resolveHole } from "./holes.js";
import { createCircleProfile } from "./sketch.js";
import {
  componentDimension,
  getComponent,
  locatingBoreMm,
  unsourcedComponentReason
} from "./standards/components.js";

/** Refusal codes. Diagnostics on a resolution result, never `validateBody` issues. */
export const HARDWARE_UNKNOWN_ENTRY = "hardware-unknown-entry";
export const HARDWARE_UNSOURCED_COMPONENT = "hardware-unsourced-component";
export const HARDWARE_UNRESOLVABLE_HOLE = "hardware-unresolvable-hole";
export const HARDWARE_INVALID_PLACEMENT = "hardware-invalid-placement";

/**
 * The picker's grouping vocabulary. A test asserts every entry's category is one of
 * these, which is what keeps the constant load-bearing rather than decorative: a typo
 * would otherwise open a silent new group in the Advanced card with one entry in it.
 */
export const HARDWARE_CATEGORIES = Object.freeze(["Motors", "Motion", "Fasteners"]);

function refuse(entryId, code, reason) {
  return { ok: false, entryId, code, reason, profiles: null, provenance: [] };
}

/**
 * A checked `{ centerX, centerZ }`, or `null`.
 *
 * Vector-shaped, so it has no shared equivalent - and it must stay a refusal rather than
 * a coercion. `normalizeVector` (`contracts.js`) substitutes a fallback per component,
 * which for a placement means a hole silently drilled at the origin. Every caller below
 * turns the `null` into a refusal naming the entry instead.
 */
function finitePlacement(options) {
  const centerX = Number(options.centerX ?? 0);
  const centerZ = Number(options.centerZ ?? 0);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) return null;
  return { centerX, centerZ };
}

/**
 * A cut profile for one fastener hole, or a refusal naming the combination.
 *
 * No `radius` is passed, deliberately. `createCircleProfile` derives it from the
 * resolved hole, and passing `resolved.pilotRadiusMm` alongside would be a second copy
 * of the same number - the exact shape of the defect this cycle removed from the
 * templates. The resolution above is checked first, so the fallback radius branch is
 * unreachable from here rather than merely unused.
 */
function fastenerCut(entryId, id, x, z, hole, existingIds) {
  const resolved = resolveHole(hole);
  if (!resolved) {
    return { error: refuse(entryId, HARDWARE_UNRESOLVABLE_HOLE, "A fastener hole needs a size.") };
  }
  if (!resolved.ok) {
    return { error: refuse(entryId, HARDWARE_UNRESOLVABLE_HOLE, resolved.reason) };
  }
  const profile = createCircleProfile({
    id: uniquePartId(sanitizePartId(id, "hardware_hole"), existingIds, "hardware_hole"),
    x,
    z,
    hole
  });
  existingIds.add(profile.id);
  return { profile, resolved };
}

/** A plain circular cut for a component seat. Not a fastener, so it carries no hole. */
function seatCut(id, x, z, diameterMm, existingIds) {
  const profile = createCircleProfile({
    id: uniquePartId(sanitizePartId(id, "seat"), existingIds, "seat"),
    x,
    z,
    radius: diameterMm / 2
  });
  existingIds.add(profile.id);
  return profile;
}

/**
 * The four holes of a square bolt pattern, centred on the placement.
 *
 * `spacingMm` is the full centre-to-centre span, because that is the number every
 * datasheet prints. Halving it is this function's whole job and the reason no entry
 * below writes a 15.5.
 */
function squareBoltPattern(entryId, idPrefix, spacingMm, hole, placement, existingIds) {
  const half = spacingMm / 2;
  const corners = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half]
  ];
  const profiles = [];
  let resolvedHole = null;
  for (const [index, [dx, dz]] of corners.entries()) {
    const cut = fastenerCut(
      entryId,
      `${idPrefix}_${index + 1}`,
      placement.centerX + dx,
      placement.centerZ + dz,
      hole,
      existingIds
    );
    if (cut.error) return { error: cut.error };
    profiles.push(cut.profile);
    resolvedHole = cut.resolved;
  }
  return { profiles, resolvedHole };
}

/**
 * The catalogue.
 *
 * Each entry's `build` returns `{ profiles, provenance }` or `{ error }`. The three
 * component entries name a component id so the picker can show what is being mounted;
 * the fastener entries name none, because a bolt circle of M4 clearance holes is not a
 * component, it is a pattern of the fastener the caller chose.
 */
const HARDWARE_BUILDERS = Object.freeze({
  nema17_face: {
    id: "nema17_face",
    label: "NEMA 17 motor face",
    category: "Motors",
    componentId: "nema17",
    summary: "31 mm M3 bolt square plus an H7 bore over the 22 mm pilot boss.",
    // `idPrefix` and `pilotId` exist so `templates.js` can consume this entry without
    // renaming the profiles it has shipped since V1. That reuse is the point: the
    // retrofitted `motor_face_mount` and this catalogue entry resolve the same NEMA
    // dimensions through the same code, so the two cannot drift apart, and a saved
    // project's `motor_hole_1` keeps its id.
    build(options, existingIds) {
      const entryId = "nema17_face";
      const placement = finitePlacement(options);
      if (!placement) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The pattern centre must be a finite X and Z.") };
      }
      const component = getComponent("nema17");
      const spacing = componentDimension("nema17", "boltSpacingMm");
      const pilot = locatingBoreMm("nema17", "pilotDiameterMm");
      const hole = {
        size: component.fastenerSize,
        fit: typeof options.fit === "string" ? options.fit : "normal",
        style: typeof options.style === "string" ? options.style : "through"
      };

      const square = squareBoltPattern(
        entryId,
        typeof options.idPrefix === "string" ? options.idPrefix : "nema17_bolt",
        spacing.valueMm,
        hole,
        placement,
        existingIds
      );
      if (square.error) return { error: square.error };

      const provenance = [
        { dimension: "boltSpacing", source: spacing.source, confidence: spacing.confidence },
        ...square.resolvedHole.provenance
      ];
      const profiles = [...square.profiles];

      // The pilot bore is opt-out rather than opt-in: a NEMA face plate without one
      // still bolts up, but it locates on four M3 clearance holes instead of on the
      // boss the standard put there for the purpose.
      if (options.includePilotBore !== false) {
        const pilotId = typeof options.pilotId === "string" ? options.pilotId : "nema17_pilot_bore";
        profiles.unshift(seatCut(pilotId, placement.centerX, placement.centerZ, pilot.diameterMm, existingIds));
        provenance.push(...pilot.provenance);
      }

      return { profiles, provenance };
    }
  },
  bearing_seat_608: {
    id: "bearing_seat_608",
    label: "608 bearing seat",
    category: "Motion",
    componentId: "bearing608",
    summary: "An H7 housing bore for the 22 mm outer race of a 608.",
    build(options, existingIds) {
      const entryId = "bearing_seat_608";
      const placement = finitePlacement(options);
      if (!placement) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The seat centre must be a finite X and Z.") };
      }
      const seat = locatingBoreMm("bearing608", "outerDiameterMm");
      const seatId = typeof options.seatId === "string" ? options.seatId : "bearing_608_seat";
      return {
        profiles: [seatCut(seatId, placement.centerX, placement.centerZ, seat.diameterMm, existingIds)],
        provenance: seat.provenance
      };
    }
  },
  heatset_boss_group: {
    id: "heatset_boss_group",
    label: "Heat-set insert group",
    category: "Fasteners",
    componentId: null,
    summary: "A line of heat-set insert bores at a verified vendor bore diameter.",
    build(options, existingIds) {
      const entryId = "heatset_boss_group";
      const placement = finitePlacement(options);
      if (!placement) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The group centre must be a finite X and Z.") };
      }
      const count = Math.floor(Number(options.count ?? 2));
      if (!Number.isFinite(count) || count < 1) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "A heat-set group needs at least one insert.") };
      }
      const spacingMm = Number(options.spacingMm ?? 20);
      if (!Number.isFinite(spacingMm)) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The insert spacing must be a finite number.") };
      }
      // `heatSetInsert` is the whole point: the refusal for a size with no published
      // vendor bore arrives from `resolveHole`, so this entry inherits the exact
      // sentence the single-hole path would give rather than paraphrasing it.
      const hole = {
        size: typeof options.size === "string" ? options.size : "M3",
        style: "heatSetInsert",
        fit: typeof options.fit === "string" ? options.fit : "normal",
        fromFace: typeof options.fromFace === "string" ? options.fromFace : "top"
      };
      const offset = (count - 1) / 2;
      const profiles = [];
      let resolvedHole = null;
      for (let index = 0; index < count; index += 1) {
        const cut = fastenerCut(
          entryId,
          `heatset_boss_${index + 1}`,
          placement.centerX + (index - offset) * spacingMm,
          placement.centerZ,
          hole,
          existingIds
        );
        if (cut.error) return { error: cut.error };
        profiles.push(cut.profile);
        resolvedHole = cut.resolved;
      }
      return { profiles, provenance: resolvedHole.provenance };
    }
  },
  fastener_bolt_circle: {
    id: "fastener_bolt_circle",
    label: "Bolt circle (standard fastener)",
    category: "Fasteners",
    componentId: null,
    summary: "Any count of clearance holes on a pitch circle, sized from the fastener table.",
    build(options, existingIds) {
      const entryId = "fastener_bolt_circle";
      const placement = finitePlacement(options);
      if (!placement) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The circle centre must be a finite X and Z.") };
      }
      const count = Math.floor(Number(options.count ?? 6));
      if (!Number.isFinite(count) || count < 1) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "A bolt circle needs at least one hole.") };
      }
      const radiusMm = Number(options.pitchRadiusMm ?? 20);
      if (!Number.isFinite(radiusMm) || radiusMm <= 0) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The pitch radius must be a positive number.") };
      }
      const startAngleDeg = asFiniteNumber(options.startAngleDeg, 0);
      const hole = {
        size: typeof options.size === "string" ? options.size : "M3",
        fit: typeof options.fit === "string" ? options.fit : "normal",
        style: typeof options.style === "string" ? options.style : "through"
      };
      const profiles = [];
      let resolvedHole = null;
      for (let index = 0; index < count; index += 1) {
        const angle = ((startAngleDeg + (360 * index) / count) * Math.PI) / 180;
        const cut = fastenerCut(
          entryId,
          `bolt_circle_${index + 1}`,
          placement.centerX + Math.cos(angle) * radiusMm,
          placement.centerZ + Math.sin(angle) * radiusMm,
          hole,
          existingIds
        );
        if (cut.error) return { error: cut.error };
        profiles.push(cut.profile);
        resolvedHole = cut.resolved;
      }
      return { profiles, provenance: resolvedHole.provenance };
    }
  },
  fastener_corner_square: {
    id: "fastener_corner_square",
    label: "Corner bolt square (standard fastener)",
    category: "Fasteners",
    componentId: null,
    summary: "Four clearance holes on a square, sized from the fastener table.",
    build(options, existingIds) {
      const entryId = "fastener_corner_square";
      const placement = finitePlacement(options);
      if (!placement) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The square centre must be a finite X and Z.") };
      }
      const spacingMm = Number(options.spacingMm ?? 40);
      if (!Number.isFinite(spacingMm) || spacingMm <= 0) {
        return { error: refuse(entryId, HARDWARE_INVALID_PLACEMENT, "The bolt spacing must be a positive number.") };
      }
      const hole = {
        size: typeof options.size === "string" ? options.size : "M3",
        fit: typeof options.fit === "string" ? options.fit : "normal",
        style: typeof options.style === "string" ? options.style : "through"
      };
      const square = squareBoltPattern(entryId, "corner_bolt", spacingMm, hole, placement, existingIds);
      if (square.error) return { error: square.error };
      return { profiles: square.profiles, provenance: square.resolvedHole.provenance };
    }
  }
});

export const HARDWARE_ENTRY_IDS = Object.freeze(Object.keys(HARDWARE_BUILDERS));

/** Catalogue metadata for a picker. Deliberately free of geometry. */
export function listHardwareEntries() {
  return HARDWARE_ENTRY_IDS.map((id) => {
    const entry = HARDWARE_BUILDERS[id];
    return {
      id: entry.id,
      label: entry.label,
      category: entry.category,
      componentId: entry.componentId,
      summary: entry.summary
    };
  });
}

export function isHardwareEntryId(id) {
  return Object.prototype.hasOwnProperty.call(HARDWARE_BUILDERS, id);
}

export function getHardwareEntry(id) {
  const entry = HARDWARE_BUILDERS[id];
  if (!entry) return null;
  return { id: entry.id, label: entry.label, category: entry.category, componentId: entry.componentId, summary: entry.summary };
}

/**
 * Resolve a catalogue entry into cut profiles.
 *
 * `ok: true` carries `profiles` ready to append to a sketch's `cutProfiles`, the
 * `provenance` of every dimension used, and `unverifiedDimensions` naming the ones
 * that are not checked against a published standard. `ok: false` carries a `code` and
 * a `reason` and no profiles.
 *
 * `existingIds` should be the sketch's current profile ids, so an entry applied twice
 * produces `nema17_bolt_1` and `nema17_bolt_1_2` rather than a duplicate id the
 * normalizer would have to rename later.
 */
export function resolveHardwarePattern(entryId, options = {}) {
  const id = String(entryId ?? "");
  if (!isHardwareEntryId(id)) {
    // The interesting branch. A flagged-but-unsourced component gets its recorded
    // reason rather than a generic miss, because the two are different facts: one is
    // a typo and the other is a decision somebody made and wrote down.
    const unsourced = unsourcedComponentReason(id);
    if (unsourced) {
      return refuse(
        id,
        HARDWARE_UNSOURCED_COMPONENT,
        `There is no ${id} hardware pattern, and that is deliberate. ${unsourced}`
      );
    }
    return refuse(
      id,
      HARDWARE_UNKNOWN_ENTRY,
      `No hardware pattern named "${id}" is published here. Available: ${HARDWARE_ENTRY_IDS.join(", ")}.`
    );
  }

  const entry = HARDWARE_BUILDERS[id];
  const existingIds = new Set(options.existingIds ?? []);
  const built = entry.build(options, existingIds);
  if (built.error) return built.error;

  const provenance = built.provenance ?? [];
  return {
    ok: true,
    entryId: id,
    entry: getHardwareEntry(id),
    profiles: built.profiles,
    provenance,
    unverifiedDimensions: provenance.filter((item) => item.confidence !== "verified").map((item) => item.dimension),
    label: describeHardwarePattern(id, built.profiles)
  };
}

/** A short human label for a resolved pattern, for the status line. */
export function describeHardwarePattern(entryId, profiles = []) {
  const entry = getHardwareEntry(entryId);
  if (!entry) return null;
  const fastener = profiles.find((profile) => profile?.hole);
  const holeLabel = fastener ? `, ${describeHole(fastener.hole)}` : "";
  return `${entry.label}: ${profiles.length} cut${profiles.length === 1 ? "" : "s"}${holeLabel}`;
}

/**
 * Append a resolved pattern's profiles to a sketch, or report the refusal.
 *
 * Kept here rather than in the page so the mutation is testable without a DOM, and
 * deliberately returning a **new** sketch: `commitSelectedBody` hands out a draft and
 * expects one back, and a helper that mutated its argument would work there and be
 * wrong everywhere else.
 */
export function appendHardwarePatternToSketch(sketch, entryId, options = {}) {
  const currentIds = [
    sketch?.outerProfile?.id,
    ...(sketch?.cutProfiles ?? []).map((profile) => profile?.id)
  ].filter(Boolean);
  const resolved = resolveHardwarePattern(entryId, { ...options, existingIds: currentIds });
  if (!resolved.ok) return { ok: false, resolved, sketch };
  return {
    ok: true,
    resolved,
    sketch: {
      ...sketch,
      cutProfiles: [...(sketch?.cutProfiles ?? []), ...resolved.profiles]
    }
  };
}
