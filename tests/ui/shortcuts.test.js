import assert from "node:assert/strict";
import { test } from "node:test";

// The guard uses `instanceof` against DOM constructors, so stand them up before
// importing the module under test.
class FakeElement {
  constructor() {
    this.isContentEditable = false;
  }
}
class FakeInput extends FakeElement {}
class FakeTextArea extends FakeElement {}
class FakeSelect extends FakeElement {}

globalThis.HTMLInputElement = FakeInput;
globalThis.HTMLTextAreaElement = FakeTextArea;
globalThis.HTMLSelectElement = FakeSelect;

const { createHistoryShortcutHandler, isTextEditableTarget } = await import("../../src/shortcuts.js");

function keyEvent(overrides = {}) {
  return {
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: new FakeElement(),
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides
  };
}

function recordingHandler() {
  const calls = [];
  const handler = createHistoryShortcutHandler({
    undo: () => calls.push("undo"),
    redo: () => calls.push("redo")
  });
  return { calls, handler };
}

test("text-editable guard covers inputs, textareas, selects and contenteditable", () => {
  assert.equal(isTextEditableTarget(new FakeInput()), true);
  assert.equal(isTextEditableTarget(new FakeTextArea()), true);
  assert.equal(isTextEditableTarget(new FakeSelect()), true);
  const editable = new FakeElement();
  editable.isContentEditable = true;
  assert.equal(isTextEditableTarget(editable), true);
  assert.equal(isTextEditableTarget(new FakeElement()), false);
  assert.equal(isTextEditableTarget(null), false);
  assert.equal(isTextEditableTarget(undefined), false);
});

test("ctrl+z undoes and ctrl+shift+z or ctrl+y redoes", () => {
  const { calls, handler } = recordingHandler();
  handler(keyEvent({ ctrlKey: true }));
  handler(keyEvent({ ctrlKey: true, shiftKey: true }));
  handler(keyEvent({ ctrlKey: true, key: "y" }));
  assert.deepEqual(calls, ["undo", "redo", "redo"]);
});

test("meta is accepted as the modifier and the key match is case insensitive", () => {
  const { calls, handler } = recordingHandler();
  handler(keyEvent({ metaKey: true, key: "Z" }));
  handler(keyEvent({ metaKey: true, key: "Y" }));
  assert.deepEqual(calls, ["undo", "redo"]);
});

test("the chord is ignored without a modifier, with alt, and inside text fields", () => {
  const { calls, handler } = recordingHandler();
  handler(keyEvent({}));
  handler(keyEvent({ ctrlKey: true, altKey: true }));
  handler(keyEvent({ ctrlKey: true, target: new FakeInput() }));
  handler(keyEvent({ ctrlKey: true, target: new FakeTextArea() }));
  handler(keyEvent({ ctrlKey: true, target: new FakeSelect() }));
  handler(keyEvent({ ctrlKey: true, key: "s" }));
  assert.deepEqual(calls, []);
});

test("a handled chord is prevented and an unhandled one is not", () => {
  const { handler } = recordingHandler();
  const handled = keyEvent({ ctrlKey: true });
  handler(handled);
  assert.equal(handled.prevented, true);

  const ignored = keyEvent({ ctrlKey: true, key: "s" });
  handler(ignored);
  assert.equal(ignored.prevented, false);
});
