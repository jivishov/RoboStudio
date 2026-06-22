import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REQUEST_BYTES = 250_000;
const DEFAULT_TIMEOUT_MS = 20_000;

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
      try {
        const parsed = stdout ? JSON.parse(stdout) : null;
        if (parsed && typeof parsed === "object") {
          resolveRun(parsed);
          return;
        }
      } catch {
        // Fall through to structured error below.
      }
      resolveRun({
        ok: false,
        code: "advanced-cad-backend-error",
        message: stderr.trim() || `Advanced CAD backend exited with code ${code}.`
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
      jsonResponse(res, result.ok ? 200 : 503, result);
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
  readJsonBody,
  runBuild123d
});
