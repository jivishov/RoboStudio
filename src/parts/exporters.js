import stlSerializer from "@jscad/stl-serializer";
import { sanitizePartId } from "./contracts.js";
import { compilePartBodyToSolid } from "./cadCompile.js";

export function stlFileNameForBody(body) {
  return `${sanitizePartId(body?.name ?? body?.id ?? "robotic_part", "robotic_part")}.stl`;
}

export function serializeBodyToStl(body, options = {}) {
  const solid = compilePartBodyToSolid(body, { bodies: options.bodies });
  const [serialized] = stlSerializer.serialize({ binary: options.binary ?? false }, solid);
  return serialized;
}
