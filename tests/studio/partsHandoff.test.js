import assert from "node:assert/strict";
import test from "node:test";

import {
  generatedSnapshotParts,
  isPartsHandoffRequested,
  isValidGeneratedAssemblySnapshot
} from "../../src/studio/partsHandoff.js";

test("gates generated snapshot loading behind fromParts query", () => {
  assert.equal(isPartsHandoffRequested("?fromParts=1"), true);
  assert.equal(isPartsHandoffRequested("?fromParts=0"), false);
  assert.equal(isPartsHandoffRequested(""), false);
});

test("accepts only generated Component Builder snapshots for handoff loading", () => {
  const snapshot = {
    glb: new ArrayBuffer(8),
    parts: [
      { id: "base_plate", type: "generated", source: "part-studio" },
      { id: "legacy", type: "imported" }
    ]
  };

  assert.equal(generatedSnapshotParts(snapshot).length, 1);
  assert.equal(isValidGeneratedAssemblySnapshot(snapshot), true);
  assert.equal(isValidGeneratedAssemblySnapshot({ ...snapshot, glb: null }), false);
  assert.equal(isValidGeneratedAssemblySnapshot({ glb: new ArrayBuffer(8), parts: [{ id: "legacy" }] }), false);
});
