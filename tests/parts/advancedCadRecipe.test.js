import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { ADVANCED_CAD_RECIPE_KIND } from "../../src/parts/contracts.js";
import {
  ADVANCED_CAD_BACKEND_OPERATION_TYPES,
  ADVANCED_CAD_JSCAD_OPERATION_TYPES,
  AdvancedCadBackendRequiredError,
  advancedCadRecipeNeedsBackend,
  compileAdvancedCadRecipeToSolid,
  createAdvancedCadRecipeBodyFromArgs,
  normalizeAdvancedCadRecipe,
  validateAdvancedCadRecipe
} from "../../src/parts/advancedCadRecipe.js";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { addBody, normalizePartProject } from "../../src/parts/projectState.js";
import { validateBody, validatePartProject } from "../../src/parts/validation.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;

function plateRecipe(extraOperations = []) {
  return {
    version: 1,
    units: "mm",
    designIntent: "Test mount plate",
    operations: [
      { id: "base", type: "box", size: [60, 6, 30], center: [0, 0, 0] },
      { id: "center_hole", type: "hole", radius: 4, depth: 10, center: [0, 0, 0], axis: "y" },
      ...extraOperations
    ]
  };
}

test("normalizes and validates advanced CAD recipe bodies as state-only source", () => {
  const result = createAdvancedCadRecipeBodyFromArgs({
    name: "Filleted mount",
    color: "#14b8a6",
    advancedCadRecipe: plateRecipe([{ id: "edge_round", type: "fillet", radius: 1.5 }])
  });

  assert.equal(result.accepted, true);
  assert.equal(result.body.source.kind, ADVANCED_CAD_RECIPE_KIND);
  assert.equal(result.body.advancedCadRecipe.units, "mm");
  assert.equal(result.body.advancedCadRecipe.operations.length, 3);
  assert.equal(validateBody(result.body).length, 0);

  const project = addBody(normalizePartProject(), result.body);
  assert.equal(validatePartProject(project).length, 0);
  assert.equal(project.bodies[0].advancedCadRecipe.operations[2].type, "fillet");
});

test("compiles browser-compatible advanced CAD recipes through JSCAD fallback", () => {
  const body = createAdvancedCadRecipeBodyFromArgs({
    name: "Browser plate",
    advancedCadRecipe: plateRecipe()
  }).body;

  assert.equal(advancedCadRecipeNeedsBackend(body.advancedCadRecipe), false);
  const withHole = compilePartBodyToSolid(body);
  const withoutHole = compileAdvancedCadRecipeToSolid({
    ...body,
    advancedCadRecipe: normalizeAdvancedCadRecipe({
      version: 1,
      units: "mm",
      operations: [{ id: "base", type: "box", size: [60, 6, 30], center: [0, 0, 0] }]
    })
  });
  const [min, max] = measureBoundingBox(withHole);

  assert.equal(Number((max[1] - min[1]).toFixed(3)), 6);
  assert.ok(measureVolume(withHole) < measureVolume(withoutHole));
});

test("normalizes hole and slot operations as subtractive features", () => {
  const recipe = normalizeAdvancedCadRecipe({
    version: 1,
    units: "mm",
    operations: [
      { id: "base", type: "box", size: [30, 6, 20], center: [0, 0, 0] },
      { id: "hole", type: "hole", mode: "add", radius: 2, depth: 8, center: [0, 0, 0], axis: "y" },
      { id: "slot", type: "slot", mode: "intersect", length: 8, width: 3, depth: 8, center: [8, 0, 0] }
    ]
  });

  assert.equal(recipe.operations[1].mode, "subtract");
  assert.equal(recipe.operations[2].mode, "subtract");
  assert.equal(validateAdvancedCadRecipe(recipe).length, 0);
});

test("keeps backend-only recipe operations valid but explicit at compile time", () => {
  const body = createAdvancedCadRecipeBodyFromArgs({
    name: "Backend mount",
    advancedCadRecipe: plateRecipe([{ id: "edge_round", type: "fillet", radius: 1.5 }])
  }).body;

  assert.equal(validateBody(body).length, 0);
  assert.equal(advancedCadRecipeNeedsBackend(body.advancedCadRecipe), true);
  assert.throws(() => compilePartBodyToSolid(body), (error) => {
    assert.equal(error.cause instanceof AdvancedCadBackendRequiredError, true);
    assert.equal(error.cause.code, "advanced-cad-backend-required");
    return true;
  });
});

test("rejects unsupported advanced CAD recipe operations visibly", () => {
  const recipe = normalizeAdvancedCadRecipe({
    version: 1,
    units: "mm",
    operations: [{ id: "base", type: "loft", size: [1, 2, 3] }]
  });

  assert.ok(validateAdvancedCadRecipe(recipe).some((issue) => issue.code === "unsupported-advanced-cad-operation"));
  assert.equal(advancedCadRecipeNeedsBackend(recipe), false);
});

/* ============================================================ cycle 10 */

test("a cylinder is the size the recipe asked for", () => {
  // ⚠ This is a regression test for a defect nothing saw. `operationToSolid` used to pass
  // `{ start, end }` to `primitives.cylinder`, which accepts `center`, `height`, `radius`
  // and `segments` and **silently ignores** anything else - so every browser-compiled
  // cylinder and hole was a 2 mm stub at the origin, whatever the recipe said. It produced
  // a solid, it never threw, and no test looked at the dimensions.
  const body = createAdvancedCadRecipeBodyFromArgs({
    name: "Post",
    advancedCadRecipe: {
      version: 1,
      units: "mm",
      operations: [{ id: "post", type: "cylinder", radius: 5, height: 30, center: [0, 0, 0], axis: "z" }]
    }
  }).body;

  const [min, max] = measureBoundingBox(compilePartBodyToSolid(body));
  assert.equal(Number((max[2] - min[2]).toFixed(6)), 30, "the height must be the height");
  assert.ok(Math.abs(max[0] - min[0] - 10) < 0.05, "and the diameter must be the diameter");
});

test("the un-reserved operations compile in the browser, so no tier gate hides them", () => {
  // Cycle 10's rule was implement or un-reserve, but stop straddling. `boolean`, `pattern`
  // and `transform` were always browser-feasible - `featureOps.js` has applied booleans
  // since cycle 03 - so implementing them in Python would have put tier-two capability
  // behind a tier-three gate, which is the opposite of what the tier is for.
  const body = createAdvancedCadRecipeBodyFromArgs({
    name: "Perforated rail",
    advancedCadRecipe: {
      version: 1,
      units: "mm",
      operations: [
        { id: "base", type: "box", size: [60, 6, 20], center: [0, 0, 0] },
        { id: "bore", type: "hole", radius: 2, depth: 20, center: [-20, 0, 0], axis: "y" },
        { id: "bores", type: "pattern", mode: "subtract", targetIds: ["bore"], repeat: [3, 1, 1], spacing: [20, 0, 0] },
        { id: "lug", type: "box", size: [8, 6, 8], center: [0, 0, 14] },
        { id: "lug_moved", type: "transform", targetIds: ["lug"], vector: [0, 0, 2] },
        { id: "joined", type: "boolean", operation: "union", targetIds: ["lug", "lug_moved"] }
      ]
    }
  }).body;

  assert.deepEqual(validateBody(body), []);
  assert.equal(advancedCadRecipeNeedsBackend(body.advancedCadRecipe), false, "none of these needs the bridge");

  const solid = compilePartBodyToSolid(body);
  const plain = compileAdvancedCadRecipeToSolid({
    ...body,
    advancedCadRecipe: normalizeAdvancedCadRecipe({
      version: 1,
      units: "mm",
      operations: [{ id: "base", type: "box", size: [60, 6, 20], center: [0, 0, 0] }]
    })
  });
  // Three 4 mm bores through 6 mm of plate is about 226 mm3 removed; two 8 mm lugs added
  // is more than that, so the patterned holes must not be the only thing that happened.
  assert.ok(measureVolume(solid) > measureVolume(plain) - 300);
  const [min, max] = measureBoundingBox(solid);
  assert.ok(max[2] - min[2] > 20, "the transformed lug must extend the part past the base box");
});

test("a target that is not an earlier operation is refused rather than resolved", () => {
  const forward = normalizeAdvancedCadRecipe({
    version: 1,
    units: "mm",
    operations: [
      { id: "base", type: "box", size: [10, 10, 10], center: [0, 0, 0] },
      { id: "copy", type: "pattern", targetIds: ["later"], repeat: [2, 1, 1], spacing: [5, 0, 0] },
      { id: "later", type: "box", size: [2, 2, 2], center: [0, 0, 0] }
    ]
  });
  assert.ok(validateAdvancedCadRecipe(forward).some((issue) => issue.code === "unknown-advanced-cad-target"));

  const selfReference = normalizeAdvancedCadRecipe({
    version: 1,
    units: "mm",
    operations: [
      { id: "base", type: "box", size: [10, 10, 10], center: [0, 0, 0] },
      { id: "loop", type: "boolean", operation: "union", targetIds: ["loop"] }
    ]
  });
  assert.ok(validateAdvancedCadRecipe(selfReference).some((issue) => issue.code === "unknown-advanced-cad-target"));
});

test("a thread operation round-trips through the project normalizer", () => {
  // Landmine two, across three lists: a field absent from `normalizeOperation`'s literal
  // is silently dropped on the next save, and the symptom is a body that reloads as
  // something else. Shipped in the same change as the field itself, and it renames the
  // body first so the round trip is a real save rather than an identity function.
  const project = addBody(
    normalizePartProject(),
    createAdvancedCadRecipeBodyFromArgs({
      name: "Stud",
      advancedCadRecipe: {
        version: 1,
        units: "mm",
        operations: [
          { id: "shank", type: "cylinder", radius: 3.3, height: 20, center: [0, 0, 0], axis: "z" },
          {
            id: "threads",
            type: "thread",
            threadSize: "M8",
            series: "fine",
            threadKind: "external",
            toleranceClass: "g",
            length: 12,
            axis: "z",
            center: [0, 0, 4]
          }
        ]
      }
    }).body
  );

  const reloaded = normalizePartProject(JSON.parse(JSON.stringify({ ...project, name: "Renamed" })));
  const thread = reloaded.bodies[0].advancedCadRecipe.operations[1];
  assert.equal(thread.threadSize, "M8");
  assert.equal(thread.series, "fine");
  assert.equal(thread.threadKind, "external");
  assert.equal(thread.toleranceClass, "g");
  assert.equal(thread.length, 12);
  assert.deepEqual(thread.center, [0, 0, 4]);
  // An internal thread is a void and an external one is material, so the mode is derived
  // rather than authored: a recipe cannot say "internal" and "add", which is not a shape.
  assert.equal(thread.mode, "add");
  assert.equal(validateBody(reloaded.bodies[0]).length, 0);
});

test("an edge selector round-trips, and a bad one is refused by name", () => {
  const project = addBody(
    normalizePartProject(),
    createAdvancedCadRecipeBodyFromArgs({
      name: "Rounded",
      advancedCadRecipe: {
        version: 1,
        units: "mm",
        operations: [
          { id: "base", type: "box", size: [20, 10, 20], center: [0, 0, 0] },
          { id: "round", type: "fillet", radius: 2, edgeSelector: { kind: "face", face: "top", minLengthMm: 3 } }
        ]
      }
    }).body
  );

  const reloaded = normalizePartProject(JSON.parse(JSON.stringify({ ...project, name: "Renamed" })));
  const selector = reloaded.bodies[0].advancedCadRecipe.operations[1].edgeSelector;
  assert.deepEqual(selector, { kind: "face", face: "top", minLengthMm: 3 });

  const contradictory = normalizeAdvancedCadRecipe({
    version: 1,
    units: "mm",
    operations: [
      { id: "base", type: "box", size: [20, 10, 20], center: [0, 0, 0] },
      { id: "round", type: "fillet", radius: 2, edgeSelector: { kind: "axis", axis: "z", minLengthMm: 9, maxLengthMm: 2 } }
    ]
  });
  assert.ok(
    validateAdvancedCadRecipe(contradictory).some((issue) => issue.code === "invalid-advanced-cad-edge-selector"),
    "a minimum above the maximum matches nothing and must not be normalized into silence"
  );
});

test("an unpublished thread combination refuses with the standards table's own sentence", () => {
  const recipe = normalizeAdvancedCadRecipe({
    version: 1,
    units: "mm",
    operations: [
      { id: "threads", type: "thread", threadSize: "M4", series: "coarse", threadKind: "internal", toleranceClass: "g", length: 8 }
    ]
  });
  const issues = validateAdvancedCadRecipe(recipe);
  const refusal = issues.find((issue) => issue.code === "unsupported-thread-combination");
  assert.ok(refusal, "a lowercase position is an external one and must not silently apply to a nut");
  assert.match(refusal.message, /not published here for an internal thread/u);
});

test("the browser's backend refusal names only operations the backend really implements", () => {
  // ⚠ The defect this closes: a valid recipe carrying `pattern` used to be refused with
  // "this recipe requires the local build123d backend", and installing that backend
  // produced "pattern is reserved but not implemented by the build123d bridge yet". The
  // page prescribed a cure the cure would refuse.
  for (const type of ADVANCED_CAD_BACKEND_OPERATION_TYPES) {
    const recipe = normalizeAdvancedCadRecipe({
      version: 1,
      units: "mm",
      operations: [
        { id: "base", type: "box", size: [10, 10, 10], center: [0, 0, 0] },
        { id: "finish", type, radius: 1, thicknessMm: 1 }
      ]
    });
    assert.equal(validateAdvancedCadRecipe(recipe).length, 0, `${type} must be a valid operation`);
    assert.equal(advancedCadRecipeNeedsBackend(recipe), true, `${type} is a backend operation`);
  }
  for (const type of ADVANCED_CAD_JSCAD_OPERATION_TYPES) {
    assert.equal(
      ADVANCED_CAD_BACKEND_OPERATION_TYPES.includes(type),
      false,
      `${type} is refused with "install the backend" only if the backend can build it`
    );
  }
});
