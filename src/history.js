const DEFAULT_HISTORY_LIMIT = 60;
const MIN_HISTORY_LIMIT = 10;

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
  return history;
}

export function resetHistory(history, value = null) {
  disposeValue(history, history.current);
  clearValues(history, history.undoStack);
  clearValues(history, history.redoStack);
  history.current = cloneForHistory(history, value);
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
  disposeValue(history, history.current);
  history.current = next;
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

  history.undoStack.push(history.current);
  if (history.undoStack.length > history.limit) {
    disposeValue(history, history.undoStack.shift());
  }
  clearValues(history, history.redoStack);
  history.current = next;
  return currentHistoryValue(history);
}

export function undoHistory(history) {
  if (!history.undoStack.length) return currentHistoryValue(history);
  history.redoStack.push(history.current);
  history.current = history.undoStack.pop();
  return currentHistoryValue(history);
}

export function redoHistory(history) {
  if (!history.redoStack.length) return currentHistoryValue(history);
  history.undoStack.push(history.current);
  if (history.undoStack.length > history.limit) {
    disposeValue(history, history.undoStack.shift());
  }
  history.current = history.redoStack.pop();
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
