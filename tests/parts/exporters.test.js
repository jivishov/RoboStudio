import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import JSZip from "jszip";
import {
  PartExportError,
  compileBodyToStlSolid,
  exportBodyToFormat,
  exportFileNameForBody,
  serializeBodyToBinaryStl,
  serializeBodyToStl,
  stlFileNameForBody
} from "../../src/parts/exporters.js";
import {
  STL_TRIANGLE_BYTES,
  STL_TRIANGLE_OFFSET,
  binaryStlByteLength,
  parseBinaryStl
} from "../../src/parts/exporters/binaryStl.js";
import {
  THREE_MF_CONTENT_TYPES_PATH,
  THREE_MF_ENTRY_DATE,
  THREE_MF_MODEL_PATH,
  THREE_MF_RELS_PATH,
  exportBodyMeshTo3mf,
  indexedMeshFromTriangleSoup,
  scaleTriangleBuffer
} from "../../src/parts/exporters/threeMf.js";
import {
  EXPORT_FORMATS,
  EXPORT_FORMAT_3MF,
  EXPORT_FORMAT_ASCII_STL,
  EXPORT_FORMAT_BINARY_STL,
  EXPORT_FORMAT_DXF,
  EXPORT_FORMAT_STEP,
  bodyExportAvailabilities,
  bodyExportAvailability,
  exportFormat,
  sketchPlaneScale
} from "../../src/parts/exportFormats.js";
import { NON_WATERTIGHT_CODE, assertMeshExportWatertight } from "../../src/parts/watertight.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { solidToMeshData } from "../../src/parts/meshConversion.js";

const { measureBoundingBox } = jscad.measurements;

test("exports a selected generated body as ASCII STL", () => {
  const body = createBodyFromTemplate("servo_mount_plate");
  const stl = serializeBodyToStl(body);

  assert.equal(stlFileNameForBody(body), "servo_mount_plate.stl");
  assert.match(stl, /^solid /);
  assert.match(stl, /facet normal/);
});

test("bakes placement scale into standalone STL dimensions", () => {
  const body = createBodyFromTemplate("base_plate");
  body.transform.scale = [0.5, 2, 1.25];
  const solid = compileBodyToStlSolid(body);
  const [min, max] = measureBoundingBox(solid);

  assert.equal(Number((max[0] - min[0]).toFixed(3)), 60);
  assert.equal(Number((max[1] - min[1]).toFixed(3)), 12);
  assert.equal(Number((max[2] - min[2]).toFixed(3)), 100);
});

test("binary STL is exactly 84 + 50 bytes per triangle, with no ASCII sniff hazard", () => {
  const body = createBodyFromTemplate("base_plate");
  const bytes = serializeBodyToBinaryStl(body);
  const parsed = parseBinaryStl(bytes);

  assert.equal(bytes.byteLength, binaryStlByteLength(parsed.triangleCount));
  assert.equal(bytes.byteLength, STL_TRIANGLE_OFFSET + STL_TRIANGLE_BYTES * parsed.triangleCount);
  // A binary file whose first five bytes are "solid" is read as ASCII by every
  // sniffing parser there is.
  assert.notEqual(String.fromCharCode(...bytes.slice(0, 5)), "solid");
  assert.match(parsed.header, /^RoboStudio/u);
  for (const triangle of parsed.triangles) {
    assert.equal(triangle.attributeByteCount, 0);
  }
});

test("binary and ASCII STL describe the same mesh", () => {
  const body = createBodyFromTemplate("link_bar");
  const parsed = parseBinaryStl(serializeBodyToBinaryStl(body));
  const ascii = serializeBodyToStl(body);
  const asciiFacets = ascii.match(/facet normal/gu)?.length ?? 0;
  const mesh = solidToMeshData(compileBodyToStlSolid(body));

  assert.equal(parsed.triangleCount, mesh.triangleCount);
  assert.equal(parsed.triangleCount, asciiFacets);
  // float32 in the file against float64 in the solid, so bounds agree to the
  // precision the format has and no further.
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(parsed.bounds.min[axis] - mesh.bounds.min[axis]) < 1e-4);
    assert.ok(Math.abs(parsed.bounds.max[axis] - mesh.bounds.max[axis]) < 1e-4);
  }
});

test("binary STL applies placement scale like the ASCII exporter does", () => {
  const body = createBodyFromTemplate("base_plate");
  body.transform.scale = [0.5, 2, 1.25];
  const parsed = parseBinaryStl(serializeBodyToBinaryStl(body));

  assert.equal(Number(parsed.bounds.size[0].toFixed(3)), 60);
  assert.equal(Number(parsed.bounds.size[1].toFixed(3)), 12);
  assert.equal(Number(parsed.bounds.size[2].toFixed(3)), 100);
});

test("a binary STL whose declared count disagrees with its length is refused", () => {
  const bytes = serializeBodyToBinaryStl(createBodyFromTemplate("axle_shaft"));
  const truncated = bytes.slice(0, bytes.byteLength - STL_TRIANGLE_BYTES);

  assert.throws(() => parseBinaryStl(truncated), /declares \d+ triangles/u);
  assert.throws(() => parseBinaryStl(new Uint8Array(12)), /too short/u);
});

test("3MF is a zip whose model parses as millimetre XML matching the mesh", async () => {
  const body = createBodyFromTemplate("base_plate");
  const mesh = solidToMeshData(compileBodyToStlSolid(body));
  const result = await exportBodyMeshTo3mf(body, mesh, { watertight: true });

  assert.equal(result.fileName, "base_plate.3mf");
  const zip = await JSZip.loadAsync(result.data);
  assert.ok(zip.file(THREE_MF_CONTENT_TYPES_PATH), "the content types part is required");
  assert.ok(zip.file(THREE_MF_RELS_PATH), "the package relationships part is required");

  const model = await zip.file(THREE_MF_MODEL_PATH).async("string");
  assert.match(model, /unit="millimeter"/u);
  assert.match(model, /xmlns="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/core\/2015\/02"/u);
  assert.match(model, /<item objectid="1" \/>/u);

  const vertexCount = model.match(/<vertex /gu).length;
  const triangleCount = model.match(/<triangle /gu).length;
  assert.equal(vertexCount, result.meta.vertexCount);
  assert.equal(triangleCount, result.meta.triangleCount);
  assert.equal(triangleCount, mesh.triangleCount);
  // Indexed, not a soup: three unshared vertices per triangle would be 3x this.
  assert.ok(vertexCount < mesh.triangleCount * 3);

  const rels = await zip.file(THREE_MF_RELS_PATH).async("string");
  assert.ok(rels.includes(`/${THREE_MF_MODEL_PATH}`));

  // Exactly the three parts and nothing else. JSZip would otherwise synthesise
  // `_rels/` and `3D/` directory entries, which OPC does not need and which carry
  // a wall-clock date that breaks byte-for-byte reproducibility.
  assert.deepEqual(Object.keys(zip.files).sort(), [THREE_MF_MODEL_PATH, THREE_MF_CONTENT_TYPES_PATH, THREE_MF_RELS_PATH].sort());
});

test("3MF welds vertices and drops degenerate triangles", () => {
  const soup = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    // The same triangle again, so every vertex welds rather than being repeated.
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    // Zero area: two corners are the same point.
    0, 0, 0, 1, 0, 0, 1, 0, 0
  ]);
  const indexed = indexedMeshFromTriangleSoup(soup, 3);

  assert.equal(indexed.points.length, 3);
  assert.equal(indexed.faces.length, 2);
  assert.equal(indexed.degenerateTriangleCount, 1);
});

test("3MF bakes placement scale by scaling the cached mesh", async () => {
  const body = createBodyFromTemplate("base_plate");
  body.transform.scale = [0.5, 2, 1.25];
  // Scaling the triangle buffer is the same as scaling the solid before
  // tessellating, so the two mesh routes cannot disagree on dimensions.
  const scaled = scaleTriangleBuffer(solidToMeshData(compileBodyToStlSolid({ ...body, transform: { ...body.transform, scale: [1, 1, 1] } })).vertices, body.transform.scale);
  const direct = solidToMeshData(compileBodyToStlSolid(body)).vertices;

  assert.equal(scaled.length, direct.length);
  for (let index = 0; index < scaled.length; index += 1) {
    assert.ok(Math.abs(scaled[index] - direct[index]) < 1e-3);
  }

  const result = await exportBodyMeshTo3mf(body, solidToMeshData(compileBodyToStlSolid({ ...body, transform: { ...body.transform, scale: [1, 1, 1] } })), { watertight: true });
  const model = await (await JSZip.loadAsync(result.data)).file(THREE_MF_MODEL_PATH).async("string");
  const xs = [...model.matchAll(/<vertex x="(-?[\d.]+)"/gu)].map((match) => Number(match[1]));
  assert.equal(Number((Math.max(...xs) - Math.min(...xs)).toFixed(3)), 60);
});

test("two 3MF exports of an unchanged body are byte-identical", async () => {
  // The point of a fixed entry date: a diff between two exports means the geometry
  // changed. This failed before the date moved from `generateAsync` - which has no
  // such option and ignored it - onto each `zip.file` call, so every entry carried
  // the wall clock and the two files differed in their timestamp fields alone.
  const body = createBodyFromTemplate("base_plate");
  const mesh = solidToMeshData(compileBodyToStlSolid(body));

  const first = await exportBodyMeshTo3mf(body, mesh, { watertight: true });
  // Zip stores DOS time at two-second resolution, so back-to-back exports would
  // land in the same bucket and pass whether or not the date is pinned. Crossing a
  // bucket boundary is what makes this test able to fail; it is the price of it not
  // being vacuous.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const second = await exportBodyMeshTo3mf(body, mesh, { watertight: true });

  assert.deepEqual(Array.from(second.data), Array.from(first.data));

  // Every entry, not just the model: the synthesised directory entries were the
  // half that survived the first fix.
  const zip = await JSZip.loadAsync(first.data);
  for (const [path, entry] of Object.entries(zip.files)) {
    assert.equal(entry.date.getTime(), THREE_MF_ENTRY_DATE.getTime(), `${path} carries the wall clock`);
  }
});

test("3MF refuses a surface the caller has not established is closed", async () => {
  const body = createBodyFromTemplate("base_plate");
  const mesh = solidToMeshData(compileBodyToStlSolid(body));

  await assert.rejects(() => exportBodyMeshTo3mf(body, mesh, { watertight: false }), /closed surface/u);
  await assert.rejects(() => exportBodyMeshTo3mf(body, null, { watertight: true }), /Build this body/u);
});

test("the mesh export gate refuses an open surface and names the edge count", () => {
  // Every mesh format runs through this one function, so the refusal is worded
  // once. Every body the page can build is closed - `watertight.test.js` proves
  // that for all 20 templates and every boolean - so the gate is exercised here
  // with the report shape the compile produces rather than by trying to coax the
  // compiler into emitting a hole it never emits.
  const body = { id: "open_plate", name: "Open plate" };

  assert.throws(
    () => assertMeshExportWatertight(body, { watertight: false, unmatchedEdgeCount: 4, polygonCount: 5 }, "An STL export"),
    (error) => {
      assert.equal(error.code, NON_WATERTIGHT_CODE);
      assert.match(error.message, /Open plate does not compile to a closed surface \(4 unmatched edges\)/u);
      assert.match(error.message, /an stl export would be unprintable/u);
      return true;
    }
  );

  // An unchecked surface is refused too: a missing answer is not a pass.
  assert.throws(
    () => assertMeshExportWatertight(body, null, "A 3MF export"),
    (error) => {
      assert.equal(error.code, "watertight-unknown");
      assert.match(error.message, /has not been checked/u);
      return true;
    }
  );

  const passing = { watertight: true };
  assert.equal(assertMeshExportWatertight(body, passing), passing);
  assert.equal(assertMeshExportWatertight(body, true), true);
});

test("a mesh export of a real body passes the gate and produces bytes", () => {
  // The other half of the gate: it is consulted on the solid the exporter is about
  // to serialize, not on a cached verdict, and a closed body sails through.
  const plate = createBodyFromTemplate("base_plate");
  assert.ok(serializeBodyToStl(plate).startsWith("solid "));
  assert.ok(serializeBodyToBinaryStl(plate).byteLength > STL_TRIANGLE_OFFSET);
});

test("exportBodyToFormat returns bytes, a file name and a mime type per format", async () => {
  const body = createBodyFromTemplate("base_plate");

  const dxf = await exportBodyToFormat(body, EXPORT_FORMAT_DXF);
  assert.equal(dxf.fileName, "base_plate.dxf");
  assert.equal(dxf.mimeType, "image/vnd.dxf");
  assert.equal(typeof dxf.data, "string");
  assert.equal(dxf.meta.contourCount, 5);

  const binary = await exportBodyToFormat(body, EXPORT_FORMAT_BINARY_STL);
  assert.equal(binary.fileName, "base_plate.stl");
  assert.ok(binary.data instanceof Uint8Array);
  assert.equal(binary.meta.watertight, true);

  const ascii = await exportBodyToFormat(body, EXPORT_FORMAT_ASCII_STL);
  assert.equal(typeof ascii.data, "string");
  assert.equal(ascii.meta.triangleCount, binary.meta.triangleCount);

  // 3MF and STEP are deliberately not worker-side, and the refusal says which.
  await assert.rejects(() => exportBodyToFormat(body, EXPORT_FORMAT_3MF), /not exported through the CAD worker/u);
  await assert.rejects(() => exportBodyToFormat(body, "nonsense"), /Unknown export format/u);
  assert.equal(exportFileNameForBody(body, EXPORT_FORMAT_3MF), "base_plate.3mf");
});

test("DXF availability refuses non-sketch bodies with a reason, never silently", () => {
  const gear = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" } });
  const context = { built: true, valid: true, watertight: true, compiling: false };
  const entries = bodyExportAvailabilities(gear, context);

  assert.equal(entries.length, EXPORT_FORMATS.length);
  const dxf = entries.find((entry) => entry.formatId === EXPORT_FORMAT_DXF);
  assert.equal(dxf.available, false);
  assert.match(dxf.reason, /exact 2D sketch region/u);
  // The mesh formats are still available for the same body, so the menu is not
  // all-or-nothing.
  assert.equal(entries.find((entry) => entry.formatId === EXPORT_FORMAT_BINARY_STL).available, true);
});

test("availability gates mesh formats on watertightness and DXF on validity only", () => {
  const plate = createBodyFromTemplate("base_plate");

  const open = bodyExportAvailabilities(plate, { built: true, valid: true, watertight: false, compiling: false });
  for (const formatId of [EXPORT_FORMAT_ASCII_STL, EXPORT_FORMAT_BINARY_STL, EXPORT_FORMAT_3MF]) {
    const entry = open.find((item) => item.formatId === formatId);
    assert.equal(entry.available, false, `${formatId} needs a closed surface`);
    assert.match(entry.reason, /closed surface/u);
  }
  // DXF comes from the sketch, so an open mesh is none of its business.
  assert.equal(open.find((entry) => entry.formatId === EXPORT_FORMAT_DXF).available, true);

  // DXF does not wait for a build either, but it does wait for validity.
  assert.equal(
    bodyExportAvailability(plate, EXPORT_FORMAT_DXF, { built: false, valid: true, watertight: null }).available,
    true
  );
  assert.match(
    bodyExportAvailability(plate, EXPORT_FORMAT_DXF, { built: true, valid: false, watertight: null }).reason,
    /validation issues/u
  );
  assert.match(
    bodyExportAvailability(plate, EXPORT_FORMAT_BINARY_STL, { built: false, valid: true, watertight: null }).reason,
    /Build this body/u
  );
});

/**
 * ⚠ This test used to be called "STEP stays gated to recipe bodies and to the local
 * backend", and half of it is gone because the gate is gone: cycle 10 gave the bridge an
 * exact payload per body kind, so a sketch plate has a STEP now. What remains is the
 * backend half, asserted in **both** directions - a reason that names the backend when it
 * is absent, and `available: true` when it is present - because an assertion that only
 * ever sees one branch passes on a tree where the other one is unreachable (audit A3).
 */
test("STEP is offered for every body kind and degrades with a reason naming the backend", () => {
  const plate = createBodyFromTemplate("base_plate");
  const recipe = normalizePartBody({
    id: "recipe",
    name: "Recipe",
    source: { kind: "advancedCadRecipe" },
    advancedCadRecipe: { version: 1, units: "mm", operations: [] }
  });

  for (const body of [plate, recipe]) {
    // Present.
    const withBackend = bodyExportAvailability(body, EXPORT_FORMAT_STEP, {
      built: true,
      valid: true,
      backendAvailable: true
    });
    assert.equal(withBackend.available, true, `${body.id} should offer STEP when the bridge answered`);
    assert.equal(withBackend.note, null, "a bridge that answered has nothing left to caveat");

    // Absent.
    const withoutBackend = bodyExportAvailability(body, EXPORT_FORMAT_STEP, {
      built: true,
      valid: true,
      backendAvailable: false
    });
    assert.equal(withoutBackend.available, false);
    assert.match(withoutBackend.reason, /build123d backend/u);

    // Not yet asked, which is neither of the above and must not read as absent.
    const unasked = bodyExportAvailability(body, EXPORT_FORMAT_STEP, { built: true, valid: true });
    assert.equal(unasked.available, true, "an unasked question is not a negative answer");
    assert.match(unasked.note, /has not answered yet/u);
  }
});

test("STEP refuses a body that has no exact solid for a reason about the body", () => {
  const empty = normalizePartBody({ id: "empty", name: "Empty", sketch: { outerProfile: null, cutProfiles: [] } });
  const reason = bodyExportAvailability(empty, EXPORT_FORMAT_STEP, { built: true, valid: true }).reason;
  assert.match(reason, /no outer profile/u);
  assert.doesNotMatch(reason, /backend/u, "a body with nothing to write must not be blamed on a missing bridge");
});

test("a build in progress makes every format unavailable with the same reason", () => {
  const entries = bodyExportAvailabilities(createBodyFromTemplate("base_plate"), {
    built: true,
    valid: true,
    watertight: true,
    compiling: true
  });

  assert.ok(entries.every((entry) => !entry.available));
  assert.ok(entries.every((entry) => entry.reason === "A build is in progress."));
  assert.ok(bodyExportAvailabilities(null, {}).every((entry) => entry.reason === "Select a body to export."));
});

test("PartExportError carries a code the UI can act on", async () => {
  const gear = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" } });
  await assert.rejects(() => exportBodyToFormat(gear, EXPORT_FORMAT_DXF), (error) => {
    assert.ok(error instanceof PartExportError);
    assert.equal(error.code, "export-unavailable");
    return true;
  });
});

/* ------------------------------------------------- G20-G22, the second gap sweep */

test("DXF refuses a sketch body with no outer profile, for a reason about the body", () => {
  // ⚠ G20, a refusal path no test reached. Its STEP twin four tests up is asserted -
  // "no exact solid to write" - and this one, the older of the two, never was. The
  // distinction matters for the same reason cycle 10 removed it from the recipe compiler:
  // a body with nothing to cut must not read as a missing tool.
  const empty = normalizePartBody({ id: "empty", name: "Empty", sketch: { outerProfile: null, cutProfiles: [] } });
  assert.equal(empty.sketch.outerProfile, null, "the normalizer must really allow this state");

  const dxf = bodyExportAvailability(empty, EXPORT_FORMAT_DXF, { built: true, valid: true, watertight: true });
  assert.equal(dxf.available, false);
  assert.match(dxf.reason, /no outer profile to cut/u);
  assert.doesNotMatch(dxf.reason, /backend|install|available/iu, "nothing here is about a missing tool");

  // The other direction, so the branch is shown reachable both ways.
  assert.equal(
    bodyExportAvailability(createBodyFromTemplate("base_plate"), EXPORT_FORMAT_DXF, { built: true, valid: true }).available,
    true
  );
});

test("a placement scale that is not a positive number falls back to 1 on both guards", () => {
  // ⚠ G21. `normalizePartBody` clamps a non-positive scale and `sketchPlaneScale` guards
  // it again, both correctly and neither compared against the other - so the second guard
  // could be dropped and the suite stayed green. It is the guard that matters for a body
  // that reaches an exporter without passing the normalizer, and a zero scale collapses
  // every coordinate in the file while a negative one mirrors the part in silence.
  for (const scale of [[0, 1, 0], [-2, 1, -2], ["x", 1, "x"], [Number.NaN, 1, Number.NaN]]) {
    assert.deepEqual(sketchPlaneScale({ transform: { scale } }), [1, 1], `${JSON.stringify(scale)} is not a scale`);
    // And the normalizer agrees, which is what makes the two a pair rather than two
    // opinions: whatever it stores, the exporter reads back as 1 as well.
    const normalized = normalizePartBody({ ...createBodyFromTemplate("base_plate"), id: "scaled", transform: { scale } });
    assert.deepEqual(sketchPlaneScale(normalized), [1, 1]);
  }
  // A real scale is still carried through, or the assertions above pass on a constant.
  assert.deepEqual(sketchPlaneScale({ transform: { scale: [2, 5, 2] } }), [2, 2]);
});

test("the format table's `binary` flag agrees with the bytes each format actually produces", async () => {
  // ⚠ G22. Nothing in `src/` reads `format.binary` - the serializers take their own
  // `options.binary` - so the field was unread data that no test could contradict, and
  // flipping 3MF to `false` left the suite green. It is a claim about the output, so it
  // is asserted against the output: a binary format hands back bytes and a text one hands
  // back a string, and the download path must not write a zip container as text.
  const body = createBodyFromTemplate("base_plate");
  const produced = new Map([
    [EXPORT_FORMAT_DXF, (await exportBodyToFormat(body, EXPORT_FORMAT_DXF)).data],
    [EXPORT_FORMAT_ASCII_STL, (await exportBodyToFormat(body, EXPORT_FORMAT_ASCII_STL)).data],
    [EXPORT_FORMAT_BINARY_STL, (await exportBodyToFormat(body, EXPORT_FORMAT_BINARY_STL)).data],
    [
      EXPORT_FORMAT_3MF,
      (await exportBodyMeshTo3mf(body, solidToMeshData(compileBodyToStlSolid(body)), { watertight: true })).data
    ]
  ]);

  for (const [formatId, data] of produced) {
    const declared = exportFormat(formatId).binary;
    assert.equal(data instanceof Uint8Array, declared, `${formatId} declares binary: ${declared}`);
    assert.equal(typeof data === "string", !declared);
  }
  // Both values must really occur in the table, or the loop passes on a constant.
  assert.equal(new Set([...produced.keys()].map((id) => exportFormat(id).binary)).size, 2);
  // STEP is deliberately not exercised here: it needs the local build123d bridge, which
  // is absent by default, and a format nothing produced proves nothing about its flag.
});
