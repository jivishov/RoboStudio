import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { asFiniteNumber, asPositiveNumber, isFiniteNumber, isPositiveNumber } from "../../src/parts/contracts.js";

/**
 * Cycle 01 extracted `issue`, `finite` and `positive` into shared modules. The `issue`
 * half held - no private `issue` helper survives. The numeric half eroded: later cycles
 * reintroduced module-private coercion helpers, one of them the function whose
 * fabricated `0` was caught in review twice. Nothing re-checked it, because nothing was
 * watching.
 *
 * This is the watch. It does not forbid private helpers - several are genuinely distinct
 * contracts `contracts.js` cannot express, and one of them is distinct *because* it
 * refuses to coerce. It forbids an **undeclared** one. Adding a helper means adding a row
 * to `DECLARED_HELPERS` and a doc comment saying why it is not `contracts.js`.
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const PARTS_DIR = join(SRC_DIR, "parts");

/**
 * `src/parts/` plus the page that consumes it. Cycle 01's greps stopped at the directory,
 * which is how `parts.js`'s two throwing validators went unenumerated - the directory is
 * where the modules live, not where the defect class ends. The other four pages are out
 * of scope here because they hold no CAD numerics.
 */
const SCANNED_PAGE_FILES = ["parts.js"];

const FUNCTION_DECLARATION = /^[ \t]*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;

/** A name that announces itself as numeric coercion. */
const COERCION_NAME = /finite|positive/i;

/**
 * Callees that keep a function a *pure* coercion. Anything else means it consults the
 * rest of the module and is domain logic that happens to touch numbers.
 */
const PRIMITIVE_CALLS = new Set([
  "Number",
  "Number.isFinite",
  "String",
  "Array.isArray",
  "isFinite",
  // Control-flow keywords, which the callee regex cannot tell from a call.
  "if",
  "for",
  "while",
  "switch",
  "return",
  "typeof",
  "catch"
]);

const PURE_COERCION_MAX_LINES = 4;

/**
 * Every module-private numeric helper in the scanned tree, with the decision recorded for
 * it. Reviewed 2026-07-29 against `parts_page_plan_2026-07-27/refined/CONTINUATION_CYCLE_01_REFINED.md`
 * (fidelity defect 2).
 */
const DECLARED_HELPERS = {
  "customSketchBody.js": {
    finiteOrDefault: "distinct - passes a non-numeric value through so validateBody can report it"
  },
  "dfm.js": {
    finite: "distinct - the number, or nothing; the shared pair answer yes/no or substitute"
  },
  "hardware.js": {
    finitePlacement: "distinct - vector-shaped, and refuses rather than defaulting a hole to the origin"
  },
  "massProperties.js": {
    finiteOrNull: "distinct - null where asFiniteNumber returns a fallback; that IS absent-not-zero"
  },
  "process.js": {
    positiveOrZero: "distinct - clamps negatives to zero so a bad profile cannot lower a limit",
    compensationTermMm:
      "distinct - the opposite contract to the pair above and the reason it exists: it must " +
      "return null for null, because Number(null) is 0 and a kerf of zero is indistinguishable " +
      "from no kerf in the geometry. asFiniteNumber substitutes; positiveOrZero coerces; this refuses."
  },
  "resize.js": {
    positiveNumber: "delegates to asPositiveNumber, bound to MIN_SIZE_MM and a > 0 threshold",
    positiveVector: "distinct - vector-shaped; coerces per axis through positiveNumber"
  },
  "standards/fasteners.js": {
    bossOuterDiameterMm:
      "not a helper - a standards accessor whose finite check is a guard. Kept local because " +
      "src/parts/standards/ imports nothing at all; that independence is worth more than one " +
      "deduplicated guard."
  },
  "standards/threads.js": {
    fundamentalTriangleHeightMm:
      "not a helper - a standards accessor for ISO 68-1's H = P * sqrt(3) / 2, whose finite " +
      "check is a guard on the caller's pitch. Local for the same reason as fasteners.js's " +
      "bossOuterDiameterMm: standards/ modules reach outside their own directory only for " +
      "another standards table, never for page logic. Returns null rather than a coerced " +
      "number, because a triangle height for an unusable pitch is a fabricated dimension."
  },
  "../parts.js": {
    finiteNumber: "distinct - throws naming the field; an assistant action has no sensible coercion",
    positiveNumber: "distinct - throws naming the field; see finiteNumber"
  }
};

/**
 * A justification has to name what it is not. Without this the doc-comment check passes
 * on any preceding block comment, including an unrelated section banner - a green check
 * that reads the wrong thing, which is the failure A3 exists to catch.
 */
const SHARED_SYMBOLS = ["contracts.js", "isFiniteNumber", "isPositiveNumber", "asFiniteNumber", "asPositiveNumber"];

function functionBody(source, braceIndex) {
  let depth = 0;
  for (let index = braceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceIndex + 1, index);
    }
  }
  return "";
}

function isPureCoercion(body) {
  if (!/Number\.isFinite/.test(body)) return false;
  if (body.split("\n").filter((line) => line.trim()).length > PURE_COERCION_MAX_LINES) return false;
  return [...body.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)].every((match) => PRIMITIVE_CALLS.has(match[1]));
}

/**
 * Two detectors, unioned on purpose. Name alone is defeated by a rename - the negative
 * control below proves that by scanning a coercion called `measure` - and a rename is
 * exactly what someone reaching for a clearer name does. Body alone is defeated by a
 * helper that delegates correctly today and stops tomorrow. Either signal puts a function
 * on the list; only `DECLARED_HELPERS` takes it off.
 */
function findHelpers(source) {
  const found = [];
  FUNCTION_DECLARATION.lastIndex = 0;
  let match;
  while ((match = FUNCTION_DECLARATION.exec(source))) {
    const braceIndex = source.indexOf("{", match.index + match[0].length - 1);
    if (COERCION_NAME.test(match[1]) || isPureCoercion(functionBody(source, braceIndex))) found.push(match[1]);
  }
  return found;
}

function scannedSourceFiles() {
  const modules = readdirSync(PARTS_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
  return [...modules, ...SCANNED_PAGE_FILES.map((name) => join(SRC_DIR, name))];
}

/** The key a file appears under in `DECLARED_HELPERS`, relative to `src/parts/`. */
function registryKey(file) {
  const posix = file.replaceAll("\\", "/");
  const parts = `${PARTS_DIR.replaceAll("\\", "/")}/`;
  if (posix.startsWith(parts)) return posix.slice(parts.length);
  return `../${posix.slice(SRC_DIR.replaceAll("\\", "/").length + 1)}`;
}

/** The doc comment immediately above a declaration, or `""` if there is not one. */
function docCommentAbove(source, declarationIndex) {
  const preceding = source.slice(0, declarationIndex).replace(/\bexport\s*$/, "").trimEnd();
  if (!preceding.endsWith("*/")) return "";
  const opening = preceding.lastIndexOf("/*");
  return opening === -1 ? "" : preceding.slice(opening);
}

test("the numeric-helper scan can see a helper (A3 negative control)", () => {
  // Without this, a scan that matches nothing passes the test below on a tree that holds
  // nine of them. A green grep that sees nothing is the failure mode cycle 08's review
  // found, and the reason this file exists.
  const namedLikeCoercion = ["function finiteOrSomething(value) {", "  return value;", "}"].join("\n");
  assert.deepEqual(findHelpers(namedLikeCoercion), ["finiteOrSomething"], "name detector is blind");

  const innocentlyNamed = [
    "function measure(value) {",
    "  const number = Number(value);",
    "  return Number.isFinite(number) ? number : null;",
    "}"
  ].join("\n");
  assert.deepEqual(findHelpers(innocentlyNamed), ["measure"], "body detector is blind");

  const delegating = [
    "import { asFiniteNumber } from './contracts.js';",
    "function measure(value) {",
    "  return asFiniteNumber(value, 0);",
    "}"
  ].join("\n");
  assert.deepEqual(findHelpers(delegating), [], "delegating to contracts.js must not be flagged");

  const callSite = "const width = asPositiveNumber(input, 1);";
  assert.deepEqual(findHelpers(callSite), [], "a call site is not a definition");
});

test("every private numeric helper in the scanned tree is declared and justified", () => {
  const found = {};

  for (const file of scannedSourceFiles()) {
    const name = registryKey(file);
    if (name === "contracts.js") continue; // the shared module is where they are meant to live
    const helpers = findHelpers(readFileSync(file, "utf8"));
    if (helpers.length > 0) found[name] = helpers.sort();
  }

  const expected = Object.fromEntries(
    Object.entries(DECLARED_HELPERS).map(([file, decisions]) => [file, Object.keys(decisions).sort()])
  );

  assert.deepEqual(
    found,
    expected,
    "A private finite/positive helper appeared, moved, or stopped delegating. Decide whether " +
      "it is a distinct contract or a re-implementation of contracts.js, then record the " +
      "decision in DECLARED_HELPERS and in a doc comment on the helper itself."
  );
});

test("every declared helper carries a doc comment naming what it is not", () => {
  for (const [file, decisions] of Object.entries(DECLARED_HELPERS)) {
    const source = readFileSync(join(PARTS_DIR, file), "utf8");
    for (const helper of Object.keys(decisions)) {
      const index = source.indexOf(`function ${helper}(`);
      assert.ok(index > 0, `${file}: ${helper} not found`);
      const doc = docCommentAbove(source, index);
      assert.notEqual(doc, "", `${file}: ${helper} has no doc comment`);
      assert.ok(
        SHARED_SYMBOLS.some((symbol) => doc.includes(symbol)),
        `${file}: ${helper}'s comment must name the shared helper or contracts.js it is not`
      );
    }
  }
});

test("the doc-comment check rejects a comment that justifies nothing (A3 negative control)", () => {
  const bannerOnly = ["/* ---------------- geometry */", "function finiteOrNull(value) {", "  return value;", "}"].join(
    "\n"
  );
  const doc = docCommentAbove(bannerOnly, bannerOnly.indexOf("function finiteOrNull("));
  assert.notEqual(doc, "", "a banner is still a comment - the weak check would stop here and pass");
  assert.equal(
    SHARED_SYMBOLS.some((symbol) => doc.includes(symbol)),
    false,
    "a banner must not satisfy the justification requirement"
  );

  const justified = ["/** Not asFiniteNumber: it refuses rather than substituting. */", "function finiteOrNull() {}"].join(
    "\n"
  );
  const justifiedDoc = docCommentAbove(justified, justified.indexOf("function finiteOrNull("));
  assert.ok(SHARED_SYMBOLS.some((symbol) => justifiedDoc.includes(symbol)));

  const noComment = "function finiteOrNull(value) {\n  return value;\n}";
  assert.equal(docCommentAbove(noComment, noComment.indexOf("function finiteOrNull(")), "");
});

test("no private issue helper survives (cycle 01's headline contract)", () => {
  for (const file of scannedSourceFiles()) {
    const source = readFileSync(file, "utf8");
    assert.equal(/function\s+issue\s*\(|const\s+issue\s*=\s*\(/.test(source), false, `${file} defines a private issue`);
  }

  // Negative control for the line above.
  const violating = "function issue(code, message) { return { code, message }; }";
  assert.equal(/function\s+issue\s*\(|const\s+issue\s*=\s*\(/.test(violating), true);
});

test("contracts.js still holds the four shared coercions cycle 01 extracted", () => {
  assert.equal(isFiniteNumber("3"), true);
  assert.equal(isFiniteNumber("wide"), false);
  assert.equal(isPositiveNumber(0), false);
  assert.equal(isPositiveNumber(3), true);
  assert.equal(asFiniteNumber("wide", 7), 7);
  assert.equal(asPositiveNumber(-1, 7), 7);
});

test("resize's positiveNumber keeps the > 0 threshold the shared default would round away", () => {
  // asPositiveNumber's default minimum is Number.EPSILON; resize.js passes 0 instead, so
  // a legitimately sub-epsilon dimension is scaled rather than replaced by the fallback.
  const subEpsilon = Number.EPSILON / 2;
  assert.equal(asPositiveNumber(subEpsilon, 1), 1, "the shared default rejects it");
  assert.equal(asPositiveNumber(subEpsilon, 1, 0), subEpsilon, "resize's binding keeps it");
});
