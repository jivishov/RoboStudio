import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { ADVANCED_CAD_RECIPE_KIND } from "../../src/parts/contracts.js";
import {
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
