import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createAdvancedCadCompileMiddleware } from "../../src/cad/advancedCadMiddleware.js";

function runMiddleware(middleware, payload) {
  const req = new PassThrough();
  req.method = "POST";
  const responsePromise = new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(content) {
        resolve({ statusCode: this.statusCode, headers: this.headers, content });
      }
    };
    middleware(req, res);
  });
  req.end(JSON.stringify(payload));
  return responsePromise;
}

test("advanced CAD middleware proxies structured build123d backend responses", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "robostudio-cad-middleware-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const scriptPath = join(tempRoot, "mock_backend.mjs");
  await writeFile(
    scriptPath,
    [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  process.stdout.write(JSON.stringify({ ok: true, bodyId: payload.body.id, stepBase64: 'U1RFUA==' }));",
      "});"
    ].join("\n")
  );

  const middleware = createAdvancedCadCompileMiddleware({
    pythonCommand: process.execPath,
    scriptPath
  });
  const response = await runMiddleware(middleware, {
    body: { id: "advanced_body" },
    includeStep: true
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.content), {
    ok: true,
    bodyId: "advanced_body",
    stepBase64: "U1RFUA=="
  });
});

test("advanced CAD middleware reports backend startup failures without throwing", async () => {
  const middleware = createAdvancedCadCompileMiddleware({
    pythonCommand: "definitely-not-a-python-command"
  });
  const response = await runMiddleware(middleware, { body: { id: "advanced_body" } });
  const payload = JSON.parse(response.content);

  // ⚠ 200, not 503. The middleware ran and the child could not start; that is an outcome
  // this endpoint reports, not a server failure. It answered 503 until cycle 10, and the
  // cost was a browser console full of "Failed to load resource: 503" on every page where
  // the optional bridge is correctly absent - a failed capability probe reported as an
  // error. Callers have always read `ok` rather than the status.
  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "advanced-cad-backend-unavailable");
});
