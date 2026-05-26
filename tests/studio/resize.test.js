import assert from "node:assert/strict";
import test from "node:test";

import { scaleForTargetBounds } from "../../src/studio/resize.js";

test("computes non-uniform scale from target bounding sizes", () => {
  assert.deepEqual(
    scaleForTargetBounds([100, 20, 50], [1, 1, 1], [200, 10, 25], { uniform: false }),
    [2, 0.5, 0.5]
  );
});

test("computes uniform scale from the edited axis", () => {
  assert.deepEqual(
    scaleForTargetBounds([100, 20, 50], [1, 2, 1], [100, 40, 50], { axis: 1, uniform: true }),
    [2, 4, 2]
  );
});

test("rejects zero or invalid bounds", () => {
  assert.throws(
    () => scaleForTargetBounds([100, 0, 50], [1, 1, 1], [200, 10, 25], { uniform: false }),
    /currentBoundsSize\[1\] must be a positive number/
  );
});

