/**
 * The export format table and the rules for when a format is honestly offered.
 *
 * This module is deliberately free of `@jscad/modeling`, of the serializers, and
 * of the DOM. The main thread needs to render the export menu on every selection
 * change, and `AGENTS.md:48` keeps export-only dependencies out of the paths that
 * run before an export is asked for. So the decision table lives here as pure
 * data plus one pure function, and the serializers are dynamic-imported in the
 * CAD worker only when a format is actually chosen.
 *
 * `AGENTS.md:112` asks for "unavailable with a reason" rather than a permanently
 * disabled control, so every rule below returns the sentence the UI shows. A
 * format is never silently dropped from the menu.
 */

import { SKETCH_EXTRUDE_KIND } from "./contracts.js";

export const EXPORT_FORMAT_ASCII_STL = "asciiStl";
export const EXPORT_FORMAT_BINARY_STL = "binaryStl";
export const EXPORT_FORMAT_DXF = "dxf";
export const EXPORT_FORMAT_3MF = "threeMf";
export const EXPORT_FORMAT_STEP = "step";

/** Formats whose output is the tessellated mesh, so they need a closed surface. */
export const MESH_EXPORT_FORMATS = Object.freeze([
  EXPORT_FORMAT_ASCII_STL,
  EXPORT_FORMAT_BINARY_STL,
  EXPORT_FORMAT_3MF
]);

export const EXPORT_FORMATS = Object.freeze([
  {
    id: EXPORT_FORMAT_BINARY_STL,
    label: "Binary STL",
    hint: "Compact mesh for slicers",
    extension: "stl",
    mimeType: "model/stl",
    binary: true
  },
  {
    id: EXPORT_FORMAT_ASCII_STL,
    label: "ASCII STL",
    hint: "Text mesh, widest compatibility",
    extension: "stl",
    mimeType: "model/stl",
    binary: false
  },
  {
    id: EXPORT_FORMAT_DXF,
    label: "DXF (R12)",
    hint: "Exact 2D profile for laser and router",
    extension: "dxf",
    mimeType: "image/vnd.dxf",
    binary: false
  },
  {
    id: EXPORT_FORMAT_3MF,
    label: "3MF",
    hint: "Millimetre mesh container for modern slicers",
    extension: "3mf",
    mimeType: "model/3mf",
    binary: true
  },
  {
    id: EXPORT_FORMAT_STEP,
    label: "STEP",
    hint: "Exact solid, needs the local CAD backend",
    extension: "step",
    mimeType: "model/step",
    binary: true
  }
]);

const FORMATS_BY_ID = new Map(EXPORT_FORMATS.map((format) => [format.id, format]));

export function exportFormat(formatId) {
  return FORMATS_BY_ID.get(formatId) ?? null;
}

export function isMeshExportFormat(formatId) {
  return MESH_EXPORT_FORMATS.includes(formatId);
}

function bodyKind(body) {
  return body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
}

function formatNumberForReason(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "1";
  return Number(number.toFixed(4)).toString();
}

/**
 * In-plane placement scale for a sketch body, as `[x, z]`.
 *
 * `compileBodyToStlSolid` bakes `transform.scale` into the exported solid, so an
 * exporter that ignored it would ship nominal-size geometry for a body the user
 * has scaled. DXF can only honour the sketch-plane part of that scale, and only
 * when it is uniform within the plane.
 */
export function sketchPlaneScale(body) {
  const source = Array.isArray(body?.transform?.scale) ? body.transform.scale : [1, 1, 1];
  return [0, 2].map((axis) => {
    const value = Number(source[axis]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
}

export function sketchPlaneScaleIsUniform(body) {
  const [x, z] = sketchPlaneScale(body);
  return Math.abs(x - z) <= 1e-9;
}

function dxfUnavailableReason(body) {
  const kind = bodyKind(body);
  if (kind !== SKETCH_EXTRUDE_KIND) {
    return "DXF comes from an exact 2D sketch region. Silhouettes for lathe, gear, boolean and recipe bodies arrive with orthographic drawings.";
  }
  if (!body?.sketch?.outerProfile) return "This body has no outer profile to cut.";
  if (!sketchPlaneScaleIsUniform(body)) {
    const [x, z] = sketchPlaneScale(body);
    return `Placement scale is ${formatNumberForReason(x)} by ${formatNumberForReason(z)} in the sketch plane, so a hole would not export as a circle. Make the X and Z scale equal, or export STL.`;
  }
  return null;
}

/**
 * Why STEP cannot be produced for this body at all, ignoring the backend.
 *
 * A sketch body with no outer profile has no region to extrude, and that is a fact
 * about the body rather than about the bridge - so it must not read as "install the
 * backend", which is the class of defect cycle 10 removed from the recipe compiler.
 */
function stepUnsupportedReason(body) {
  const kind = bodyKind(body);
  if (kind === SKETCH_EXTRUDE_KIND && !body?.sketch?.outerProfile) {
    return "This body has no outer profile, so there is no exact solid to write.";
  }
  return null;
}

/**
 * Whether a format can be offered for a body, and if not, why.
 *
 * `context` carries what only the caller knows: `built` is whether a compiled
 * result exists, `valid` is whether `validateBody` is empty, `watertight` is the
 * verdict from `watertight.js` (`null` when unknown), `compiling` is whether a
 * build is in flight, and `backendAvailable` reports the optional build123d
 * bridge as `true`, `false`, or `null` for **not yet asked** - three states, because
 * an unasked question and a negative answer are different claims (audit A2).
 * `backendReason` carries the probe's own sentence so the menu can say which of the
 * bridge's six outcomes it saw rather than flattening them into "unavailable".
 */
export function bodyExportAvailability(body, formatId, context = {}) {
  const format = exportFormat(formatId);
  if (!format) return { formatId, available: false, reason: `Unknown export format: ${formatId}.` };

  const unavailable = (reason) => ({ formatId, format, available: false, reason });

  if (!body) return unavailable("Select a body to export.");
  if (context.compiling) return unavailable("A build is in progress.");

  if (formatId === EXPORT_FORMAT_STEP) {
    // ⚠ This used to refuse every body kind but `advancedCadRecipe`, because the bridge
    // read `body.advancedCadRecipe` and nothing else. Cycle 10 gave the bridge an exact
    // payload for the other four kinds (`backendPayload.js`), so the only remaining
    // question about STEP is whether a bridge is there to answer it.
    const unsupported = stepUnsupportedReason(body);
    if (unsupported) return unavailable(unsupported);
    if (context.backendAvailable === false) {
      return unavailable(
        context.backendReason
        ?? "STEP export needs the local build123d backend, which is not available on static hosting."
      );
    }
    // `null` means the probe has not answered yet, which is **not** the same as absent
    // (audit A2). STEP stays offered and says so; `exportSelectedStep` reports the real
    // outcome, which is where an unprobed backend gets found out honestly.
    return {
      formatId,
      format,
      available: true,
      reason: null,
      note: context.backendAvailable === true ? null : "The local build123d backend has not answered yet."
    };
  }

  if (formatId === EXPORT_FORMAT_DXF) {
    const reason = dxfUnavailableReason(body);
    if (reason) return unavailable(reason);
    // DXF is derived from the sketch, not from the mesh, so it needs the body to
    // be valid but not to have built. It still waits for validity, because
    // `validateBody` is what guarantees every cut lies inside the outer profile.
    if (context.valid === false) return unavailable("Fix the validation issues on this body first.");
    return { formatId, format, available: true, reason: null };
  }

  if (context.built === false) return unavailable("Build this body first.");
  if (isMeshExportFormat(formatId) && context.watertight === false) {
    return unavailable("This body does not compile to a closed surface, so a mesh export would be unprintable. See the Build panel.");
  }

  return { formatId, format, available: true, reason: null };
}

/** Availability for every format, in menu order. */
export function bodyExportAvailabilities(body, context = {}) {
  return EXPORT_FORMATS.map((format) => bodyExportAvailability(body, format.id, context));
}
