import assert from "node:assert/strict";
import test from "node:test";

import { serializeBodyToStl, stlFileNameForBody } from "../../src/parts/exporters.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

test("exports a selected generated body as ASCII STL", () => {
  const body = createBodyFromTemplate("servo_mount_plate");
  const stl = serializeBodyToStl(body);

  assert.equal(stlFileNameForBody(body), "servo_mount_plate.stl");
  assert.match(stl, /^solid /);
  assert.match(stl, /facet normal/);
});
