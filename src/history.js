const DEFAULT_HISTORY_LIMIT = 60;
const MIN_HISTORY_LIMIT = 10;
const HISTORY_CHANGE_LISTENERS = new WeakMap();

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function jsonEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolvedLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value)) return DEFAULT_HISTORY_LIMIT;
  return Math.max(MIN_HISTORY_LIMIT, Math.floor(value));
}

function cloneForHistory(history, value) {
  return history.clone(value);
}

function disposeValue(history, value) {
  if (value == null || typeof history.dispose !== "function") return;
  history.dispose(value);
}

function clearValues(history, values) {
  for (const value of values) disposeValue(history, value);
  values.length = 0;
}

function hasHistoryChangeListeners(history) {
  return Boolean(HISTORY_CHANGE_LISTENERS.get(history)?.size);
}

function notifyHistoryChange(history, kind, previousValue, nextValue) {
  const listeners = HISTORY_CHANGE_LISTENERS.get(history);
  if (!listeners?.size) return;
  const event = {
    kind,
    previous: cloneForHistory(history, previousValue),
    current: cloneForHistory(history, nextValue)
  };
  for (const listener of [...listeners]) {
    try { listener(event); } catch (error) { console.error("History change listener failed", error); }
  }
}

export function subscribeHistoryChanges(history, listener) {
  if (!history || typeof listener !== "function") return () => {};
  let listeners = HISTORY_CHANGE_LISTENERS.get(history);
  if (!listeners) {
    listeners = new Set();
    HISTORY_CHANGE_LISTENERS.set(history, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) HISTORY_CHANGE_LISTENERS.delete(history);
  };
}

function mountCircuitWebMcpForHistory(history, initialValue) {
  if (initialValue?.kind !== "CircuitLabProject" || typeof document === "undefined") return;
  queueMicrotask(() => {
    import("./webmcp/circuitPageIntegration.js")
      .then(({ mountCircuitWebMcp }) => mountCircuitWebMcp({ history }))
      .catch((error) => console.error("Circuit Lab WebMCP bootstrap failed", error));
  });
}

export function createHistory(initialValue = null, options = {}) {
  const history = {
    current: null,
    undoStack: [],
    redoStack: [],
    limit: resolvedLimit(options.limit),
    clone: options.clone ?? cloneJson,
    equals: options.equals ?? jsonEquals,
    dispose: options.dispose ?? null
  };
  history.current = cloneForHistory(history, initialValue);
  mountCircuitWebMcpForHistory(history, initialValue);
  return history;
}

export function resetHistory(history, value = null) {
  const previous = hasHistoryChangeListeners(history) ? cloneForHistory(history, history.current) : null;
  disposeValue(history, history.current);
  clearValues(history, history.undoStack);
  clearValues(history, history.redoStack);
  history.current = cloneForHistory(history, value);
  notifyHistoryChange(history, "reset", previous, history.current);
  return cloneForHistory(history, history.current);
}

export function currentHistoryValue(history) {
  return cloneForHistory(history, history.current);
}

export function replaceHistoryValue(history, nextValue) {
  const next = cloneForHistory(history, nextValue);
  if (history.equals(history.current, next)) {
    disposeValue(history, next);
    return currentHistoryValue(history);
  }
  const previous = hasHistoryChangeListeners(history) ? cloneForHistory(history, history.current) : null;
  disposeValue(history, history.current);
  history.current = next;
  notifyHistoryChange(history, "replace", previous, history.current);
  return currentHistoryValue(history);
}

export function commitHistoryFrom(history, previousValue, nextValue) {
  const previous = cloneForHistory(history, previousValue);
  const next = cloneForHistory(history, nextValue);
  if (history.equals(previous, next)) {
    disposeValue(history, previous);
    disposeValue(history, next);
    return currentHistoryValue(history);
  }
  disposeValue(history, history.current);
  history.current = previous;
  return commitHistory(history, next);
}

export function commitHistory(history, nextValue) {
  const next = cloneForHistory(history, nextValue);
  if (history.equals(history.current, next)) {
    disposeValue(history, next);
    return currentHistoryValue(history);
  }

  const previous = hasHistoryChangeListeners(history) ? cloneForHistory(history, history.current) : null;
  history.undoStack.push(history.current);
  if (history.undoStack.length > history.limit) {
    disposeValue(history, history.undoStack.shift());
  }
  clearValues(history, history.redoStack);
  history.current = next;
  notifyHistoryChange(history, "commit", previous, history.current);
  return currentHistoryValue(history);
}

export function undoHistory(history) {
  if (!history.undoStack.length) return currentHistoryValue(history);
  const previous = hasHistoryChangeListeners(history) ? cloneForHistory(history, history.current) : null;
  history.redoStack.push(history.current);
  history.current = history.undoStack.pop();
  notifyHistoryChange(history, "undo", previous, history.current);
  return currentHistoryValue(history);
}

export function redoHistory(history) {
  if (!history.redoStack.length) return currentHistoryValue(history);
  const previous = hasHistoryChangeListeners(history) ? cloneForHistory(history, history.current) : null;
  history.undoStack.push(history.current);
  if (history.undoStack.length > history.limit) {
    disposeValue(history, history.undoStack.shift());
  }
  history.current = history.redoStack.pop();
  notifyHistoryChange(history, "redo", previous, history.current);
  return currentHistoryValue(history);
}

export function historyStatus(history) {
  return {
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
    undoCount: history.undoStack.length,
    redoCount: history.redoStack.length,
    limit: history.limit
  };
}
