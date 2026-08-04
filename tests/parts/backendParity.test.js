import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import jscad from "@jscad/modeling";
import {
  ADVANCED_CAD_BACKEND_OPERATION_TYPES,
  ADVANCED_CAD_JSCAD_OPERATION_TYPES,
  ADVANCED_CAD_OPERATION_TYPES,
  createAdvancedCadRecipeBodyFromArgs
} from "../../src/parts/advancedCadRecipe.js";
import { exactBodyCompileRequest } from "../../src/parts/backendPayload.js";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import {
  ADVANCED_CAD_RECIPE_KIND,
  BOOLEAN_OPERATION_KIND,
  REVOLVE_KIND,
  SKETCH_EXTRUDE_KIND,
  SPUR_GEAR_KIND
} from "../../src/parts/contracts.js";
import { createBooleanOperationBody, createRevolveBodyFromPreset } from "../../src/parts/featureOps.js";
import { createSpurGearBody } from "../../src/parts/gears.js";
import { triangleSoupMassProperties } from "../../src/parts/massProperties.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { advancedCadMiddlewareInternals } from "../../src/cad/advancedCadMiddleware.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKEND_SOURCE = readFileSync(join(ROOT, "scripts", "robostudio_build123d_backend.py"), "utf8");

/**
 * The bridge with its prose removed.
 *
 * ⚠ Not a nicety. The first draft of the two scans below read the whole file and failed:
 * the module docstring says the bridge deliberately does **not** use `IsoThread`, so a
 * bare search for the word found the sentence explaining its absence. A scanner that
 * cannot tell prose from code reports defects that are not there - and, in the direction
 * that matters, would miss a real call inside something comment-shaped. Same failure as
 * cycle 08's regex that could not see what it was looking for, in the other direction.
 */
const BACKEND_CODE = BACKEND_SOURCE.replace(/"""[\s\S]*?"""/gu, "").replace(/^[ \t]*#.*$/gmu, "");

/**
 * ## Why this file has two halves
 *
 * The geometric half cannot run on GitHub Pages, cannot run in CI, and cannot run on any
 * machine without build123d - which is most of them, including the one this was written
 * on. A suite that is *absent* rather than failing is the most complete form of passing
 * by seeing nothing, and no review of the assertions catches it, because the assertions
 * are fine. They just never execute.
 *
 * So the structural half runs **everywhere** and holds the invariant that actually
 * matters between two kernels written in two languages: that neither refuses an operation
 * the other accepts. It reads the Python as text, which is the only thing a JavaScript
 * test can do to a Python list, and it is enough - a list in Python cannot be shared with
 * a list in JavaScript, but the direction of truth can be.
 *
 * And the geometric half **announces its skip** and is counted, so a run reporting all
 * green cannot quietly mean "six comparisons did not happen".
 */

/** Every parity case, with what became of it. Asserted complete at the end of this file. */
const parityLedger = [];

function pythonListLiteral(name) {
  const match = BACKEND_SOURCE.match(new RegExp(`^${name} = \\[([\\s\\S]*?)\\]`, "mu"));
  assert.ok(match, `${name} must be a plain literal in the bridge so this test can read it`);
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

/* ------------------------------------------------- structural parity, always runs */

test("the two kernel lists partition the operation types with nothing left over", () => {
  // Before cycle 10 there were three states: seven operations one kernel or the other
  // could build, and four that were registered, persisted, and refused by both - each
  // with its own sentence, so the browser prescribed a cure the cure would refuse.
  const overlap = ADVANCED_CAD_JSCAD_OPERATION_TYPES.filter((type) =>
    ADVANCED_CAD_BACKEND_OPERATION_TYPES.includes(type)
  );
  assert.deepEqual(overlap, [], "an operation may not belong to both kernels");
  assert.deepEqual(
    [...ADVANCED_CAD_OPERATION_TYPES].sort(),
    [...ADVANCED_CAD_JSCAD_OPERATION_TYPES, ...ADVANCED_CAD_BACKEND_OPERATION_TYPES].sort(),
    "every registered type must belong to exactly one kernel"
  );
  // `label` is un-reserved rather than implemented: embossed text is the one operation
  // that plausibly needs OCCT, nothing here does it, and a type nothing can build is not
  // a type. Asking for it is now an ordinary unsupported-operation refusal.
  assert.equal(ADVANCED_CAD_OPERATION_TYPES.includes("label"), false);
  assert.equal(ADVANCED_CAD_JSCAD_OPERATION_TYPES.includes("thread"), true);
});

test("the bridge dispatches exactly the operation types the browser registers", () => {
  // The refusal that made this necessary: the browser said "install the local build123d
  // backend" for a `pattern`, and the backend then refused `pattern` as reserved.
  assert.deepEqual(
    pythonListLiteral("DISPATCHED_OPERATION_TYPES").sort(),
    [...ADVANCED_CAD_OPERATION_TYPES].sort()
  );
  assert.doesNotMatch(BACKEND_SOURCE, /reserved but not implemented/u, "the straddle is gone from both ends");
});

test("the bridge dispatches exactly the body kinds the page has", () => {
  assert.deepEqual(
    pythonListLiteral("DISPATCHED_BODY_KINDS").sort(),
    [SKETCH_EXTRUDE_KIND, REVOLVE_KIND, SPUR_GEAR_KIND, BOOLEAN_OPERATION_KIND, ADVANCED_CAD_RECIPE_KIND].sort()
  );
});

test("the bridge holds no standards table of its own", () => {
  // A4 across the language boundary. build123d ships `IsoThread` and it would answer from
  // its own tables, so an M8 could leave Python a few microns different from the M8 in
  // the preview with nothing to say why.
  assert.doesNotMatch(BACKEND_CODE, /IsoThread/u);
  assert.match(BACKEND_CODE, /resolvedThread/u, "thread numbers must arrive resolved");
  assert.doesNotMatch(BACKEND_CODE, /0\.6134/u);

  // A3 negative control: the stripper must remove prose and keep code, or the three
  // assertions above pass on a bridge that really does call `IsoThread`.
  assert.match(BACKEND_SOURCE, /IsoThread/u, "the docstring explains the absence, and that is prose");
  assert.notEqual(BACKEND_CODE.length, BACKEND_SOURCE.length);
  assert.match(BACKEND_CODE, /def build_thread/u, "and the stripper must not have eaten the code");
});

test("the bridge is given a mesh tolerance rather than choosing one", () => {
  // R8: before cycle 10 `export_stl` was called with no tolerance, so a mesh previewed
  // from Python was faceted by build123d's default while the same body previewed from the
  // browser was faceted by the page's chord tolerance - two rules, one preview surface.
  assert.match(BACKEND_CODE, /tolerance=tolerance_mm/u);
  assert.match(BACKEND_CODE, /toleranceMm/u);
});

test("the capability probe's literal payload is the shape the payload builder produces", () => {
  // `cadBackend.js` writes its probe payload as a literal so that a module whose only job
  // is asking whether a subprocess answers does not import `@jscad/modeling`. That is the
  // one duplication in the pair, and this is what stops it drifting.
  const probeSource = readFileSync(join(ROOT, "src", "parts", "cadBackend.js"), "utf8");
  const built = exactBodyCompileRequest(createBodyFromTemplate("base_plate"));
  for (const key of Object.keys(built)) {
    assert.match(probeSource, new RegExp(`\\b${key}\\b`, "u"), `the probe payload must carry ${key}`);
  }
  for (const key of ["id", "name", "scale", "kind", "fidelity"]) {
    assert.match(probeSource, new RegExp(`\\b${key}\\b`, "u"), `the probe's exactBody must carry ${key}`);
  }
});

/* ------------------------------------------------- geometric parity, when there is a bridge */

/**
 * Per-case tolerance, and it is a real engineering number rather than an adjective.
 *
 * The two kernels facet against the same chord tolerance now, but not with the same
 * algorithm: the browser inscribes an n-gon quantised up to a multiple of four, and OCCT
 * meshes to a deflection. An inscribed n-gon of a circle loses about `2*pi^2/(3*n^2)` of
 * its area, which at this page's 0.02 mm tolerance on a 4 mm radius is `n = 32` and about
 * 0.6%. Two independent approximations of that size, plus the difference between an
 * inscribed and a deflection-bounded mesh, is comfortably inside 2% and nowhere near
 * float precision - which is exactly why the number has to be stated and justified rather
 * than tightened until it passes.
 *
 * A body with no curved surface has no such term, so it gets 1e-6 relative and any
 * disagreement there is a real modelling difference.
 */
const CURVED_VOLUME_TOLERANCE = 0.02;
const PLANAR_VOLUME_TOLERANCE = 1e-6;

function parityCases() {
  const plate = createBodyFromTemplate("base_plate");
  const gear = createSpurGearBody({ toothCount: 18, moduleMm: 1.5 });
  const recipeBox = createAdvancedCadRecipeBodyFromArgs({
    name: "Recipe box",
    advancedCadRecipe: {
      version: 1,
      units: "mm",
      operations: [{ id: "base", type: "box", size: [30, 8, 20], center: [0, 0, 0] }]
    }
  }).body;
  const recipeDrilled = createAdvancedCadRecipeBodyFromArgs({
    name: "Recipe drilled",
    advancedCadRecipe: {
      version: 1,
      units: "mm",
      operations: [
        { id: "base", type: "box", size: [30, 8, 20], center: [0, 0, 0] },
        { id: "bore", type: "hole", radius: 4, depth: 20, center: [0, 0, 0], axis: "y" }
      ]
    }
  }).body;
  const recipePatterned = createAdvancedCadRecipeBodyFromArgs({
    name: "Recipe patterned",
    advancedCadRecipe: {
      version: 1,
      units: "mm",
      operations: [
        { id: "base", type: "box", size: [40, 8, 20], center: [0, 0, 0] },
        { id: "bore", type: "hole", radius: 2, depth: 20, center: [-10, 0, 0], axis: "y" },
        { id: "bores", type: "pattern", mode: "subtract", targetIds: ["bore"], repeat: [3, 1, 1], spacing: [10, 0, 0] }
      ]
    }
  }).body;
  const revolve = createRevolveBodyFromPreset("spacer");
  const boolean = createBooleanOperationBody(
    "subtract",
    [plate, revolve],
    { name: "Plate less spacer" },
    new Set([plate.id, revolve.id])
  );

  return [
    { label: "recipe box", body: recipeBox, bodies: [recipeBox], curved: false },
    { label: "recipe with a bore", body: recipeDrilled, bodies: [recipeDrilled], curved: true },
    { label: "recipe with a patterned bore", body: recipePatterned, bodies: [recipePatterned], curved: true },
    { label: "sketch plate", body: plate, bodies: [plate], curved: true },
    { label: "revolve", body: revolve, bodies: [revolve], curved: true },
    { label: "spur gear", body: gear, bodies: [gear], curved: true },
    { label: "boolean", body: boolean, bodies: [plate, revolve, boolean], curved: true }
  ];
}

async function askBridge(request) {
  return advancedCadMiddlewareInternals.runBuild123d(request, {
    pythonCommand: process.env.ROBOSTUDIO_CAD_PYTHON ?? "python",
    timeoutMs: 120_000
  });
}

test("per-operation and per-body-kind parity against the local bridge", async (t) => {
  const cases = parityCases();
  const probe = await askBridge(
    exactBodyCompileRequest(cases[0].body, { includeStep: false, includeStl: false, includeMesh: false })
  );

  if (!probe.ok) {
    // ⚠ Announced, loudly, and recorded in the ledger below. A skipped parity suite that
    // says nothing is a run reporting all green while its most important comparisons did
    // not happen.
    const reason = `${probe.code}: ${probe.message}`;
    for (const item of cases) parityLedger.push({ label: item.label, status: "skipped", reason });
    console.warn(
      `\n[parity] SKIPPED ${cases.length} build123d parity comparisons - no local bridge answered.\n`
        + `[parity] ${reason}\n`
        + "[parity] Install build123d and re-run to exercise them; this is expected on CI and on GitHub Pages.\n"
    );
    t.skip(`No local build123d bridge: ${reason}`);
    return;
  }

  // ⚠ Every case is attempted and its verdict recorded, rather than the first failure
  // ending the run. One unbuildable body used to hide the six behind it: the spur gear
  // threw and `boolean` was never compared at all, so a real defect masked five healthy
  // comparisons and one unknown. Failures are collected and asserted after the loop.
  const failures = [];

  for (const item of cases) {
    const browserSolid = compilePartBodyToSolid(item.body, { bodies: item.bodies });
    const browserVolume = measureVolume(browserSolid);
    const [browserMin, browserMax] = measureBoundingBox(browserSolid);

    const result = await askBridge(
      exactBodyCompileRequest(item.body, { bodies: item.bodies, includeStep: false, includeStl: false, includeMesh: true })
    );
    if (!result.ok) {
      failures.push(`${item.label}: ${result.message ?? "bridge refused"}`);
      parityLedger.push({ label: item.label, status: "failed", reason: result.message ?? "bridge refused" });
      continue;
    }

    const vertices = Float32Array.from(result.mesh.vertices);
    const properties = triangleSoupMassProperties(vertices, result.mesh.triangleCount, { watertight: true });
    if (!properties) {
      // ⚠ The mesh came back, and it is not closed - so there is no volume to compare and
      // saying so is the only honest move. `massProperties` returning `null` here is audit
      // A2 working: an unmeasurable solid has no volume, not a volume of zero. The gear
      // reaches this because OCCT skips ~37 degenerate faces when meshing it, which is
      // tolerance-independent. See `_REVIEW_FINDINGS.md` F6.
      const native = (result.warnings ?? []).map((entry) => entry.message).join(" ");
      const reason = `the bridge's mesh is not closed, so it has no measurable volume. ${native}`.trim();
      failures.push(`${item.label}: ${reason}`);
      parityLedger.push({ label: item.label, status: "failed", reason });
      continue;
    }
    const tolerance = item.curved ? CURVED_VOLUME_TOLERANCE : PLANAR_VOLUME_TOLERANCE;
    const relative = Math.abs(properties.volumeMm3 - browserVolume) / browserVolume;
    assert.ok(
      relative <= tolerance,
      `${item.label}: volumes differ by ${(relative * 100).toFixed(3)}%, over the ${(tolerance * 100).toFixed(3)}% `
        + `allowed for two faceting rules (browser ${browserVolume}, bridge ${properties.volumeMm3})`
    );

    for (const axis of [0, 1, 2]) {
      const browserSize = browserMax[axis] - browserMin[axis];
      const bridgeSize = result.mesh.bounds.size[axis];
      const axisRelative = Math.abs(bridgeSize - browserSize) / Math.max(browserSize, 1e-9);
      assert.ok(
        axisRelative <= tolerance,
        `${item.label}: axis ${axis} extents differ by ${(axisRelative * 100).toFixed(3)}%`
      );
    }

    parityLedger.push({ label: item.label, status: "compared", relative });
  }

  const compared = parityLedger.filter((entry) => entry.status === "compared").length;
  assert.deepEqual(
    failures,
    [],
    `${compared}/${cases.length} bodies matched the bridge inside tolerance; these did not:\n  - ${failures.join("\n  - ")}`
  );
});

test("every parity case is accounted for, compared or explicitly skipped", () => {
  // The test that stops the suite from being covered by tests nobody has seen run. It is
  // deliberately the last one in the file: it reads what the case above actually did.
  const expected = parityCases().map((item) => item.label).sort();
  assert.deepEqual(parityLedger.map((entry) => entry.label).sort(), expected);
  for (const entry of parityLedger) {
    assert.ok(["compared", "skipped", "failed"].includes(entry.status));
    // A skip and a failure both have to say why. A case that merely stopped appearing is
    // the state this ledger exists to make impossible.
    if (entry.status !== "compared") assert.ok(entry.reason, `${entry.label} must say why it did not compare`);
  }
  const skipped = parityLedger.filter((entry) => entry.status === "skipped").length;
  if (skipped) console.warn(`[parity] ${skipped}/${parityLedger.length} comparisons did not run on this machine.`);
});
