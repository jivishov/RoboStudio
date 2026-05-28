import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const STL_DIR = path.join(ROOT_DIR, "stl");
const MANIFEST_PATH = path.join(ROOT_DIR, "manifest.json");
const REPORT_PATH = path.join(ROOT_DIR, "quality-report.json");

function parseVertex(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "vertex" || parts.length !== 4) return null;
  const values = parts.slice(1).map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function triangleArea(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz) / 2;
}

function createBounds() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
}

function includePoint(bounds, point) {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
}

function finalizeBounds(bounds) {
  const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
  return {
    min: bounds.min.map((value) => Number(value.toFixed(3))),
    max: bounds.max.map((value) => Number(value.toFixed(3))),
    size: size.map((value) => Number(value.toFixed(3)))
  };
}

function parseAsciiStl(text) {
  const lines = text.split(/\r?\n/);
  const vertices = [];
  let facetCount = 0;
  let degenerateTriangles = 0;
  const bounds = createBounds();

  for (const line of lines) {
    if (line.trim().startsWith("facet normal")) {
      facetCount += 1;
    }
    const vertex = parseVertex(line);
    if (vertex) {
      vertices.push(vertex);
      includePoint(bounds, vertex);
    }
  }

  for (let index = 0; index + 2 < vertices.length; index += 3) {
    if (triangleArea(vertices[index], vertices[index + 1], vertices[index + 2]) <= 1e-7) {
      degenerateTriangles += 1;
    }
  }

  return {
    facetCount,
    vertexCount: vertices.length,
    degenerateTriangles,
    bounds: finalizeBounds(bounds)
  };
}

function fail(list, message) {
  list.push(message);
}

function withinTolerance(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

function compareBounds(actual, expected, toleranceMm = 0.75) {
  return actual.size.every((value, index) => withinTolerance(value, expected.size[index], toleranceMm));
}

function validateInterfaceChecks(manifest, failures) {
  for (const check of manifest.interfaceChecks ?? []) {
    const tolerance = check.toleranceMm ?? 0.05;
    for (const dimension of check.pairedDimensions ?? []) {
      if (dimension.valuesMm) {
        const [first, ...rest] = dimension.valuesMm;
        if (!Number.isFinite(first) || rest.some((value) => !Number.isFinite(value))) {
          fail(failures, `${check.id}/${dimension.label}: contains a non-finite millimeter value`);
          continue;
        }
        for (const value of rest) {
          if (!withinTolerance(first, value, tolerance)) {
            fail(failures, `${check.id}/${dimension.label}: ${first} does not match ${value} within ${tolerance} mm`);
          }
        }
      }
      if (dimension.values) {
        const [first, ...rest] = dimension.values;
        for (const value of rest) {
          if (first !== value) {
            fail(failures, `${check.id}/${dimension.label}: ${first} does not match ${value}`);
          }
        }
      }
    }
  }
}

function validateManifestBasics(manifest, failures) {
  if (manifest.units !== "millimeters") {
    fail(failures, "manifest.units must be millimeters");
  }
  if (!manifest.originalityStatement?.includes("Existing STL assets were not")) {
    fail(failures, "manifest must include the no-existing-STL-assets originality statement");
  }
  if ((manifest.axisOrder ?? []).length !== 6) {
    fail(failures, "manifest must define exactly six joint axes");
  }
  if (!Array.isArray(manifest.parts) || manifest.parts.length < 12) {
    fail(failures, "manifest must list the generated printable parts");
  }
  const hardware = manifest.hardware ?? {};
  if (hardware.fastener !== "M3") {
    fail(failures, "hardware.fastener must be M3");
  }
  if (hardware.m3ClearanceDiameterMm !== 3.2) {
    fail(failures, "hardware.m3ClearanceDiameterMm must be 3.2");
  }
  if (hardware.jointBoreDiameterMm !== 8.35) {
    fail(failures, "hardware.jointBoreDiameterMm must be 8.35");
  }
  if (hardware.minimumWallMm < 2.4) {
    fail(failures, "hardware.minimumWallMm must be at least 2.4");
  }
}

async function validatePart(part, failures) {
  const stlPath = path.join(STL_DIR, part.fileName);
  let text;
  try {
    text = await fs.readFile(stlPath, "utf8");
  } catch (error) {
    fail(failures, `${part.id}: missing STL file ${part.fileName}`);
    return null;
  }

  if (!text.startsWith("solid")) {
    fail(failures, `${part.id}: expected ASCII STL starting with solid`);
  }

  const parsed = parseAsciiStl(text);
  if (parsed.facetCount < part.minimumTriangleCount) {
    fail(failures, `${part.id}: triangle count ${parsed.facetCount} is below minimum ${part.minimumTriangleCount}`);
  }
  if (parsed.vertexCount !== parsed.facetCount * 3) {
    fail(failures, `${part.id}: vertex count ${parsed.vertexCount} does not match facet count ${parsed.facetCount}`);
  }
  if (parsed.degenerateTriangles > 0) {
    fail(failures, `${part.id}: contains ${parsed.degenerateTriangles} degenerate triangles`);
  }
  if (parsed.bounds.size.some((value) => value <= 1 || value > 220)) {
    fail(failures, `${part.id}: implausible bounds ${parsed.bounds.size.join(" x ")} mm`);
  }
  if (!compareBounds(parsed.bounds, part.boundsMm)) {
    fail(
      failures,
      `${part.id}: STL bounds ${parsed.bounds.size.join(" x ")} mm differ from manifest ${part.boundsMm.size.join(" x ")} mm`
    );
  }

  return {
    id: part.id,
    fileName: part.fileName,
    facetCount: parsed.facetCount,
    vertexCount: parsed.vertexCount,
    boundsMm: parsed.bounds,
    degenerateTriangles: parsed.degenerateTriangles
  };
}

export async function runQualityChecks() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  const failures = [];
  const partResults = [];

  validateManifestBasics(manifest, failures);
  validateInterfaceChecks(manifest, failures);

  for (const part of manifest.parts ?? []) {
    const result = await validatePart(part, failures);
    if (result) partResults.push(result);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    partCount: partResults.length,
    failures,
    parts: partResults
  };
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!report.passed) {
    console.error(`Geometry quality failed with ${failures.length} issue(s).`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return report;
  }

  console.log(`Geometry quality passed for ${partResults.length} generated STL files.`);
  return report;
}

if (process.argv[1] === __filename) {
  await runQualityChecks();
}
