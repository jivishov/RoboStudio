import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ABSENT_OUTPUT, formatOutput } from "../../src/parts/format.js";
import { GEAR_PAIR_LOW_CONTACT_RATIO, spurGearPairReport } from "../../src/parts/gearPair.js";

/**
 * Audit A2, absent-not-zero: a derived number the page does not hold must render as
 * absent. The assertions below are on the **rendered string** - not `0`, not `0.000`, not
 * empty - because the property being `null` is what was already true both times this
 * defect shipped (cycle 04's mesh volume, cycle 05's Volume card). Asserting the property
 * would re-check the thing that never failed.
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** The three negatives, applied to whatever text a cell would hold. */
function assertRendersAbsent(rendered, label) {
  assert.notEqual(rendered, "0", `${label} rendered a fabricated 0`);
  assert.notEqual(rendered, "0.000", `${label} rendered a fabricated 0.000`);
  assert.notEqual(rendered, "0.00", `${label} rendered a fabricated 0.00`);
  assert.notEqual(rendered.trim(), "", `${label} rendered an empty cell, which reads as zero`);
  assert.equal(rendered, ABSENT_OUTPUT, `${label} should render the absence marker`);
}

test("an absent value renders as absent, in every shape absence arrives in", () => {
  for (const absent of [null, undefined, "", "  ", Number.NaN, Infinity, -Infinity, "wide"]) {
    assertRendersAbsent(formatOutput(absent, 3), `formatOutput(${String(absent)})`);
  }

  // `Number(null)` and `Number("")` are a perfectly finite 0, which is exactly how an
  // absent volume rendered as "0.000" in cycle 05. The guard is the point of the helper.
  assert.equal(Number.isFinite(Number(null)), true, "the coercion this helper refuses still coerces");
  assert.equal(Number.isFinite(Number("")), true);
});

test("a number the page does hold still renders as that number", () => {
  assert.equal(formatOutput(0, 3), "0.000", "a measured zero is a number and must survive");
  assert.equal(formatOutput(1.23456, 3), "1.235");
  assert.equal(formatOutput("2.5", 2), "2.50");
  assert.equal(formatOutput(-0.5, 1), "-0.5");
});

test("a gear pair with no measurable contact ratio renders a dash, not 0.000", () => {
  // `spurGearPairReport` cannot reach this state through `normalizeSpurGearSpec` today -
  // the module is clamped to >= 0.01 mm and the pressure angle to <= 35 degrees, so the
  // base pitch is always positive. The degenerate branch is therefore checked directly on
  // the report shape the page renders, so that the day normalization loosens, the cell
  // shows a dash instead of a fabricated zero.
  const degenerate = { contactRatio: null, totalContactRatio: null, tipRootClearanceMm: null };
  assertRendersAbsent(formatOutput(degenerate.contactRatio, 3), "Contact ratio");
  assertRendersAbsent(formatOutput(degenerate.totalContactRatio, 3), "Total contact ratio");
  assertRendersAbsent(formatOutput(degenerate.tipRootClearanceMm, 3), "Tip-root gap");
});

test("gearPair states a contact ratio for a real pair and never fabricates one", () => {
  const report = spurGearPairReport({ toothCount: 24, moduleMm: 2 }, { toothCount: 36, moduleMm: 2 });
  assert.equal(report.ok, true);
  assert.ok(Number.isFinite(report.contactRatio) && report.contactRatio > 1);
  assert.equal(formatOutput(report.contactRatio, 3) === ABSENT_OUTPUT, false, "a measured ratio must show");
  assert.ok(Number.isFinite(report.totalContactRatio));

  const source = readFileSync(join(SRC_DIR, "parts", "gearPair.js"), "utf8");
  assert.match(
    source,
    /const contactRatio = basePitchMm > 0 \? lengthOfActionMm \/ basePitchMm : null;/,
    "contactRatio must fall back to null, never to a fabricated 0"
  );
});

test("the low-contact-ratio finding survives the null fallback", () => {
  // The rule used to fire on the fabricated 0 through `contactRatio <= 1`. Turning that 0
  // into `null` must not silently drop a finding: a pair with no measurable ratio is at
  // least as broken as one with a ratio below 1, and it still has to be reported.
  const raised = (contactRatio) => contactRatio == null || contactRatio <= 1;
  assert.equal(raised(null), true, "an absent ratio must still raise the finding");
  assert.equal(raised(0.9), true);
  assert.equal(raised(1), true);
  assert.equal(raised(1.6), false);

  const source = readFileSync(join(SRC_DIR, "parts", "gearPair.js"), "utf8");
  assert.match(source, /if \(contactRatio == null \|\| contactRatio <= 1\) \{/, "the null case must reach the rule");
  // And the message must not call toFixed on the absent case.
  assert.match(source, /contactRatio == null\s*\n\s*\?/, "the absent case needs its own message");
  assert.ok(GEAR_PAIR_LOW_CONTACT_RATIO);
});

test("no output cell in the parts page formats through the input-only formatter", () => {
  // `formatNumber` returns "0" for a non-finite value and "0.0" for `null`, which is
  // correct for an `<input>`'s value and a fabricated number in an output cell. This is
  // the guard that keeps the two from being swapped back.
  const source = readFileSync(join(SRC_DIR, "parts.js"), "utf8");
  const offenders = [...source.matchAll(/createOutputField\(([^;]*?)\)\s*[,)\];]/g)]
    .map((match) => match[1])
    .filter((argumentText) => argumentText.includes("formatNumber("));

  assert.deepEqual(
    offenders,
    [],
    "An output cell is formatting through formatNumber, which renders an absent number as 0. Use formatOutput."
  );

  // Negative control: the scan can see one.
  const violating = 'section.append(createOutputField("Contact ratio", formatNumber(report.contactRatio, 3)));';
  assert.equal(
    [...violating.matchAll(/createOutputField\(([^;]*?)\)\s*[,)\];]/g)].some((match) => match[1].includes("formatNumber(")),
    true,
    "the offender scan is blind"
  );
});
