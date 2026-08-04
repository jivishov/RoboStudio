// Shared keyboard shortcut helpers.
//
// Assembly Studio, Component Builder, and Robotics Workbench each carried a
// byte-identical `shortcutTargetIsTextEditable` and an undo/redo keydown
// handler that differed only in which history functions it called. Keeping
// three copies is how the guard drifts; a text field that stops swallowing
// Ctrl+Z on one page but not the others is a silent data-loss bug.

/**
 * True when the event target is a control that owns its own text editing, so a
 * page-level shortcut must not steal the key.
 */
export function isTextEditableTarget(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable === true;
}

/**
 * Builds the Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y keydown handler.
 * Alt-modified chords are ignored, matching every page's prior behaviour.
 *
 * @param {object} handlers
 * @param {() => void} handlers.undo
 * @param {() => void} handlers.redo
 * @returns {(event: KeyboardEvent) => void}
 */
export function createHistoryShortcutHandler({ undo, redo }) {
  return function handleHistoryShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      redo();
    }
  };
}
