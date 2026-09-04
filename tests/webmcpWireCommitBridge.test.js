import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalPairCommitter } from "../src/webmcp/wireCommitBridge.js";

test("pairs synthetic terminal endpoints into canonical Circuit Lab connect action", () => {
  const calls = [];
  const committer = createTerminalPairCommitter({
    getExecuteAction: () => (name, args) => {
      calls.push({ name, args });
      return { ok: true };
    }
  });

  assert.deepEqual(committer.accept({ componentId: "breadboard", terminalId: "bn2" }), {
    paired: false,
    dispatched: false
  });
  assert.deepEqual(committer.accept({ componentId: "servo_shoulder", terminalId: "gnd" }), {
    paired: true,
    dispatched: true
  });
  assert.deepEqual(calls, [{
    name: "circuits_connect_terminals",
    args: {
      endpointA: { componentId: "breadboard", terminalId: "bn2" },
      endpointB: { componentId: "servo_shoulder", terminalId: "gnd" }
    }
  }]);
});

test("retries once in a microtask when the Circuit Lab page action bridge is not ready", () => {
  let ready = false;
  const calls = [];
  const retries = [];
  const committer = createTerminalPairCommitter({
    getExecuteAction: () => ready ? ((name, args) => calls.push({ name, args })) : null,
    scheduleRetry: (callback) => retries.push(callback)
  });

  committer.accept({ componentId: "breadboard", terminalId: "bn2" });
  const result = committer.accept({ componentId: "servo_shoulder", terminalId: "gnd" });
  assert.equal(result.paired, true);
  assert.equal(result.dispatched, false);
  assert.equal(retries.length, 1);

  ready = true;
  retries[0]();
  assert.equal(calls.length, 1);
});
