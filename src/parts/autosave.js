// Component Builder autosave scheduling.
//
// This module decides *when* the current PartProject is written, never *how*. It owns no DOM
// and no storage handle: the caller supplies `serialize` and `write`, so the same logic is
// testable without IndexedDB and without a browser.
//
// Only the current project state is ever handed to `write`. Undo and redo stacks are
// session-only UI state and must not be persisted (AGENTS.md:16); this module is given a
// project rather than a history object so there is nothing else it could write.

export const DEFAULT_AUTOSAVE_DELAY_MS = 700;

function defaultSetTimer(callback, delayMs) {
  return setTimeout(callback, delayMs);
}

function defaultClearTimer(handle) {
  clearTimeout(handle);
}

export function createPartProjectAutosave(options = {}) {
  const serialize = options.serialize;
  const write = options.write;
  if (typeof serialize !== "function") throw new Error("Autosave needs a serialize function.");
  if (typeof write !== "function") throw new Error("Autosave needs a write function.");

  // What counts as a change is a separate question from what gets stored. The Component
  // Builder re-timestamps its project on every mutation including a bare re-selection, so the
  // caller passes a fingerprint that ignores fields not worth a write of their own.
  const fingerprintOf = options.fingerprint ?? serialize;
  const delayMs = Number.isFinite(Number(options.delayMs)) && Number(options.delayMs) >= 0
    ? Number(options.delayMs)
    : DEFAULT_AUTOSAVE_DELAY_MS;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const clearTimer = options.clearTimer ?? defaultClearTimer;
  const onWritten = options.onWritten ?? null;
  const onError = options.onError ?? null;

  let timer = null;
  // The state waiting to be written, or null when there is nothing outstanding.
  let pending = null;
  // The fingerprint the storage layer has most recently accepted.
  let savedFingerprint = null;
  let inFlight = null;
  const stats = { scheduled: 0, coalesced: 0, unchanged: 0, writes: 0, failures: 0 };

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function armTimer() {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  async function drainPending() {
    while (pending != null) {
      const entry = pending;
      pending = null;
      try {
        await write(entry.payload);
      } catch (error) {
        // Keep the project dirty so a later edit or an explicit flush retries it, unless a
        // newer state already replaced it while this write was in flight.
        pending ??= entry;
        stats.failures += 1;
        throw error;
      }
      savedFingerprint = entry.fingerprint;
      stats.writes += 1;
      onWritten?.(entry.payload);
    }
  }

  function schedule(project) {
    const fingerprint = fingerprintOf(project);

    if (fingerprint === savedFingerprint) {
      // An edit-and-revert lands here: whatever was queued is now stale and storage already
      // holds this state, so drop the pending write instead of doing a no-op one.
      cancelTimer();
      pending = null;
      stats.unchanged += 1;
      return { scheduled: false, reason: "unchanged" };
    }

    if (fingerprint === pending?.fingerprint) {
      stats.coalesced += 1;
      return { scheduled: true, reason: "coalesced" };
    }

    pending = { fingerprint, payload: serialize(project) };
    stats.scheduled += 1;
    armTimer();
    return { scheduled: true, reason: "scheduled" };
  }

  async function flush() {
    cancelTimer();
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // The failing write already reported through onError and re-queued its payload.
      }
    }
    if (pending == null) return { written: false, reason: "clean" };

    inFlight = drainPending();
    try {
      await inFlight;
      return { written: true, reason: "written" };
    } catch (error) {
      onError?.(error);
      return { written: false, reason: "error", error };
    } finally {
      inFlight = null;
    }
  }

  // Marks `project` as the state already in storage without writing it. Used after a restore
  // so rehydrating a saved project does not immediately write it straight back.
  function markSaved(project) {
    cancelTimer();
    pending = null;
    savedFingerprint = fingerprintOf(project);
    return savedFingerprint;
  }

  function isDirty() {
    return pending != null || timer !== null || inFlight != null;
  }

  function destroy() {
    cancelTimer();
    pending = null;
  }

  return {
    schedule,
    flush,
    markSaved,
    isDirty,
    destroy,
    delayMs,
    stats: () => ({ ...stats })
  };
}
