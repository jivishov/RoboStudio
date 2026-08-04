import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCompileOutcome,
  bodyCompileSignature,
  bodyCompileSignatures,
  compileCacheErrors,
  compileCacheResults,
  compileCacheWarnings,
  compileDependencyIds,
  createCompileCache,
  planBodyCompile,
  pruneCompileCache
} from "../../src/parts/compileCache.js";
import { normalizePartProject } from "../../src/parts/projectState.js";
import { createBooleanOperationBody } from "../../src/parts/featureOps.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

function project(bodies) {
  return normalizePartProject({ bodies }).bodies;
}

function twoPlates() {
  const existingIds = new Set();
  const first = createBodyFromTemplate("base_plate", { existingIds });
  existingIds.add(first.id);
  const second = createBodyFromTemplate("link_bar", { existingIds });
  return project([first, second]);
}

function plateAndBooleanOf(bodies) {
  const boolean = createBooleanOperationBody("subtract", bodies, { id: "cut_result" }, new Set(bodies.map((b) => b.id)));
  return project([...bodies, boolean]);
}

function compileEverything(bodies, cache) {
  const { signatures, staleBodyIds } = planBodyCompile(bodies, cache);
  applyCompileOutcome(cache, {
    signatures,
    bodyIds: staleBodyIds,
    results: staleBodyIds.map((bodyId) => ({ bodyId, triangleCount: 12, warnings: [] })),
    errors: []
  });
  return staleBodyIds;
}

test("a fresh cache leaves every body stale, and a compiled cache leaves none", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();

  assert.deepEqual(planBodyCompile(bodies, cache).staleBodyIds, bodies.map((body) => body.id));
  compileEverything(bodies, cache);
  assert.deepEqual(planBodyCompile(bodies, cache).staleBodyIds, []);
  assert.deepEqual(planBodyCompile(bodies, cache).cachedBodyIds, bodies.map((body) => body.id));
});

test("editing one body of many recompiles that body only", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();
  compileEverything(bodies, cache);

  const edited = project(bodies.map((body, index) => (
    index === 0 ? { ...body, extrudeDepthMm: body.extrudeDepthMm + 2 } : body
  )));

  const { staleBodyIds } = planBodyCompile(edited, cache);
  assert.deepEqual(staleBodyIds, [bodies[0].id]);
});

test("name, colour, transform and material are not compile inputs", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();
  compileEverything(bodies, cache);

  const touched = project(bodies.map((body) => ({
    ...body,
    name: `${body.name} renamed`,
    color: "#123456",
    materialId: "petg",
    transform: { ...body.transform, position: [10, 0, 0], scale: [2, 2, 2] }
  })));

  // The autosave fingerprint covers all four of these; the compile signature must not,
  // or a rename would rebuild the project.
  assert.deepEqual(planBodyCompile(touched, cache).staleBodyIds, []);
});

test("a boolean body's signature includes its operands, so an operand edit invalidates it", () => {
  const plates = twoPlates();
  const bodies = plateAndBooleanOf(plates);
  const cache = createCompileCache();
  compileEverything(bodies, cache);
  assert.deepEqual(planBodyCompile(bodies, cache).staleBodyIds, []);

  const edited = project(bodies.map((body) => (
    body.id === plates[1].id ? { ...body, extrudeDepthMm: body.extrudeDepthMm + 1 } : body
  )));

  // The boolean body's own fields did not change at all - only what it is built from.
  const { staleBodyIds } = planBodyCompile(edited, cache);
  assert.deepEqual(staleBodyIds.sort(), [plates[1].id, "cut_result"].sort());
});

test("an operand that is only renamed does not invalidate the boolean body", () => {
  const plates = twoPlates();
  const bodies = plateAndBooleanOf(plates);
  const cache = createCompileCache();
  compileEverything(bodies, cache);

  const renamed = project(bodies.map((body) => (
    body.id === plates[0].id ? { ...body, name: "Renamed operand" } : body
  )));

  assert.deepEqual(planBodyCompile(renamed, cache).staleBodyIds, []);
});

test("dependency ids come from boolean operands and nowhere else", () => {
  const plates = twoPlates();
  const bodies = plateAndBooleanOf(plates);

  assert.deepEqual(compileDependencyIds(bodies[0]), []);
  assert.deepEqual(compileDependencyIds(bodies[2]), plates.map((body) => body.id));
});

test("a boolean body that references a missing or circular operand still hashes stably", () => {
  const dangling = project([
    createBooleanOperationBody("union", [{ id: "ghost_a" }, { id: "ghost_b" }], { id: "orphan" }, new Set())
  ]);
  const first = bodyCompileSignatures(dangling).get("orphan");
  assert.equal(typeof first, "string");
  assert.equal(bodyCompileSignatures(dangling).get("orphan"), first);

  // Self-reference through the operand list is rejected by validation, but the cache
  // must not recurse forever before validation gets a chance to say so.
  const cyclic = [
    { id: "a", source: { kind: "booleanOperation" }, boolean: { operation: "union", operandBodyIds: ["b", "b"] } },
    { id: "b", source: { kind: "booleanOperation" }, boolean: { operation: "union", operandBodyIds: ["a", "a"] } }
  ];
  const signatures = bodyCompileSignatures(cyclic);
  assert.equal(typeof signatures.get("a"), "string");
  assert.equal(typeof signatures.get("b"), "string");
});

test("a request already in flight is not scheduled again", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();
  const { signatures, staleBodyIds } = planBodyCompile(bodies, cache);
  const inFlight = new Map(staleBodyIds.map((bodyId) => [bodyId, signatures.get(bodyId)]));

  assert.deepEqual(planBodyCompile(bodies, cache, inFlight).staleBodyIds, []);

  // Editing a body in flight makes it stale again: the pending result is for old input.
  const edited = project(bodies.map((body, index) => (
    index === 0 ? { ...body, extrudeDepthMm: 9 } : body
  )));
  assert.deepEqual(planBodyCompile(edited, cache, inFlight).staleBodyIds, [bodies[0].id]);
});

test("failed compiles are cached, so a broken body is not retried on every render", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();
  const { signatures, staleBodyIds } = planBodyCompile(bodies, cache);

  const { unassignedErrors } = applyCompileOutcome(cache, {
    signatures,
    bodyIds: staleBodyIds,
    results: [{ bodyId: bodies[0].id, triangleCount: 4, warnings: [] }],
    errors: [
      { bodyId: bodies[1].id, code: "cad-compile-error", message: "nope", issues: [] },
      { bodyId: null, code: "worker-error", message: "worker died", issues: [] }
    ]
  });

  assert.deepEqual(planBodyCompile(bodies, cache).staleBodyIds, []);
  assert.deepEqual([...compileCacheResults(cache, bodies).keys()], [bodies[0].id]);
  assert.deepEqual(compileCacheErrors(cache, bodies).map((error) => error.bodyId), [bodies[1].id]);
  assert.deepEqual(unassignedErrors.map((error) => error.code), ["worker-error"]);
});

test("a requested body that comes back with neither result nor error is recorded as failed", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();
  const { signatures, staleBodyIds } = planBodyCompile(bodies, cache);

  applyCompileOutcome(cache, { signatures, bodyIds: staleBodyIds, results: [], errors: [] });

  assert.deepEqual(
    compileCacheErrors(cache, bodies).map((error) => error.code),
    ["missing-compile-result", "missing-compile-result"]
  );
  // Recorded, not left stale: silently re-requesting forever would be worse.
  assert.deepEqual(planBodyCompile(bodies, cache).staleBodyIds, []);
});

test("warnings ride along with cached results and are attributed to their body", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();
  const { signatures, staleBodyIds } = planBodyCompile(bodies, cache);
  applyCompileOutcome(cache, {
    signatures,
    bodyIds: staleBodyIds,
    results: [
      { bodyId: bodies[0].id, warnings: [{ code: "disconnected-solid", message: "two lumps", severity: "warning" }] },
      { bodyId: bodies[1].id, warnings: [] }
    ],
    errors: []
  });

  assert.deepEqual(compileCacheWarnings(cache, bodies), [
    { code: "disconnected-solid", message: "two lumps", severity: "warning", bodyId: bodies[0].id }
  ]);
});

test("deleting a body drops its cache entry", () => {
  const bodies = twoPlates();
  const cache = createCompileCache();
  compileEverything(bodies, cache);

  const remaining = [bodies[0]];
  assert.deepEqual(pruneCompileCache(cache, remaining), [bodies[1].id]);
  assert.equal(cache.size, 1);
  assert.deepEqual(planBodyCompile(remaining, cache).staleBodyIds, []);
});

test("single-body signatures are stable across calls and differ between bodies", () => {
  const bodies = twoPlates();
  assert.equal(bodyCompileSignature(bodies[0], bodies), bodyCompileSignature(bodies[0], bodies));
  assert.notEqual(bodyCompileSignature(bodies[0], bodies), bodyCompileSignature(bodies[1], bodies));
});
