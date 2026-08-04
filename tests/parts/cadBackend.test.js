import assert from "node:assert/strict";
import test from "node:test";

import {
  CAD_BACKEND_CODES,
  CAD_BACKEND_STATE_AVAILABLE,
  CAD_BACKEND_STATE_UNAVAILABLE,
  CAD_BACKEND_STATE_UNKNOWN,
  createCadBackendProbe,
  describeCadBackend,
  interpretCadBackendResponse
} from "../../src/parts/cadBackend.js";

/**
 * A fetch that answers with one JSON body, and counts how often it was asked.
 *
 * The count is the point of half these tests: a probe that is cheap in principle and
 * called on every render is not cheap.
 */
function stubFetch(responses) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return {
      ok: next.ok !== false,
      status: next.status ?? (next.ok === false ? 503 : 200),
      json: async () => next.body
    };
  };
  impl.calls = calls;
  return impl;
}

function clock(start = 0) {
  const state = { now: start };
  return { now: () => state.now, advance: (ms) => { state.now += ms; } };
}

test("three states, and not yet asked is not absent", () => {
  const probe = createCadBackendProbe({ fetch: stubFetch({ body: { ok: true } }) });

  // A2 in prose: before anything has looked, the honest answer is that we do not know.
  assert.equal(probe.snapshot().state, CAD_BACKEND_STATE_UNKNOWN);
  assert.equal(probe.available(), null);
  assert.notEqual(probe.available(), false, "an unasked question must never read as a negative answer");
  assert.match(describeCadBackend(probe.snapshot()), /not been checked yet/u);
});

test("a bridge that answers is available, and one that never answers is absent with a reason", async () => {
  const good = createCadBackendProbe({ fetch: stubFetch({ body: { ok: true } }) });
  await good.probe();
  assert.equal(good.available(), true);
  assert.equal(good.snapshot().state, CAD_BACKEND_STATE_AVAILABLE);
  assert.equal(good.snapshot().reachable, true);
  assert.match(describeCadBackend(good.snapshot()), /exact STEP is available/u);

  const pages = createCadBackendProbe({ fetch: stubFetch(new TypeError("Failed to fetch")) });
  await pages.probe();
  assert.equal(pages.available(), false);
  assert.equal(pages.snapshot().reachable, false, "nothing answered, so nothing is present");
  // On Pages this is the correct outcome and not a fault, and the sentence says so.
  assert.match(describeCadBackend(pages.snapshot()), /expected on static hosting/u);
});

test("absent and present-but-failing are different sentences", () => {
  const absent = interpretCadBackendResponse({ transportError: new Error("no route") });
  // ⚠ Re-based, not deleted. This test's intent was always right and its fixture was
  // wrong: it used `advanced-cad-backend-unavailable` carrying "build123d is not
  // installed" as its *present-but-failing* case, and asserted `reachable: true` and the
  // wording "present but not usable" for it. That is the defect, written down as an
  // expectation - a library that is not installed is **absent**, and the sentence it
  // produced read "is present but not usable: build123d is not installed".
  //
  // The present-but-failing case is now a bridge that really answered and then failed.
  // The absent half of the test is unchanged.
  const broken = interpretCadBackendResponse({
    ok: true,
    result: {
      ok: false,
      code: "advanced-cad-compile-error",
      message: "OCCT could not fillet that edge set."
    }
  });

  assert.equal(absent.state, CAD_BACKEND_STATE_UNAVAILABLE);
  assert.equal(broken.state, CAD_BACKEND_STATE_UNAVAILABLE);
  // Same state, different diagnosis - which is the whole reason `reachable` exists
  // beside `state`. Flattening six bridge outcomes into one boolean is where the only
  // thing a user can act on gets thrown away.
  assert.equal(absent.reachable, false);
  assert.equal(broken.reachable, true);
  assert.match(describeCadBackend({ ...broken, state: CAD_BACKEND_STATE_UNAVAILABLE }), /present but not usable/u);
  assert.match(describeCadBackend({ ...broken, state: CAD_BACKEND_STATE_UNAVAILABLE }), /OCCT could not fillet/u);
  assert.notEqual(describeCadBackend(absent), describeCadBackend({ ...broken }));
});

test("the bridge's own codes are carried through, and no seventh one is invented", () => {
  for (const code of CAD_BACKEND_CODES) {
    const outcome = interpretCadBackendResponse({ ok: false, status: 503, result: { ok: false, code, message: "x" } });
    assert.equal(outcome.code, code, `${code} must survive the probe`);
  }
  // A code the bridge does not publish is normalized rather than passed on, so the UI
  // cannot end up quoting a vocabulary nothing produces.
  const invented = interpretCadBackendResponse({
    ok: false,
    status: 503,
    result: { ok: false, code: "something-new", message: "x" }
  });
  assert.equal(invented.code, "advanced-cad-backend-error");
  assert.ok(CAD_BACKEND_CODES.includes(invented.code));

  // A 200 that is not JSON is a present-but-unusable bridge, not an absent one.
  const notJson = interpretCadBackendResponse({ ok: true, status: 200, result: null });
  assert.equal(notJson.state, CAD_BACKEND_STATE_UNAVAILABLE);
  assert.match(notJson.message, /without JSON/u);
});

test("the probe is cached, asks once at a time, and never blocks a render", async () => {
  const fetchImpl = stubFetch({ body: { ok: true } });
  const probe = createCadBackendProbe({ fetch: fetchImpl });

  // Concurrent callers share one in-flight request.
  await Promise.all([probe.probe(), probe.probe(), probe.probe()]);
  assert.equal(fetchImpl.calls.length, 1);

  // And a success is permanent for the session.
  await probe.probe();
  assert.equal(fetchImpl.calls.length, 1);

  // `snapshot()` is synchronous, which is what makes it safe in `renderExportMenu`.
  const before = fetchImpl.calls.length;
  for (let index = 0; index < 50; index += 1) probe.snapshot();
  assert.equal(fetchImpl.calls.length, before, "reading the cache must never trigger a request");
});

test("a failure expires so a developer who starts Python later need not reload", async () => {
  const time = clock(1_000);
  const fetchImpl = stubFetch([
    { ok: false, body: { ok: false, code: "advanced-cad-backend-unavailable", message: "not installed" } },
    { body: { ok: true } }
  ]);
  const probe = createCadBackendProbe({ fetch: fetchImpl, now: time.now, failureTtlMs: 30_000 });

  await probe.probe();
  assert.equal(probe.available(), false);

  time.advance(10_000);
  await probe.probe();
  assert.equal(fetchImpl.calls.length, 1, "a fresh failure is still trusted");

  time.advance(25_000);
  // Expired: the cached answer reverts to "unknown" rather than to "absent", because a
  // stale negative is a claim nobody has checked.
  assert.equal(probe.available(), null);
  await probe.probe();
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(probe.available(), true);
});

test("the probe asks for no artefacts at all", async () => {
  const fetchImpl = stubFetch({ body: { ok: true } });
  await createCadBackendProbe({ fetch: fetchImpl }).probe();
  const [request] = fetchImpl.calls;

  assert.equal(request.body.includeStep, false);
  assert.equal(request.body.includeStl, false);
  assert.equal(request.body.includeMesh, false);
  // It still exercises the whole chain: spawn, import build123d, build a part.
  assert.equal(request.body.exactBody.kind, "advancedCadRecipe");
  assert.equal(request.body.exactBody.advancedCadRecipe.operations[0].type, "box");
});

test("with no fetch at all the probe reports absent rather than throwing", async () => {
  const probe = createCadBackendProbe({ fetch: null });
  const snapshot = await probe.probe();
  assert.equal(snapshot.state, CAD_BACKEND_STATE_UNAVAILABLE);
  assert.equal(snapshot.reachable, false);
});

/* ==================================== absent is not "present but not usable" (F4) */

test("a backend that never started is reported absent, not present", () => {
  // ⚠ The regression this exists for. `reachable` was hard-coded `true` on the
  // bridge-said-no path, and that path also carries the case where nothing ran at all -
  // a spawn `ENOENT` for an interpreter that does not exist. `describeCadBackend` words
  // its sentence from that flag, so a missing interpreter was announced as *present*.
  const missingInterpreter = interpretCadBackendResponse({
    ok: true,
    result: {
      ok: false,
      code: "advanced-cad-backend-unavailable",
      message: "Advanced CAD backend could not start: spawn C:/nope/python.exe ENOENT"
    }
  });

  assert.equal(missingInterpreter.state, CAD_BACKEND_STATE_UNAVAILABLE);
  assert.equal(missingInterpreter.reachable, false, "nothing ran, so nothing was reached");
  assert.doesNotMatch(describeCadBackend(missingInterpreter), /present/u);
  assert.match(describeCadBackend(missingInterpreter), /could not start/u);
});

test("a missing library does not produce a sentence that contradicts itself", () => {
  // This one read "The local build123d bridge is present but not usable: build123d is
  // not installed" - present and not installed, in one clause.
  const notInstalled = interpretCadBackendResponse({
    ok: true,
    result: {
      ok: false,
      code: "advanced-cad-backend-unavailable",
      message: "build123d is not installed in the configured CAD Python environment: No module named 'build123d'"
    }
  });

  const sentence = describeCadBackend(notInstalled);
  assert.equal(notInstalled.reachable, false);
  assert.doesNotMatch(sentence, /present/u);
  assert.match(sentence, /not installed/u);
});

test("a bridge that answers and breaks IS present but not usable, so the wording is not simply gone", () => {
  // The negative control, and the half that must keep working: this wording is correct
  // for something that really did answer. Asserting only the absent cases above would
  // pass on a build that deleted the phrase entirely.
  const brokeAfterAnswering = interpretCadBackendResponse({
    ok: true,
    result: { ok: false, code: "advanced-cad-compile-error", message: "OCCT raised on the loft." }
  });

  assert.equal(brokeAfterAnswering.reachable, true);
  assert.match(describeCadBackend(brokeAfterAnswering), /present but not usable/u);
  assert.match(describeCadBackend(brokeAfterAnswering), /OCCT raised/u);
});

test("a timeout says the bridge was slow, never that it is absent", () => {
  // F5's user-facing half. A cold `import build123d` costs about ten seconds, so the
  // first probe after a restart can overrun the compile budget - and it used to be told
  // as "not available on static hosting", a hosting fact asserted about a local timing
  // problem on a backend that was installed and working.
  const slow = interpretCadBackendResponse({
    ok: true,
    result: { ok: false, code: "advanced-cad-timeout", message: "Advanced CAD compile timed out." }
  });

  const sentence = describeCadBackend(slow);
  assert.equal(slow.state, CAD_BACKEND_STATE_UNAVAILABLE, "it is still not usable right now");
  assert.match(sentence, /did not answer in time/u);
  assert.match(sentence, /try again/u, "a transient failure must say what to do about it");
  assert.doesNotMatch(sentence, /static hosting/u, "it is installed; this is not a hosting fact");
  assert.doesNotMatch(sentence, /present but not usable/u);
});

test("every unavailable code still yields a non-empty sentence", () => {
  // The whole mapping, so a new code cannot arrive with nothing to say. This is the
  // check that would have caught the original defect by inspection rather than by a
  // human reading one row in a menu.
  for (const code of CAD_BACKEND_CODES) {
    const snapshot = interpretCadBackendResponse({ ok: true, result: { ok: false, code, message: `${code} happened.` } });
    const sentence = describeCadBackend(snapshot);
    assert.ok(sentence && sentence.trim().length > 0, `${code} renders no sentence`);
    // Absent means absent. Nothing may call it present.
    if (!snapshot.reachable) assert.doesNotMatch(sentence, /is present/u, `${code} calls an absent backend present`);
  }
});
