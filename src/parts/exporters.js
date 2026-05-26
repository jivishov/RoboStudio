import stlSerializer from "@jscad/stl-serializer";
import jscad from "@jscad/modeling";
import { sanitizePartId } from "./contracts.js";
import { compilePartBodyToSolid } from "./cadCompile.js";

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

export function serializeBodyToStl(body, options = {}) {
  const solid = compileBodyToStlSolid(body, { bodies: options.bodies });
  const [serialized] = stlSerializer.serialize({ binary: options.binary ?? false }, solid);
  return serialized;
}
