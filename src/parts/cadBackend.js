/**
 * The capability probe for the optional local build123d bridge.
 *
 * ## Three answers, not two
 *
 * `backendAvailable` was `null` everywhere before cycle 10, with a comment saying
 * static hosting has no bridge so STEP is offered with a reason rather than probed. The
 * consumer was already written - `bodyExportAvailability` has branched on
 * `backendAvailable === false` since cycle 04 - and had no producer.
 *
 * A real probe has **three** states and the difference between two of them is the whole
 * point: *available*, *absent*, and **not yet asked**. A page that says "the build123d
 * backend is unavailable" before it has looked is asserting something it does not know.
 * That is audit A2 in prose rather than in digits - the same defect as cycle 04's
 * fabricated `0` volume and cycle 05's `0.000 cm³` card - and it reads to a user exactly
 * like a measured absence.
 *
 * ## And a fourth distinction, which the bridge already draws
 *
 * *Absent* and *present but failing* are different sentences, and the bridge tells them
 * apart already: `advanced-cad-backend-unavailable` when build123d will not import or
 * the child will not spawn, `advanced-cad-timeout`, `advanced-cad-backend-error` for
 * non-JSON stdout, `advanced-cad-compile-error`, `invalid-json`,
 * `advanced-cad-request-error`. Flattening six outcomes into a boolean is where the
 * only diagnostic a user can act on gets thrown away, so this module carries the code
 * through and **invents no seventh one**. What it adds is `reachable`, which is not a
 * code but an observation: whether anything answered at all.
 *
 * ## What a failed probe is not
 *
 * It is not an error to report. On GitHub Pages the bridge is *correctly* absent, which
 * is the documented deployment. The badge says so and nothing appears in the Build or
 * Manufacturability lists.
 *
 * ## Cheap, cached, and never in a render path
 *
 * `renderExportMenu` runs on every render. A probe that awaited a Python spawn there
 * would make the export menu wait on a subprocess, so the probe is asynchronous, its
 * result is cached, and every render reads the **cached snapshot only** - which is why
 * `snapshot()` is synchronous and `probe()` is the only thing that awaits.
 *
 * The request compiles a 1 mm box and asks for **no artefacts at all**: no STEP, no
 * STL, no mesh. That exercises the whole chain - spawn, import build123d, build a part -
 * for the cost of the spawn, and it is the cheapest request that can distinguish "the
 * bridge is there" from "the bridge is there and build123d is not".
 */

import { DEFAULT_CHORD_TOLERANCE_MM } from "./tessellation.js";

export const CAD_BACKEND_STATE_UNKNOWN = "unknown";
export const CAD_BACKEND_STATE_AVAILABLE = "available";
export const CAD_BACKEND_STATE_UNAVAILABLE = "unavailable";

export const CAD_BACKEND_STATES = Object.freeze([
  CAD_BACKEND_STATE_UNKNOWN,
  CAD_BACKEND_STATE_AVAILABLE,
  CAD_BACKEND_STATE_UNAVAILABLE
]);

/**
 * The bridge's own vocabulary, listed so a test can assert nothing else is produced.
 *
 * Sources, one per code: `robostudio_build123d_backend.py`'s import guard and compile
 * catch, and `advancedCadMiddleware.js`'s spawn error, timeout, non-JSON stdout and
 * request-body guards.
 */
export const CAD_BACKEND_CODES = Object.freeze([
  "advanced-cad-backend-unavailable",
  "advanced-cad-timeout",
  "advanced-cad-backend-error",
  "advanced-cad-compile-error",
  "advanced-cad-request-error",
  "invalid-json"
]);

export const CAD_COMPILE_URL = "/api/cad/compile";

/**
 * How long a failed probe is trusted.
 *
 * A success is permanent for the session: a bridge that answered once is not going to
 * stop being the deployment it is. A failure expires, because the most likely reason for
 * one on a developer's machine is that `npm run dev` was started before the Python
 * environment was ready, and a user who fixes that should not have to reload the page.
 */
export const CAD_BACKEND_FAILURE_TTL_MS = 30_000;

/**
 * The cheapest recipe that still exercises the whole chain.
 *
 * Written as a literal rather than through `exactBodyCompileRequest`, which is the one
 * duplication in this module and is deliberate: importing `backendPayload.js` would pull
 * `gears.js` and therefore `@jscad/modeling` into a module whose only job is to ask
 * whether a subprocess answers. `backendParity.test.js` asserts this literal is the shape
 * the builder produces, so the two cannot drift silently.
 */
function probePayload() {
  return {
    payloadVersion: 1,
    units: "mm",
    // Carried even though the probe asks for no mesh, so this literal is the same shape
    // `exactBodyCompileRequest` produces and the parity test can say so field by field.
    // `tessellation.js` is a leaf module with no imports of its own, so reading the
    // constant here costs this module none of the independence the comment above claims.
    toleranceMm: DEFAULT_CHORD_TOLERANCE_MM,
    exactBody: {
      id: "capability_probe",
      name: "Capability probe",
      scale: [1, 1, 1],
      kind: "advancedCadRecipe",
      fidelity: "exact",
      advancedCadRecipe: {
        version: 1,
        units: "mm",
        operations: [{ id: "probe_box", type: "box", mode: "add", center: [0, 0, 0], size: [1, 1, 1] }]
      }
    },
    includeStep: false,
    includeStl: false,
    includeMesh: false
  };
}

const UNKNOWN_SNAPSHOT = Object.freeze({
  state: CAD_BACKEND_STATE_UNKNOWN,
  code: null,
  message: null,
  reachable: null,
  checkedAt: null
});

/**
 * Interpret one bridge response.
 *
 * Exported for the tests, because the mapping from six codes plus two transport
 * failures onto three states is the part worth asserting and it needs no network.
 */
export function interpretCadBackendResponse({ ok, status, result, transportError } = {}) {
  if (transportError) {
    // Nothing answered. On Pages this is the correct outcome and not a fault: there is
    // no middleware, so the POST is served the SPA or a 404 and never reaches Python.
    return {
      state: CAD_BACKEND_STATE_UNAVAILABLE,
      code: "advanced-cad-backend-unavailable",
      message:
        "No local build123d bridge answered. That is expected on static hosting, where "
        + "the Vite middleware does not exist.",
      reachable: false
    };
  }
  if (!result || typeof result !== "object") {
    return {
      state: CAD_BACKEND_STATE_UNAVAILABLE,
      code: "advanced-cad-backend-error",
      message: `The CAD bridge answered ${status ?? "an unknown status"} without JSON, so it is present but not usable.`,
      reachable: false
    };
  }
  if (ok && result.ok) {
    return { state: CAD_BACKEND_STATE_AVAILABLE, code: null, message: null, reachable: true };
  }
  // The bridge answered and said no. Its code and sentence are the diagnostic, so they
  // are carried through rather than replaced by a generic one.
  //
  // ⚠ `reachable` is derived from the code, never assumed. It used to be hard-coded
  // `true` here, and this branch also carries the case where **nothing ran at all** - a
  // spawn `ENOENT` when the configured interpreter does not exist. `describeCadBackend`
  // words its sentence from this flag, so a missing interpreter was announced as "the
  // bridge is present but not usable", and a missing library produced the self-
  // contradiction "is present but not usable: build123d is not installed". Absent and
  // present-but-failing are the two things this field exists to tell apart.
  const code = CAD_BACKEND_CODES.includes(result.code) ? result.code : "advanced-cad-backend-error";
  return {
    state: CAD_BACKEND_STATE_UNAVAILABLE,
    code,
    message: result.message ?? "The local build123d bridge refused the capability probe.",
    reachable: code !== "advanced-cad-backend-unavailable"
  };
}

/**
 * A cached, non-blocking probe.
 *
 * `fetchImpl` and `now` are injected so the whole thing is testable without a network
 * and without a clock, which is also what keeps this module free of the DOM.
 */
export function createCadBackendProbe(options = {}) {
  const fetchImpl = options.fetch ?? (typeof fetch === "function" ? fetch : null);
  const url = options.url ?? CAD_COMPILE_URL;
  const now = options.now ?? (() => Date.now());
  const failureTtlMs = options.failureTtlMs ?? CAD_BACKEND_FAILURE_TTL_MS;

  let snapshot = UNKNOWN_SNAPSHOT;
  let inFlight = null;

  function expired() {
    if (snapshot.state !== CAD_BACKEND_STATE_UNAVAILABLE) return false;
    return now() - (snapshot.checkedAt ?? 0) >= failureTtlMs;
  }

  async function request() {
    if (!fetchImpl) {
      return interpretCadBackendResponse({ transportError: new Error("No fetch implementation is available.") });
    }
    let response = null;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(probePayload())
      });
    } catch (error) {
      return interpretCadBackendResponse({ transportError: error });
    }
    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    return interpretCadBackendResponse({ ok: response.ok, status: response.status, result });
  }

  return {
    /** The cached answer. Synchronous, so a render may call it. Never triggers a probe. */
    snapshot() {
      if (expired()) return UNKNOWN_SNAPSHOT;
      return snapshot;
    },

    /**
     * `true`, `false`, or `null` for not yet asked - the shape `exportFormats.js` reads.
     *
     * `null` is deliberately not `false`. See the A2 note at the top of this file.
     */
    available() {
      const current = this.snapshot();
      if (current.state === CAD_BACKEND_STATE_AVAILABLE) return true;
      if (current.state === CAD_BACKEND_STATE_UNAVAILABLE) return false;
      return null;
    },

    /** Ask, at most once at a time, and cache. Safe to call on a menu open. */
    async probe() {
      if (!expired() && snapshot.state !== CAD_BACKEND_STATE_UNKNOWN) return snapshot;
      if (inFlight) return inFlight;
      inFlight = request()
        .then((outcome) => {
          snapshot = Object.freeze({ ...outcome, checkedAt: now() });
          return snapshot;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },

    /** Forget the cached answer. For tests, and for a user-driven retry. */
    reset() {
      snapshot = UNKNOWN_SNAPSHOT;
      inFlight = null;
    }
  };
}

/**
 * The sentence the UI shows for a backend state, or `null` when there is nothing to say.
 *
 * One function so the export menu, the Build panel and a badge cannot drift into three
 * different descriptions of the same three states.
 */
export function describeCadBackend(snapshot) {
  if (!snapshot || snapshot.state === CAD_BACKEND_STATE_UNKNOWN) {
    return "The local build123d bridge has not been checked yet.";
  }
  if (snapshot.state === CAD_BACKEND_STATE_AVAILABLE) {
    return "The local build123d bridge answered, so exact STEP is available.";
  }
  // ⚠ A timeout is neither absence nor breakage, and it used to be told as absence -
  // "not available on static hosting" for a bridge that was installed, working, and
  // merely cold. Importing build123d and OCP costs about ten seconds on a cold cache,
  // so the first probe after a boot can exceed the compile budget. Say what happened.
  if (snapshot.code === "advanced-cad-timeout") {
    return "The local build123d bridge did not answer in time. It is installed, but the first "
      + "compile after a restart can be slow while build123d loads; try again in a moment.";
  }
  // Present, and broken. Only for codes that mean something really answered.
  if (snapshot.reachable) {
    return `The local build123d bridge is present but not usable: ${snapshot.message}`;
  }
  return snapshot.message;
}
