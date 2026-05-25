import { createGeneratedBodyMetadata } from "./contracts.js";

const IDENTITY_MATRIX_WORLD = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function lookupByBodyId(source, bodyId) {
  if (!source) return null;
  if (source instanceof Map) return source.get(bodyId) ?? null;
  return source[bodyId] ?? null;
}

export function createGeneratedPartSnapshot(body, options = {}) {
  const metadata = createGeneratedBodyMetadata(body);
  return {
    ...metadata,
    visible: options.visible ?? true,
    triangles: options.triangles ?? 0,
    bounds: options.bounds ?? {},
    matrixWorld: options.matrixWorld ?? [...IDENTITY_MATRIX_WORLD]
  };
}

export function createGeneratedAssemblySnapshot(options = {}) {
  const bodies = options.bodies ?? [];
  const compileResults = options.compileResults ?? null;
  const matrixWorldById = options.matrixWorldById ?? null;

  return {
    savedAt: options.savedAt ?? new Date().toISOString(),
    glb: options.glb ?? null,
    parts: bodies.map((body) => {
      const compileResult = lookupByBodyId(compileResults, body.id);
      return createGeneratedPartSnapshot(body, {
        triangles: compileResult?.triangleCount ?? 0,
        bounds: compileResult?.bounds ?? {},
        matrixWorld: lookupByBodyId(matrixWorldById, body.id) ?? undefined
      });
    }),
    layout: options.layout ?? null
  };
}
