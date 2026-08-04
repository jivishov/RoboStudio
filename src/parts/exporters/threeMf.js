/**
 * 3MF export: an OPC zip carrying one indexed mesh per body.
 *
 * ## Why JSZip and not a hand-rolled zip writer
 *
 * The cycle plan expected no zip dependency and offered writing stored
 * (uncompressed) entries by hand. That premise was out of date: `jszip` is
 * already a declared dependency and already the zip writer behind three other
 * export paths in this repo (`src/academic/projectPackage.js`,
 * `src/circuits/artifactZip.js`, `src/electronics/codegen.js`). Adding a fourth,
 * different, hand-written zip implementation for the same job would be
 * duplication, and stored entries would ship a plate's 3MF at four times the
 * size, since the model XML is highly repetitive text that deflates well.
 *
 * ## Why this one export runs on the main thread
 *
 * Every other format goes through the CAD worker. 3MF does not, and the reason is
 * `AGENTS.md:48`: the preview worker startup path must stay free of export-only
 * dependencies. A source-level dynamic import is not enough to hold that line,
 * because Vite bundles a module worker into a single file and inlines its dynamic
 * imports, so importing JSZip anywhere reachable from `cadWorker.js` puts 95 kB of
 * zip writer into the worker and runs its top-level code at worker startup.
 * Changing `worker.format` to force a code split would be a build-wide change to
 * every page's workers, which is exactly the ground `AGENTS.md:49` warns about.
 *
 * So 3MF is built here, on the main thread, from the mesh already sitting in the
 * compile cache, with JSZip dynamic-imported into the chunk the other three export
 * paths already share. That is not a workaround: it is strictly less work than the
 * alternative. The worker would otherwise recompile a body whose mesh the main
 * thread is already displaying, and scaling the triangle buffer gives exactly what
 * scaling the solid before tessellating gives, because a positive linear map
 * commutes with tessellation.
 *
 * ## Container
 *
 * Three parts, which is the minimum a conforming reader needs:
 *
 * - `[Content_Types].xml` mapping the `rels` and `model` extensions.
 * - `_rels/.rels` making `3D/3dmodel.model` the package's start part.
 * - `3D/3dmodel.model`, core spec namespace, `unit="millimeter"`.
 *
 * Exactly those three, with no synthesised directory entries and a fixed timestamp
 * on each, so two exports of an unchanged body are byte-identical and a diff
 * between two 3MF files means the geometry moved. See `serializeMeshesTo3mf` for
 * what that costs in JSZip options.
 *
 * ## Geometry
 *
 * 3MF triangles index into a shared vertex list, so vertices are welded rather
 * than written three times per triangle as STL does. That is not just smaller: a
 * conforming 3MF mesh is meant to be manifold, and a soup of unshared vertices
 * cannot be. Welding uses the same 1e-6 mm tolerance as `watertight.js`, whose
 * report gates this export in the first place.
 *
 * Coordinates are body space, unrotated - X and Z are the sketch plane and Y is
 * thickness (`AGENTS.md`) - which is exactly what the STL exporters emit. A 3MF
 * that silently stood the part up on Z would disagree with the STL of the same
 * body, and a slicer will lay a part flat on request anyway.
 *
 * The module is DOM-free: it runs in the CAD worker and under `node:test`.
 */

import { sanitizePartId } from "../contracts.js";
import { WELD_TOLERANCE_MM, assertMeshExportWatertight } from "../watertight.js";

export const THREE_MF_MODEL_PATH = "3D/3dmodel.model";
export const THREE_MF_CONTENT_TYPES_PATH = "[Content_Types].xml";
export const THREE_MF_RELS_PATH = "_rels/.rels";

const CORE_NAMESPACE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";

/**
 * The timestamp every zip entry carries.
 *
 * Exported so the determinism test names the same constant the writer uses rather
 * than a literal that could drift away from it.
 */
export const THREE_MF_ENTRY_DATE = new Date(Date.UTC(2020, 0, 1));

export function threeMfFileNameForBody(body) {
  return `${sanitizePartId(body?.name ?? body?.id ?? "robotic_part", "robotic_part")}.3mf`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function meshNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  // Six decimals is a nanometre at millimetre scale. Trimming the trailing zeros
  // matters here: it is thousands of characters across a real mesh.
  return Number(number.toFixed(6)).toString();
}

/**
 * Weld a flat triangle buffer into an indexed mesh.
 *
 * Degenerate triangles - two or three corners welding to the same vertex - are
 * dropped rather than written, because a zero-area triangle is not valid 3MF and
 * carries no information a slicer can use.
 */
export function indexedMeshFromTriangleSoup(vertices, triangleCount = null, options = {}) {
  const buffer = vertices ?? [];
  const tolerance = Number(options.weldToleranceMm ?? WELD_TOLERANCE_MM) || WELD_TOLERANCE_MM;
  const triangles = Number.isFinite(Number(triangleCount))
    ? Math.max(0, Math.floor(Number(triangleCount)))
    : Math.floor(buffer.length / 9);

  const indexByKey = new Map();
  const points = [];
  const faces = [];
  let degenerateTriangleCount = 0;

  const indexOf = (x, y, z) => {
    const snap = (value) => {
      const snapped = Math.round(value / tolerance) * tolerance;
      return Math.abs(snapped) < tolerance ? 0 : snapped;
    };
    const key = `${snap(x)},${snap(y)},${snap(z)}`;
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = points.length;
      indexByKey.set(key, index);
      points.push([x, y, z]);
    }
    return index;
  };

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = triangle * 9;
    if (offset + 9 > buffer.length) break;
    const a = indexOf(Number(buffer[offset]), Number(buffer[offset + 1]), Number(buffer[offset + 2]));
    const b = indexOf(Number(buffer[offset + 3]), Number(buffer[offset + 4]), Number(buffer[offset + 5]));
    const c = indexOf(Number(buffer[offset + 6]), Number(buffer[offset + 7]), Number(buffer[offset + 8]));
    if (a === b || b === c || a === c) {
      degenerateTriangleCount += 1;
      continue;
    }
    faces.push([a, b, c]);
  }

  return { points, faces, degenerateTriangleCount };
}

function objectXml(objectId, name, mesh) {
  const lines = [
    `  <object id="${objectId}" type="model" name="${escapeXml(name)}">`,
    "   <mesh>",
    "    <vertices>"
  ];
  for (const point of mesh.points) {
    lines.push(`     <vertex x="${meshNumber(point[0])}" y="${meshNumber(point[1])}" z="${meshNumber(point[2])}" />`);
  }
  lines.push("    </vertices>", "    <triangles>");
  for (const face of mesh.faces) {
    lines.push(`     <triangle v1="${face[0]}" v2="${face[1]}" v3="${face[2]}" />`);
  }
  lines.push("    </triangles>", "   </mesh>", "  </object>");
  return lines;
}

/** The `3D/3dmodel.model` document for a list of `{ name, mesh }` entries. */
export function threeMfModelXml(objects = []) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NAMESPACE}">`,
    ' <metadata name="Application">RoboStudio Component Builder</metadata>',
    " <resources>"
  ];
  for (const [index, entry] of objects.entries()) {
    lines.push(...objectXml(index + 1, entry.name, entry.mesh));
  }
  lines.push(" </resources>", " <build>");
  for (const [index] of objects.entries()) {
    lines.push(`  <item objectid="${index + 1}" />`);
  }
  lines.push(" </build>", "</model>");
  return `${lines.join("\n")}\n`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;
}

function relsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rel0" Target="/${THREE_MF_MODEL_PATH}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`;
}

/**
 * 3MF bytes for one or more `{ name, mesh }` entries, where `mesh` is a
 * `solidToMeshData` result.
 *
 * One object per body, as the plan asks, so the same function serves a
 * single-body export today and a whole-plate export later.
 */
export async function serializeMeshesTo3mf(entries = [], options = {}) {
  const objects = entries.map((entry, index) => ({
    name: entry.name ?? `body_${index + 1}`,
    mesh: indexedMeshFromTriangleSoup(entry.mesh?.vertices, entry.mesh?.triangleCount, options)
  }));

  // Dynamic so JSZip lands in the shared chunk the other export paths already
  // load, and so nothing pays for it until a 3MF is actually asked for.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  // A fixed date keeps two exports of an unchanged body byte-identical, which is
  // what makes a diff of an export meaningful. Two things are needed for that, and
  // the shipped code had neither:
  //
  // - The date is a **per-entry** option. `generateAsync` has none, so passing one
  //   there was silently ignored and every entry carried the wall clock from the
  //   moment `file()` ran.
  // - `createFolders` must be off. JSZip otherwise synthesises `_rels/` and `3D/`
  //   directory entries, and those it dates itself, so two exports a second apart
  //   still differed in the folder headers even once the files were pinned. OPC
  //   addresses parts by full path and needs no directory entries at all.
  const entryOptions = { date: THREE_MF_ENTRY_DATE, createFolders: false };
  zip.file(THREE_MF_CONTENT_TYPES_PATH, contentTypesXml(), entryOptions);
  zip.file(THREE_MF_RELS_PATH, relsXml(), entryOptions);
  zip.file(THREE_MF_MODEL_PATH, threeMfModelXml(objects), entryOptions);

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE"
  });

  return {
    bytes,
    vertexCount: objects.reduce((total, entry) => total + entry.mesh.points.length, 0),
    triangleCount: objects.reduce((total, entry) => total + entry.mesh.faces.length, 0),
    degenerateTriangleCount: objects.reduce((total, entry) => total + entry.mesh.degenerateTriangleCount, 0),
    objectCount: objects.length
  };
}

/**
 * Bake a body's placement scale into a triangle buffer.
 *
 * The mesh formats that go through the worker get their scale from
 * `compileBodyToStlSolid`, which scales the solid before tessellating. Scaling the
 * vertices afterwards is the same thing for a positive scale, so this stays in
 * step with the other exporters rather than shipping nominal-size geometry.
 */
export function scaleTriangleBuffer(vertices, scale = [1, 1, 1]) {
  const factors = [0, 1, 2].map((axis) => {
    const value = Number(scale?.[axis]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  if (factors.every((value) => Math.abs(value - 1) <= 1e-12)) return vertices;

  const scaled = new Float32Array(vertices.length);
  for (let index = 0; index < vertices.length; index += 1) {
    scaled[index] = vertices[index] * factors[index % 3];
  }
  return scaled;
}

/**
 * 3MF bytes for one body, from the mesh its compile already produced.
 *
 * Refuses a surface the caller has not established is closed: 3MF is a
 * manufacturing container and an open mesh is not printable. `watertight` is the
 * verdict from `watertight.js`, carried on the compile result as a warning.
 */
export async function exportBodyMeshTo3mf(body, mesh, options = {}) {
  if (!mesh?.vertices?.length) {
    throw new Error("Build this body before exporting 3MF.");
  }
  // The same gate the STL exporters use, in the same words, from the same module.
  // The verdict arrives as a boolean here, read off the compile result's warnings,
  // because the main thread has the mesh but not the solid.
  assertMeshExportWatertight(body, options.watertight, "A 3MF export");

  const scaled = scaleTriangleBuffer(mesh.vertices, body?.transform?.scale);
  const result = await serializeMeshesTo3mf(
    [{ name: sanitizePartId(body?.name ?? body?.id ?? "robotic_part", "robotic_part"), mesh: { vertices: scaled, triangleCount: mesh.triangleCount } }],
    options
  );

  return {
    fileName: threeMfFileNameForBody(body),
    mimeType: "model/3mf",
    data: result.bytes,
    meta: {
      triangleCount: result.triangleCount,
      vertexCount: result.vertexCount,
      objectCount: result.objectCount,
      byteLength: result.bytes.byteLength
    }
  };
}
