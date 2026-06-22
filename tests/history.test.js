import assert from "node:assert/strict";
import test from "node:test";

import { commitHistory, commitHistoryFrom, createHistory, historyStatus, redoHistory, replaceHistoryValue, undoHistory } from "../src/history.js";

test("history keeps at least ten undo steps and clears redo on a new commit", () => {
  const history = createHistory({ value: 0 }, { limit: 3 });

  for (let value = 1; value <= 12; value += 1) {
    commitHistory(history, { value });
  }

  assert.equal(historyStatus(history).limit, 10);
  assert.equal(historyStatus(history).undoCount, 10);
  assert.deepEqual(undoHistory(history), { value: 11 });
  assert.deepEqual(undoHistory(history), { value: 10 });
  assert.equal(historyStatus(history).redoCount, 2);

  commitHistory(history, { value: 99 });
  assert.equal(historyStatus(history).redoCount, 0);
  assert.deepEqual(undoHistory(history), { value: 10 });
});

test("history redo restores the latest undone value", () => {
  const history = createHistory({ step: "start" });
  commitHistory(history, { step: "middle" });
  commitHistory(history, { step: "end" });

  assert.deepEqual(undoHistory(history), { step: "middle" });
  assert.deepEqual(redoHistory(history), { step: "end" });
});

test("history can replace the current value without adding undo steps", () => {
  const history = createHistory({ step: "start", selectedId: null });
  commitHistory(history, { step: "middle", selectedId: null });
  replaceHistoryValue(history, { step: "middle", selectedId: "servo" });

  assert.equal(historyStatus(history).undoCount, 1);
  assert.deepEqual(undoHistory(history), { step: "start", selectedId: null });
});

test("history can commit a preview from an explicit previous value", () => {
  const history = createHistory({ step: "start", x: 0 });
  commitHistory(history, { step: "middle", x: 10 });
  replaceHistoryValue(history, { step: "middle", x: 42 });
  commitHistoryFrom(history, { step: "middle", x: 10 }, { step: "middle", x: 48 });

  assert.equal(historyStatus(history).undoCount, 2);
  assert.deepEqual(undoHistory(history), { step: "middle", x: 10 });
  assert.deepEqual(redoHistory(history), { step: "middle", x: 48 });
});

test("history clones returned values and disposes pruned entries", () => {
  const disposed = [];
  const history = createHistory(
    { id: "zero", nested: { value: 0 } },
    {
      limit: 10,
      clone: (value) => JSON.parse(JSON.stringify(value)),
      dispose: (value) => disposed.push(value.id)
    }
  );

  for (let index = 1; index <= 12; index += 1) {
    commitHistory(history, { id: `step-${index}`, nested: { value: index } });
  }

  assert.deepEqual(disposed, ["zero", "step-1"]);

  const restored = undoHistory(history);
  restored.nested.value = 999;

  assert.deepEqual(redoHistory(history), { id: "step-12", nested: { value: 12 } });
  assert.deepEqual(undoHistory(history), { id: "step-11", nested: { value: 11 } });
});
