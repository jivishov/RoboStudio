/**
 * The bill of materials: what to buy and what to make, for someone who did not draw it.
 *
 * ## What this module is for
 *
 * The page could already state a mass, resolve a fastener, refuse an unmanufacturable
 * feature and export a mesh. What it could not do is hand anyone a **document**, so a
 * correct part still left the browser only as a file another program had to open. This is
 * the buy side of that; `printPrep.js` is the make side.
 *
 * ## Absent is not zero, and this is the module most likely to break that
 *
 * A BOM is a table of derived numbers and several of them are legitimately absent. The
 * defect has shipped three times in this project and was caught in review every time,
 * never by a test: `Number(null)` is `0`, so cycle 04 turned an absent volume into a
 * fabricated `0`, cycle 05 rendered "0.000 cm³" in the one card whose contract is to show
 * a dash, and cycle 06 reported all twenty templates against a maximum of zero.
 *
 * So: a body whose volume the page does not hold gets `massGrams: null` **and** a
 * `massUnavailableReason` naming why, and the row still appears. It is not omitted, which
 * would be a quieter version of the same lie - a reader counting rows would come up short
 * and have nothing to tell them so. `format.js`'s `formatOutput` turns the null into a
 * dash at the point of render, and the test asserts the **rendered cell**.
 *
 * ## Purchased parts come from resolved holes, never from a record of where cuts came from
 *
 * An applied hardware pattern persists nothing: its profiles are indistinguishable from
 * four holes somebody typed, and `AGENTS.md` forbids adding a field to record otherwise.
 * That is by design and it is also the right input - what makes a screw necessary is a
 * hole that resolves to a fastener, whatever drew it.
 *
 * ## DOM-free
 *
 * Every function here returns data. The page appends it. That is what makes the
 * absent-not-zero assertions testable in node, which is the whole reason the defect above
 * can be caught by a test this time.
 */

import { describeHole, profileHoleResolution } from "./holes.js";
import { formatOutput } from "./format.js";
import { getMaterial, massGramsForVolume, normalizeMaterialId } from "./materials.js";
import { describeProcess, normalizeProcessId } from "./process.js";
import { SKETCH_EXTRUDE_KIND } from "./contracts.js";

/** What a resolved hole implies you have to buy. */
export const BOM_PURCHASED_KINDS = Object.freeze(["screw", "nut", "heatSetInsert"]);

/**
 * Why a body has no mass, as a code plus a sentence.
 *
 * Codes rather than only sentences, because the page shows the sentence and a test
 * asserts the distinction - and "not built yet" and "does not close" are different
 * situations with different remedies.
 */
export const BOM_MASS_NOT_BUILT = "bom-mass-not-built";
export const BOM_MASS_NOT_WATERTIGHT = "bom-mass-not-watertight";
export const BOM_MASS_NO_MATERIAL = "bom-mass-no-material";

function massUnavailable(code, message) {
  return { code, message };
}

/**
 * The volume this body's mass would come from, or the reason there is not one.
 *
 * `geometryProperties` is supplied by the caller because only the page holds the compile
 * results, and a BOM that recompiled to state a mass would be a second compile path. A
 * sketch body's exact 2D volume needs no solid, so the caller may pass it for every kind
 * or only for the ones that need it.
 */
function bodyVolume(body, options) {
  const properties = options.geometryPropertiesById?.get?.(body.id)
    ?? options.geometryPropertiesById?.[body.id]
    ?? null;
  const watertight = options.watertightById?.get?.(body.id) ?? options.watertightById?.[body.id] ?? null;

  if (watertight === false) {
    return {
      volumeMm3: null,
      reason: massUnavailable(
        BOM_MASS_NOT_WATERTIGHT,
        "This body does not compile to a closed surface, so its volume cannot be measured. See the Build panel."
      )
    };
  }
  if (!properties) {
    return {
      volumeMm3: null,
      reason: massUnavailable(BOM_MASS_NOT_BUILT, "This body has not been built yet, so there is no volume to weigh.")
    };
  }
  // ⚠ `== null` and not `!properties.volumeMm3`. A real volume is never zero, but writing
  // the falsy check here is how the absent-not-zero defect gets in through the back door
  // the next time somebody edits this line.
  if (properties.volumeMm3 == null || !Number.isFinite(Number(properties.volumeMm3))) {
    return {
      volumeMm3: null,
      reason: massUnavailable(
        BOM_MASS_NOT_WATERTIGHT,
        properties.volumeUnavailableReason
          ?? "The compiled surface is not closed, so the divergence-theorem volume is unavailable."
      )
    };
  }
  return { volumeMm3: Number(properties.volumeMm3), reason: null };
}

/** One made part: a body, its material, its process, and its mass or the lack of one. */
function partEntry(body, options) {
  const materialId = normalizeMaterialId(body?.materialId);
  const material = getMaterial(materialId);
  const processId = normalizeProcessId(body?.processId);
  const { volumeMm3, reason } = bodyVolume(body, options);

  const massGrams = volumeMm3 == null ? null : massGramsForVolume(volumeMm3, materialId);
  return {
    bodyId: body.id,
    name: body.name,
    sourceKind: body?.source?.kind ?? SKETCH_EXTRUDE_KIND,
    quantity: 1,
    materialId,
    materialLabel: material?.label ?? materialId,
    processId,
    processLabel: describeProcess(processId) ?? processId,
    volumeMm3,
    massGrams,
    // Null with a reason, never a zero. See the module comment.
    massUnavailableReason: massGrams == null ? (reason?.message ?? "This body has no volume to weigh.") : null,
    massUnavailableCode: massGrams == null ? (reason?.code ?? BOM_MASS_NO_MATERIAL) : null
  };
}

/**
 * What one resolved hole implies you have to buy.
 *
 * A `through`, `counterbore` or `countersink` hole is a clearance hole and means a screw.
 * A `nutTrap` means that screw **and** a nut; a `heatSetInsert` means that screw and an
 * insert. `tapped` means no purchased part at all - the thread is in the part.
 */
function purchasedForHole(resolved, body) {
  const spec = resolved.spec;
  if (spec.style === "tapped") return [];

  const thicknessMm = Number(body?.extrudeDepthMm);
  const entries = [
    {
      kind: "screw",
      size: spec.size,
      standard: spec.standard,
      // ⚠ A **minimum**, never a length. See `minimumScrewLengthMm`.
      minimumLengthMm: minimumScrewLengthMm(spec, resolved, thicknessMm),
      holeLabel: describeHole(spec)
    }
  ];
  if (spec.style === "nutTrap") {
    entries.push({ kind: "nut", size: spec.size, standard: spec.standard, minimumLengthMm: null, holeLabel: describeHole(spec) });
  }
  if (spec.style === "heatSetInsert") {
    entries.push({
      kind: "heatSetInsert",
      size: spec.size,
      standard: spec.standard,
      minimumLengthMm: null,
      holeLabel: describeHole(spec)
    });
  }
  return entries;
}

/**
 * The shortest screw that could possibly work, and deliberately not a length.
 *
 * The minimum is derivable from geometry this project holds: the plate it passes through,
 * plus the depth of a nut or insert it lands in. **The actual length depends on a stack-up
 * the project does not model** - what the plate bolts to, how thick that is, whether there
 * is a washer - and emitting a single number would be the same class of error as an
 * interpolated hole: a figure that looks resolved and was guessed. `fasteners.js` refuses
 * an M2.5 insert bore rather than averaging M2 and M4, and this is that rule applied to a
 * dimension nothing in the project can see.
 *
 * Returns `null` rather than a fabricated number when the thickness is unusable, which is
 * the same contract as everything else in this module.
 */
function minimumScrewLengthMm(spec, resolved, thicknessMm) {
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) return null;
  // A countersunk head sinks into the plate, so it does not add; a counterbored one does
  // not add either, because the screw still has to reach through. What does add is
  // anything the screw lands *in*, and the project models exactly two of those.
  const pocket = resolved.pocket;
  const landingMm = pocket && (spec.style === "nutTrap" || spec.style === "heatSetInsert")
    ? Math.abs(Number(pocket.depthMm)) || 0
    : 0;
  return thicknessMm + landingMm;
}

function purchasedKey(entry) {
  return [entry.kind, entry.standard, entry.size, entry.minimumLengthMm ?? "none"].join("|");
}

/**
 * Purchased parts for one body, grouped, with the profiles that asked for each.
 *
 * A refused hole contributes nothing: it produced no geometry either, so listing a screw
 * for it would put a part on an order that the drawing does not have a hole for.
 */
export function bodyPurchasedParts(body) {
  const grouped = new Map();
  for (const profile of body?.sketch?.cutProfiles ?? []) {
    const resolved = profileHoleResolution(profile);
    if (!resolved?.ok) continue;
    for (const entry of purchasedForHole(resolved, body)) {
      const key = purchasedKey(entry);
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += 1;
        existing.sourceProfileIds.push(profile.id);
        continue;
      }
      grouped.set(key, { ...entry, key, quantity: 1, sourceProfileIds: [profile.id], bodyIds: [body.id] });
    }
  }
  return [...grouped.values()];
}

/** The sentence a screw row shows instead of a length. One place, so it cannot drift. */
export function describeMinimumLength(entry) {
  if (entry.kind !== "screw") return null;
  if (entry.minimumLengthMm == null) {
    return "Length depends on the assembly stack-up, which this project does not model.";
  }
  return (
    `At least ${formatOutput(entry.minimumLengthMm, 1)} mm, which is what this part alone needs. `
    + "The length to order also depends on what it fastens to, which this project does not model."
  );
}

/** A short designation for a purchased row: the size and what it is. */
export function describePurchased(entry) {
  const kind = entry.kind === "heatSetInsert" ? "heat-set insert" : entry.kind;
  return `${entry.size} ${kind}`;
}

/**
 * The whole bill of materials for a project.
 *
 * `options.geometryPropertiesById` and `options.watertightById` may be `Map`s or plain
 * objects keyed by body id; the page holds both and this module holds neither.
 */
export function projectBom(project, options = {}) {
  const bodies = project?.bodies ?? [];
  const parts = bodies.map((body) => partEntry(body, options));

  const purchased = new Map();
  for (const body of bodies) {
    for (const entry of bodyPurchasedParts(body)) {
      const existing = purchased.get(entry.key);
      if (!existing) {
        purchased.set(entry.key, entry);
        continue;
      }
      existing.quantity += entry.quantity;
      existing.sourceProfileIds.push(...entry.sourceProfileIds);
      if (!existing.bodyIds.includes(body.id)) existing.bodyIds.push(body.id);
    }
  }

  // ⚠ A total over a list containing an absence is itself absent, and stating the partial
  // sum as "the mass" would be the fabricated number one level up - arithmetically correct
  // and materially a lie, because a reader takes a total to cover the rows above it. The
  // partial sum is still offered, under its own name, beside the count it is missing.
  const missing = parts.filter((part) => part.massGrams == null);
  const weighed = parts.filter((part) => part.massGrams != null);
  const knownMassGrams = weighed.reduce((sum, part) => sum + part.massGrams * part.quantity, 0);

  return {
    parts,
    purchased: [...purchased.values()],
    totals: {
      partCount: parts.length,
      purchasedCount: [...purchased.values()].reduce((sum, entry) => sum + entry.quantity, 0),
      massGrams: missing.length ? null : knownMassGrams,
      knownMassGrams: weighed.length ? knownMassGrams : null,
      unweighedCount: missing.length,
      massUnavailableReason: missing.length
        ? `${missing.length} of ${parts.length} bodies have no measurable volume, so a project total would be short by an unknown amount.`
        : null
    }
  };
}
