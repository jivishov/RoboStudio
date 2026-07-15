import assert from "node:assert/strict";
import test from "node:test";

import {
  assistantRuntimeCapability,
  isGitHubPagesLocation
} from "../../src/assistant/runtimeCapability.js";

test("assistant runtime capability identifies GitHub Pages without treating local Vite as static", () => {
  assert.equal(isGitHubPagesLocation(new URL("https://jivishov.github.io/RoboStudio/circuits.html")), true);
  assert.equal(isGitHubPagesLocation(new URL("https://github.io/example")), true);
  assert.equal(isGitHubPagesLocation(new URL("http://127.0.0.1:4177/circuits.html")), false);
  assert.equal(isGitHubPagesLocation(new URL("https://example.com/RoboStudio/circuits.html")), false);

  const pages = assistantRuntimeCapability(new URL("https://jivishov.github.io/RoboStudio/circuits.html"));
  assert.equal(pages.available, false);
  assert.equal(pages.code, "static-github-pages");
  assert.match(pages.message, /local server proxy/i);
  assert.match(pages.message, /no API key is exposed/i);

  assert.deepEqual(
    assistantRuntimeCapability(new URL("http://127.0.0.1:4177/circuits.html")),
    { available: true, code: "server-capable", message: "" }
  );
});
