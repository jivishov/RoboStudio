/**
 * The Component Builder export façade.
 *
 * Two rules hold across every format here.
 *
 * **Exporters read the compiled artefact; they never re-derive geometry.** The
 * mesh formats take the solid from `compilePartBodyToSolid` and the mesh from
 * `solidToMeshData`, the same two the preview uses. DXF takes the sketch
 * profiles, which are the *source* the compiler itself reads, not a second
 * interpretation of them. Nothing in this file owns a private idea of what the
 * body is, and nothing here is a change detector: the compile signature in
 * `compileCache.js` and the autosave fingerprint are the only two, by design.
 *
 * **Mesh exports are gated on watertightness.** The divergence theorem and every
 * slicer need a closed surface, so `watertight.js` is consulted before STL or 3MF
 * bytes are produced and the export is refused with a reason rather than shipping
 * an unprintable file. The gate is an export precondition, never an input to
 * `validateBody`, which refuses to compile on any issue at any severity.
 *
 * `AGENTS.md:48` keeps export-only dependencies out of the preview worker startup
 * path, which is why `cadWorker.js` dynamic-imports this module and why the zip
 * and format writers hang off it rather than off `cadWorkerCore.js`.
 */

import jscad from "@jscad/modeling";
import { sanitizePartId } from "./contracts.js";
import { compilePartBodyToSolid } from "./cadCompile.js";
import {
  EXPORT_FORMAT_ASCII_STL,
  EXPORT_FORMAT_BINARY_STL,
  EXPORT_FORMAT_DXF,
  bodyExportAvailability,
  exportFormat
} from "./exportFormats.js";
import { solidToMeshData } from "./meshConversion.js";
import { assertMeshExportWatertight, solidWatertightReport } from "./watertight.js";
import { bodyDxfDocument } from "./exporters/dxf.js";
import { serializeMeshToBinaryStl } from "./exporters/binaryStl.js";

const { scale: scaleSolid } = jscad.transforms;

export class PartExportError extends Error {
  constructor(message, code = "export-unavailable") {
    super(message);
    this.name = "PartExportError";
    this.code = code;
  }
}

function bodyBaseName(body) {
  return sanitizePartId(body?.name ?? body?.id ?? "robotic_part", "robotic_part");
}

export function stlFileNameForBody(body) {
  return `${bodyBaseName(body)}.stl`;
}

/** File name for any registered format, so the caller never builds one by hand. */
export function exportFileNameForBody(body, formatId) {
  const format = exportFormat(formatId);
  return `${bodyBaseName(body)}.${format?.extension ?? "bin"}`;
}

function bodyScaleVector(body) {
  const source = Array.isArray(body?.transform?.scale) ? body.transform.scale : [1, 1, 1];
  return source.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 1;
  });
}

export function compileBodyToStlSolid(body, options = {}) {
  const solid = compilePartBodyToSolid(body, { bodies: options.bodies });
  const scale = bodyScaleVector(body);
  return scale.some((value) => Math.abs(value - 1) > 1e-9) ? scaleSolid(scale, solid) : solid;
}

function stlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toPrecision(12)).toString() : "0";
}

function stlVertex(vertices, offset) {
  return `${stlNumber(vertices[offset])} ${stlNumber(vertices[offset + 1])} ${stlNumber(vertices[offset + 2])}`;
}

function serializeMeshToAsciiStl(mesh, name) {
  const lines = [`solid ${name}`];
  for (let offset = 0; offset < mesh.vertices.length; offset += 9) {
    lines.push(`  facet normal ${stlVertex(mesh.normals, offset)}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${stlVertex(mesh.vertices, offset)}`);
    lines.push(`      vertex ${stlVertex(mesh.vertices, offset + 3)}`);
    lines.push(`      vertex ${stlVertex(mesh.vertices, offset + 6)}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n");
}

/**
 * Compile a body and mesh it once, refusing if the surface is not closed.
 *
 * One compile serves every mesh format, and the watertight report is taken from
 * the same solid the mesh came from rather than recomputed per format.
 */
function meshForExport(body, options = {}) {
  const solid = compileBodyToStlSolid(body, { bodies: options.bodies });
  const watertight = solidWatertightReport(solid);
  assertMeshExportWatertight(body, watertight, options.formatLabel ?? "An STL export");
  return { solid, mesh: solidToMeshData(solid), watertight };
}

/**
 * ASCII STL by default, binary when `options.binary` is set.
 *
 * Binary returns a `Uint8Array` and ASCII returns a string; that difference is the
 * reason `exportBodyToFormat` reports a mime type alongside the bytes.
 */
export function serializeBodyToStl(body, options = {}) {
  const { mesh } = meshForExport(body, options);
  const name = bodyBaseName(body);
  return options.binary ? serializeMeshToBinaryStl(mesh, name) : serializeMeshToAsciiStl(mesh, name);
}

export function serializeBodyToBinaryStl(body, options = {}) {
  return serializeBodyToStl(body, { ...options, binary: true });
}

/**
 * Export one body to any browser-side format.
 *
 * Returns the bytes plus the metadata the UI and the tests want: the file name,
 * the mime type, whatever warnings the format produced, and a per-format `meta`
 * block. Refuses with a `PartExportError` carrying a code, so the caller can show
 * the reason rather than a generic failure.
 */
export async function exportBodyToFormat(body, formatId, options = {}) {
  const format = exportFormat(formatId);
  if (!format) throw new PartExportError(`Unknown export format: ${formatId}.`, "unknown-export-format");

  // Availability is re-checked here rather than trusted from the caller, because
  // the UI, the assistant and the browser suite all reach this by different routes.
  // The two facts it cannot know - whether the body is valid and whether its
  // surface is closed - are each established below by the path that actually
  // compiles: `validateBody` inside `compilePartBodyToSolid` for the mesh formats
  // and inside `bodyDxfPlan` for DXF, and `watertight.js` for the mesh formats.
  const availability = bodyExportAvailability(body, formatId, { built: true, valid: true, watertight: null });
  if (!availability.available) throw new PartExportError(availability.reason, "export-unavailable");

  const fileName = exportFileNameForBody(body, formatId);

  if (formatId === EXPORT_FORMAT_DXF) {
    const { dxf, plan } = bodyDxfDocument(body);
    return {
      formatId,
      fileName,
      mimeType: format.mimeType,
      data: dxf,
      // Overlapping cuts do not stop the export, but the DXF then describes
      // intersecting contours rather than one merged opening, and the user is told.
      warnings: plan.warnings,
      meta: {
        byteLength: dxf.length,
        contourCount: plan.contourCount,
        extents: plan.extents,
        placementScale: plan.placementScale,
        materialThicknessMm: plan.materialThicknessMm
      }
    };
  }

  if (formatId !== EXPORT_FORMAT_ASCII_STL && formatId !== EXPORT_FORMAT_BINARY_STL) {
    // 3MF and STEP are deliberately not routed here. 3MF is built on the main
    // thread so JSZip stays out of the worker bundle (see `exporters/threeMf.js`),
    // and STEP is the local build123d backend's.
    throw new PartExportError(`${format.label} is not exported through the CAD worker.`, "export-unavailable");
  }

  const { mesh, watertight } = meshForExport(body, options);
  const name = bodyBaseName(body);
  const data = formatId === EXPORT_FORMAT_BINARY_STL
    ? serializeMeshToBinaryStl(mesh, name)
    : serializeMeshToAsciiStl(mesh, name);
  return {
    formatId,
    fileName,
    mimeType: format.mimeType,
    data,
    warnings: [],
    meta: {
      triangleCount: mesh.triangleCount,
      byteLength: data.length ?? data.byteLength,
      watertight: watertight.watertight
    }
  };
}
