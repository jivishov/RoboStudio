import jscad from "@jscad/modeling";
import { sanitizePartId } from "./contracts.js";
import { compilePartBodyToSolid } from "./cadCompile.js";
import { solidToMeshData } from "./meshConversion.js";

const { scale: scaleSolid } = jscad.transforms;

export function stlFileNameForBody(body) {
  return `${sanitizePartId(body?.name ?? body?.id ?? "robotic_part", "robotic_part")}.stl`;
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

export function serializeBodyToStl(body, options = {}) {
  if (options.binary) throw new Error("Binary STL export is not supported by the browser exporter.");
  const solid = compileBodyToStlSolid(body, { bodies: options.bodies });
  const mesh = solidToMeshData(solid);
  return serializeMeshToAsciiStl(mesh, sanitizePartId(body?.name ?? body?.id ?? "robotic_part", "robotic_part"));
}
