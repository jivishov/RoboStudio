import assert from "node:assert/strict";
import { test } from "node:test";

// A minimal DOM stand-in. The status channel only needs an element with
// `textContent` and `hidden`, plus timer and rAF hooks.
function createStubEnvironment() {
  const timers = new Map();
  let nextTimerId = 1;
  const frames = [];
  const appended = [];

  const createdElement = () => ({
    textContent: "",
    hidden: false,
    id: "",
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  });

  globalThis.document = {
    getElementById: () => null,
    createElement: () => createdElement(),
    body: {
      append(node) {
        appended.push(node);
      }
    }
  };
  globalThis.window = {
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(fn) {
      frames.push(fn);
      return frames.length;
    }
  };

  return {
    appended,
    runTimers() {
      const pending = Array.from(timers.values());
      timers.clear();
      for (const timer of pending) timer.fn();
    },
    pendingTimers: () => timers.size,
    flushFrames() {
      const pending = frames.splice(0, frames.length);
      for (const frame of pending) frame();
    }
  };
}

const env = createStubEnvironment();
const { createStatusChannel } = await import("../../src/statusChannel.js");

function visibleElement() {
  return { textContent: "", hidden: true };
}

test("a revealing channel unhides on show and re-hides when idle", () => {
  const element = visibleElement();
  const channel = createStatusChannel({ element, defaultTimeoutMs: 2400, reveal: true });
  channel.show("Body added");
  assert.equal(element.textContent, "Body added");
  assert.equal(element.hidden, false);
  env.runTimers();
  assert.equal(element.hidden, true);
});

test("a channel with no default timeout leaves the message in place", () => {
  const element = visibleElement();
  const channel = createStatusChannel({ element });
  channel.show("Loading current assembly");
  assert.equal(element.textContent, "Loading current assembly");
  assert.equal(env.pendingTimers(), 0);
});

test("onIdle replaces the default hide so a page can restore its summary", () => {
  const element = visibleElement();
  const channel = createStatusChannel({
    element,
    defaultTimeoutMs: 3600,
    onIdle: () => {
      element.textContent = "Starter project / 3 components / 2 wires";
    }
  });
  channel.show("Undo complete");
  env.runTimers();
  assert.equal(element.textContent, "Starter project / 3 components / 2 wires");
  // Without `reveal` the channel never touches `hidden`.
  assert.equal(element.hidden, true);
});

test("a persistent message cancels a pending restore by default", () => {
  const element = visibleElement();
  const channel = createStatusChannel({
    element,
    defaultTimeoutMs: 3600,
    onIdle: () => {
      element.textContent = "summary";
    }
  });
  channel.show("first");
  channel.show("stays until dismissed", 0);
  assert.equal(env.pendingTimers(), 0);
  assert.equal(element.textContent, "stays until dismissed");
});

test("cancelPendingOnPersistentMessage false keeps the prior restore scheduled", () => {
  const element = visibleElement();
  const channel = createStatusChannel({
    element,
    defaultTimeoutMs: 3600,
    cancelPendingOnPersistentMessage: false,
    onIdle: () => {
      element.textContent = "summary";
    }
  });
  channel.show("first");
  channel.show("stays until dismissed", 0);
  assert.equal(env.pendingTimers(), 1);
  env.runTimers();
  assert.equal(element.textContent, "summary");
});

test("messages are mirrored into a screen-reader-only region that is never hidden", () => {
  const element = visibleElement();
  const channel = createStatusChannel({ element, defaultTimeoutMs: 2400, reveal: true });
  channel.show("Project saved");
  env.flushFrames();

  const region = channel.liveRegion;
  assert.ok(region, "a live region is created on first announcement");
  assert.equal(region.attributes["aria-live"], "polite");
  assert.equal(region.attributes["aria-atomic"], "true");
  assert.equal(region.hidden, false);
  assert.equal(region.textContent, "Project saved");

  // The visible surface is hidden between messages; the region must not be.
  env.runTimers();
  assert.equal(element.hidden, true);
  assert.equal(region.hidden, false);
});

test("an identical repeated message is cleared first so it announces again", () => {
  const channel = createStatusChannel({ element: visibleElement() });
  channel.show("Compile failed");
  env.flushFrames();
  const region = channel.liveRegion;
  assert.equal(region.textContent, "Compile failed");

  channel.show("Compile failed");
  assert.equal(region.textContent, "", "cleared synchronously before the next frame");
  env.flushFrames();
  assert.equal(region.textContent, "Compile failed");
});

test("announce false leaves announcements to a page that owns its own region", () => {
  const channel = createStatusChannel({ element: visibleElement(), announce: false });
  channel.show("Wire start cleared");
  env.flushFrames();
  assert.equal(channel.liveRegion, null);
});
