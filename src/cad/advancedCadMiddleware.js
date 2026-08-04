import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REQUEST_BYTES = 250_000;

/**
 * A ceiling on what the child may write back.
 *
 * The request has been capped since this file was written, and the response was not:
 * `stdout` accumulated into an unbounded string, so a runaway compile could grow a Node
 * string until the dev server died. Cycle 10 measured what actually travels - a base64
 * STEP of a filleted plate is tens of kilobytes, and an ASCII STL of a fine-toothed gear
 * is the largest realistic payload at a few megabytes - and set the cap an order of
 * magnitude above the worst of those.
 *
 * The overrun is reported as `advanced-cad-backend-error`, which is the bridge's existing
 * code for *present but not usable*, rather than a seventh code. That is what it is: the
 * child answered and the answer cannot be used.
 */
const MAX_RESPONSE_BYTES = 64_000_000;

/**
 * How long one bridge call may take, spawn to parse.
 *
 * **60 s, raised from 20 s against a measured slow case rather than a guess.** Cycle 10
 * declined to raise it because raising a timeout without a measurement is guessing; the
 * measurement now exists. Every call pays a fixed cost to start Python and import
 * build123d and OCP, and on this machine that import measured **9.9 s cold** and ~5.4 s
 * warm, with a minimal filleted compile at ~6.2 s warm. The first probe after a restart -
 * cold page cache, and an antivirus reading several hundred megabytes of OCP DLLs -
 * exceeded 20 s and reported the backend *absent while it was installed and working*.
 *
 * The cost is dominated by that one-off import, not by geometry, so the budget is set to
 * cover a cold start rather than a slow part. A part genuinely slow enough to need more
 * than a minute is a different problem and should be reported as one.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT_PATH = resolve(__dirname, "../../scripts/robostudio_build123d_backend.py");

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = MAX_REQUEST_BYTES) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("CAD request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("CAD request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function safePythonCommand(value) {
  const command = String(value ?? "").trim();
  return command || "python";
}

function runBuild123d(payload, options = {}) {
  const pythonCommand = safePythonCommand(options.pythonCommand);
  const scriptPath = options.scriptPath ?? DEFAULT_SCRIPT_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  return new Promise((resolveRun) => {
    const child = spawn(pythonCommand, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolveRun({
        ok: false,
        code: "advanced-cad-timeout",
        message: "Advanced CAD compile timed out."
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length <= maxResponseBytes || settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolveRun({
        ok: false,
        code: "advanced-cad-backend-error",
        message:
          `Advanced CAD backend wrote more than ${maxResponseBytes} bytes, so the response was `
          + "discarded rather than buffered without limit. Ask for STEP alone, or a coarser mesh."
      });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        ok: false,
        code: "advanced-cad-backend-unavailable",
        message: `Advanced CAD backend could not start: ${error.message}`
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let unparsable = null;
      try {
        const parsed = stdout ? JSON.parse(stdout) : null;
        if (parsed && typeof parsed === "object") {
          resolveRun(parsed);
          return;
        }
      } catch (error) {
        unparsable = error;
      }
      // ⚠ Say which of the two failures this is. Reporting an exit code for a stdout that
      // did not parse produced "Advanced CAD backend exited with code 0" - a compile that
      // had succeeded, blamed on an exit code that was fine, because OCCT had written a
      // C++ warning ahead of the JSON. The bridge now keeps descriptor 1 clear, so this
      // branch means a genuine protocol violation and should name itself as one.
      const preview = stdout.trim().slice(0, 120);
      resolveRun({
        ok: false,
        code: "advanced-cad-backend-error",
        message: unparsable
          ? `The CAD bridge wrote something other than JSON to stdout, so its answer cannot be read. It began: ${preview}`
          : stderr.trim() || `Advanced CAD backend exited with code ${code}.`
      });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function createAdvancedCadCompileMiddleware(options = {}) {
  return async function advancedCadCompile(req, res, next) {
    if (req.method !== "POST") {
      if (typeof next === "function") return next();
      jsonResponse(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const result = await runBuild123d(payload, options);
      // ⚠ `200` even when `result.ok` is false, and this is a correction rather than a
      // softening. The middleware ran, the child ran, and the answer is "build123d is not
      // installed" - a domain outcome, not a server failure. It used to answer `503`, and
      // the cost was concrete: the capability probe made the browser log
      // "Failed to load resource: 503" on a page where the bridge is *correctly* absent,
      // which is the documented deployment. A failed probe is not an error to report, and
      // a console full of red for an optional local tool is exactly that report.
      //
      // Nothing downstream regressed, because every caller has always tested `result.ok`
      // rather than the status alone. A malformed **request** still answers 400 below:
      // that one really is the caller's fault.
      jsonResponse(res, 200, result);
    } catch (error) {
      jsonResponse(res, 400, {
        ok: false,
        code: "advanced-cad-request-error",
        message: error.message ?? "Advanced CAD request failed."
      });
    }
  };
}

export const advancedCadMiddlewareInternals = Object.freeze({
  DEFAULT_SCRIPT_PATH,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  readJsonBody,
  runBuild123d
});
