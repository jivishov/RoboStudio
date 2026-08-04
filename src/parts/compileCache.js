/**
 * Per-body CAD compile cache.
 *
 * The page used to rehash the whole project and recompile every body on every
 * edit, so a ten-body project paid for ten compiles to move one hole. This module
 * owns the change detection instead: a body is recompiled when its own compile
 * signature changes, and everything else is served from cache.
 *
 * **A per-body signature is not enough on its own.** A `booleanOperation` body is
 * built from other bodies (`AGENTS.md:38` requires the whole body list at compile
 * time for exactly that reason), so editing an operand changes the boolean's
 * geometry while leaving the boolean's own fields untouched. Signatures are
 * therefore computed over the dependency closure: a boolean body's signature
 * includes its operands' signatures, recursively.
 *
 * This is deliberately **not** the autosave fingerprint. The two change detectors
 * answer different questions and must stay separate: a rename or a colour change
 * has to save without recompiling, and a material change has to do neither.
 * `name`, `color`, `transform` and `materialId` are absent here on purpose.
 *
 * DOM-free and worker-free, so it is unit-testable in `node:test`.
 */

import { BOOLEAN_OPERATION_KIND } from "./contracts.js";

/**
 * The fields that decide compiled geometry. Anything absent from this list is,
 * by construction, a change that does not trigger a recompile.
 *
 * ## `processId` is still absent, and cycle 09 re-decided that rather than inheriting it
 *
 * Cycle 06 excluded it because manufacturability is a report about geometry and never
 * an input to it. Cycle 09 introduced kerf and printer compensation, which could have
 * made that premise false: if the compiled solid were the part the machine will make
 * rather than the part that was drawn, then two processes would mean two solids and
 * this list would have to gain `processId`.
 *
 * **It does not, because the compiled solid stayed nominal.** Compensation is a derived
 * report - `bodyCompensationReport` in `cadCompile.js` - for a reason that decided
 * itself: STL and 3MF export from this cached solid, and a compensated cache would
 * have shipped a pre-shrunk mesh to a slicer that applies its own compensation, twice.
 * Cycle 09's own plan says an export goes out uncompensated.
 *
 * The pair is therefore "changes neither", which is one of the two green states: a
 * process change alters no compiled solid and invalidates no cache entry. The state to
 * avoid was the mixed one - compensating the solid while leaving `processId` out of
 * this list - which would not have failed a single test. The user would switch to
 * laser, the cache would serve the printed solid, and the symptom would be a stale
 * preview. `cadCompile.test.js` asserts both halves in both directions so the pair
 * cannot drift apart later.
 *
 * `materialId` remains absent for cycle 06's original reason: a material change moves
 * the printed mass and touches no geometry. Density is not kerf.
 */
export const COMPILE_SIGNATURE_FIELDS = Object.freeze([
  "id",
  "source",
  "sketch",
  "extrudeDepthMm",
  "revolve",
  "gear",
  "boolean",
  "advancedCadRecipe"
]);

/** The body IDs whose geometry this body is built from. */
export function compileDependencyIds(body) {
  if ((body?.source?.kind ?? null) !== BOOLEAN_OPERATION_KIND) return [];
  return (body?.boolean?.operandBodyIds ?? []).filter(Boolean);
}

/** The compile-relevant fields of one body, ignoring what it is built from. */
export function bodyOwnCompileFields(body) {
  const fields = {};
  for (const key of COMPILE_SIGNATURE_FIELDS) {
    fields[key] = body?.[key];
  }
  return fields;
}

function resolveSignature(bodyId, bodyMap, memo, stack) {
  const cached = memo.get(bodyId);
  if (cached !== undefined) return cached;

  const body = bodyMap.get(bodyId);
  if (!body) return JSON.stringify({ missing: bodyId });
  // A cycle is a permanent property of this body list, and the compile itself
  // rejects it, so it hashes to a stable marker rather than recursing forever.
  if (stack.has(bodyId)) return JSON.stringify({ cycle: bodyId });

  stack.add(bodyId);
  const dependencies = compileDependencyIds(body).map((id) => resolveSignature(id, bodyMap, memo, stack));
  stack.delete(bodyId);

  const signature = JSON.stringify({
    own: bodyOwnCompileFields(body),
    dependencies
  });
  memo.set(bodyId, signature);
  return signature;
}

/**
 * Dependency-aware compile signature for one body, given the whole body list.
 */
export function bodyCompileSignature(body, bodies = null) {
  return bodyCompileSignatures(bodies ?? [body]).get(body?.id) ?? null;
}

/** Dependency-aware compile signatures for every body, keyed by body ID. */
export function bodyCompileSignatures(bodies = []) {
  const bodyMap = new Map((bodies ?? []).filter(Boolean).map((body) => [body.id, body]));
  const memo = new Map();
  const signatures = new Map();
  for (const body of bodyMap.values()) {
    signatures.set(body.id, resolveSignature(body.id, bodyMap, memo, new Set()));
  }
  return signatures;
}

/**
 * A cache entry records the signature it was produced from plus its outcome.
 * A failed compile is cached too: without that, a body that cannot compile is
 * retried on every render for as long as it stays broken.
 */
export function createCompileCache() {
  return new Map();
}

/**
 * Which bodies need compiling, given the cache and anything already in flight.
 */
export function planBodyCompile(bodies = [], cache = new Map(), inFlightSignatures = new Map()) {
  const signatures = bodyCompileSignatures(bodies);
  const staleBodyIds = [];
  const cachedBodyIds = [];

  for (const body of bodies ?? []) {
    const signature = signatures.get(body.id);
    if (cache.get(body.id)?.signature === signature) {
      cachedBodyIds.push(body.id);
      continue;
    }
    if (inFlightSignatures.get(body.id) === signature) continue;
    staleBodyIds.push(body.id);
  }

  return { signatures, staleBodyIds, cachedBodyIds };
}

/**
 * Fold a worker response into the cache.
 *
 * `bodyIds` is what was asked for, so a body that came back with neither a result
 * nor an error is recorded as a failure rather than silently left stale.
 * Errors with no `bodyId` belong to no body and are handed back to the caller.
 */
export function applyCompileOutcome(cache, options = {}) {
  const signatures = options.signatures ?? new Map();
  const bodyIds = options.bodyIds ?? [];
  const resultsById = new Map((options.results ?? []).map((result) => [result.bodyId, result]));
  const errorsById = new Map();
  const unassignedErrors = [];

  for (const error of options.errors ?? []) {
    if (error?.bodyId) errorsById.set(error.bodyId, error);
    else unassignedErrors.push(error);
  }

  for (const bodyId of bodyIds) {
    const signature = signatures.get(bodyId);
    if (signature === undefined) continue;
    const result = resultsById.get(bodyId) ?? null;
    const error = result
      ? null
      : errorsById.get(bodyId) ?? {
          bodyId,
          code: "missing-compile-result",
          message: "The CAD worker returned no result for this body.",
          issues: []
        };
    cache.set(bodyId, { signature, result, error });
  }

  return { unassignedErrors };
}

/** Drop cache entries for bodies that no longer exist. */
export function pruneCompileCache(cache, bodies = []) {
  const liveIds = new Set((bodies ?? []).map((body) => body?.id));
  const removed = [];
  for (const bodyId of [...cache.keys()]) {
    if (liveIds.has(bodyId)) continue;
    cache.delete(bodyId);
    removed.push(bodyId);
  }
  return removed;
}

/** Successful compile results in project body order. */
export function compileCacheResults(cache, bodies = []) {
  const results = new Map();
  for (const body of bodies ?? []) {
    const result = cache.get(body?.id)?.result ?? null;
    if (result) results.set(body.id, result);
  }
  return results;
}

/** Cached compile errors in project body order. */
export function compileCacheErrors(cache, bodies = []) {
  const errors = [];
  for (const body of bodies ?? []) {
    const error = cache.get(body?.id)?.error ?? null;
    if (error) errors.push(error);
  }
  return errors;
}

/** Warnings reported alongside cached results, such as disconnected solids. */
export function compileCacheWarnings(cache, bodies = []) {
  const warnings = [];
  for (const body of bodies ?? []) {
    for (const warning of cache.get(body?.id)?.result?.warnings ?? []) {
      warnings.push({ ...warning, bodyId: body.id });
    }
  }
  return warnings;
}
