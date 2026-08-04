import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_AUTOSAVE_DELAY_MS, createPartProjectAutosave } from "../../src/parts/autosave.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { addBody, createProjectHistory, commitProject } from "../../src/parts/projectState.js";
import { serializePartProject } from "../../src/parts/serialization.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

// A manual clock so the debounce is asserted rather than waited out.
function createManualTimers() {
  let nextHandle = 1;
  const scheduled = new Map();
  return {
    setTimer(callback, delayMs) {
      const handle = nextHandle;
      nextHandle += 1;
      scheduled.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimer(handle) {
      scheduled.delete(handle);
    },
    pending() {
      return [...scheduled.values()];
    },
    async run() {
      const entries = [...scheduled.entries()];
      scheduled.clear();
      for (const [, entry] of entries) await entry.callback();
    }
  };
}

function createRecordingWriter(options = {}) {
  const writes = [];
  return {
    writes,
    write(serialized) {
      writes.push(serialized);
      if (options.fail) return Promise.reject(new Error("storage is unavailable"));
      return Promise.resolve();
    }
  };
}

function createAutosaveHarness(options = {}) {
  const timers = createManualTimers();
  const writer = createRecordingWriter(options);
  const errors = [];
  const written = [];
  const autosave = createPartProjectAutosave({
    serialize: (project) => serializePartProject(project),
    write: writer.write,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onWritten: (serialized) => written.push(serialized),
    onError: (error) => errors.push(error),
    ...options.autosave
  });
  return { autosave, timers, writer, errors, written };
}

function projectWithBody(name) {
  const project = createPartProject({ updatedAt: "2026-07-27T12:00:00.000Z" });
  const body = createBodyFromTemplate("base_plate", { existingIds: new Set() });
  return addBody(project, { ...body, name }, { updatedAt: "2026-07-27T12:00:01.000Z" });
}

test("autosave requires a serializer and a writer", () => {
  assert.throws(() => createPartProjectAutosave({ write: () => {} }), /serialize/);
  assert.throws(() => createPartProjectAutosave({ serialize: () => "" }), /write/);
  assert.equal(DEFAULT_AUTOSAVE_DELAY_MS > 0, true);
});

test("autosave debounces a burst of edits into a single write", async () => {
  const { autosave, timers, writer } = createAutosaveHarness();

  autosave.schedule(projectWithBody("first"));
  autosave.schedule(projectWithBody("second"));
  autosave.schedule(projectWithBody("third"));

  assert.equal(writer.writes.length, 0);
  assert.equal(timers.pending().length, 1);
  assert.equal(autosave.isDirty(), true);

  await timers.run();

  assert.equal(writer.writes.length, 1);
  assert.equal(JSON.parse(writer.writes[0]).bodies[0].name, "third");
  assert.equal(autosave.isDirty(), false);
  assert.equal(autosave.stats().writes, 1);
});

test("autosave coalesces a repeat of the already-pending state without re-arming", async () => {
  const { autosave, timers } = createAutosaveHarness();
  const project = projectWithBody("stable");

  assert.deepEqual(autosave.schedule(project), { scheduled: true, reason: "scheduled" });
  assert.deepEqual(autosave.schedule(project), { scheduled: true, reason: "coalesced" });
  assert.equal(timers.pending().length, 1);
  assert.equal(autosave.stats().coalesced, 1);

  await timers.run();
  assert.equal(autosave.stats().writes, 1);
});

test("autosave skips a write when the serialized project is unchanged", async () => {
  const { autosave, timers, writer } = createAutosaveHarness();
  const project = projectWithBody("saved");

  autosave.schedule(project);
  await timers.run();
  assert.equal(writer.writes.length, 1);

  const result = autosave.schedule(project);

  assert.deepEqual(result, { scheduled: false, reason: "unchanged" });
  assert.equal(timers.pending().length, 0);
  assert.equal(autosave.isDirty(), false);
  await timers.run();
  assert.equal(writer.writes.length, 1);
  assert.equal(autosave.stats().unchanged, 1);
});

test("autosave drops a queued write when an edit is reverted before the debounce fires", async () => {
  const { autosave, timers, writer } = createAutosaveHarness();
  const original = projectWithBody("original");

  autosave.schedule(original);
  await timers.run();
  assert.equal(writer.writes.length, 1);

  autosave.schedule(projectWithBody("edited"));
  assert.equal(autosave.isDirty(), true);
  autosave.schedule(original);

  assert.equal(autosave.isDirty(), false);
  await timers.run();
  assert.equal(writer.writes.length, 1);
});

test("autosave flush writes immediately and reports a clean project", async () => {
  const { autosave, timers, writer } = createAutosaveHarness();

  assert.deepEqual(await autosave.flush(), { written: false, reason: "clean" });

  autosave.schedule(projectWithBody("flushed"));
  assert.deepEqual(await autosave.flush(), { written: true, reason: "written" });

  assert.equal(writer.writes.length, 1);
  assert.equal(timers.pending().length, 0);
  assert.equal(autosave.isDirty(), false);
  assert.deepEqual(await autosave.flush(), { written: false, reason: "clean" });
});

test("autosave markSaved adopts a restored project without writing it back", async () => {
  const { autosave, timers, writer } = createAutosaveHarness();
  const restored = projectWithBody("restored");

  autosave.markSaved(restored);

  assert.equal(autosave.isDirty(), false);
  assert.deepEqual(autosave.schedule(restored), { scheduled: false, reason: "unchanged" });
  await timers.run();
  assert.equal(writer.writes.length, 0);
});

test("autosave keeps the project dirty and reports a failed write", async () => {
  const { autosave, timers, writer, errors } = createAutosaveHarness({ fail: true });

  autosave.schedule(projectWithBody("unsaved"));
  const result = await autosave.flush();

  assert.equal(result.written, false);
  assert.equal(result.reason, "error");
  assert.match(result.error.message, /storage is unavailable/);
  assert.equal(errors.length, 1);
  assert.equal(autosave.isDirty(), true);
  assert.equal(autosave.stats().failures, 1);
  assert.equal(writer.writes.length, 1);
  assert.equal(timers.pending().length, 0);
});

test("autosave writes only the current project state, never history stacks", async () => {
  const { autosave, timers, writer, written } = createAutosaveHarness();
  const history = createProjectHistory();
  commitProject(history, projectWithBody("first"));
  commitProject(history, projectWithBody("second"));
  assert.equal(history.undoStack.length, 2);

  autosave.schedule(history.current);
  await timers.run();

  const record = JSON.parse(writer.writes[0]);
  assert.deepEqual(Object.keys(record).sort(), ["bodies", "selectedBodyId", "units", "updatedAt", "version"]);
  assert.equal(written.length, 1);
  assert.equal(writer.writes[0].includes("undoStack"), false);
  assert.equal(writer.writes[0].includes("redoStack"), false);
});

test("a fingerprint that ignores the timestamp suppresses a write but still stores it", async () => {
  const { autosave, timers, writer } = createAutosaveHarness({
    autosave: {
      fingerprint: (project) => serializePartProject({ ...project, updatedAt: "" })
    }
  });
  const project = projectWithBody("plate");

  autosave.schedule(project);
  await timers.run();
  assert.equal(writer.writes.length, 1);
  // The payload keeps the real timestamp; only the change comparison drops it.
  assert.equal(JSON.parse(writer.writes[0]).updatedAt, project.updatedAt);

  const retimestamped = { ...project, updatedAt: "2026-07-27T13:00:00.000Z" };
  assert.deepEqual(autosave.schedule(retimestamped), { scheduled: false, reason: "unchanged" });
  await timers.run();
  assert.equal(writer.writes.length, 1);

  // A real edit under the same timestamp still writes.
  autosave.schedule({ ...projectWithBody("renamed"), updatedAt: retimestamped.updatedAt });
  await timers.run();
  assert.equal(writer.writes.length, 2);
  assert.equal(JSON.parse(writer.writes[1]).bodies[0].name, "renamed");
});

test("autosave destroy cancels a pending write", async () => {
  const { autosave, timers, writer } = createAutosaveHarness();

  autosave.schedule(projectWithBody("abandoned"));
  autosave.destroy();

  assert.equal(autosave.isDirty(), false);
  await timers.run();
  assert.equal(writer.writes.length, 0);
});
