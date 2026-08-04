import assert from "node:assert/strict";
import test from "node:test";

import { ISSUE_SEVERITIES, createIssue } from "../../src/parts/issues.js";
import { isFiniteNumber, isPositiveNumber } from "../../src/parts/contracts.js";

test("createIssue defaults to error severity and keeps the legacy shape", () => {
  assert.deepEqual(createIssue("bad-thing", "Bad thing.", "body.sketch"), {
    code: "bad-thing",
    message: "Bad thing.",
    path: "body.sketch",
    severity: "error"
  });
});

test("createIssue carries advisory severities and extra fields for manufacturability", () => {
  const issue = createIssue("dfm-min-wall", "Wall is thin.", "body", "warning", {
    measuredMm: 0.9,
    limitMm: 1.2
  });

  assert.equal(issue.severity, "warning");
  assert.equal(issue.measuredMm, 0.9);
  assert.equal(issue.limitMm, 1.2);
});

test("issue severities are ordered most to least severe", () => {
  assert.deepEqual([...ISSUE_SEVERITIES], ["error", "warning", "info"]);
});

test("shared numeric guards match the private helpers they replaced", () => {
  assert.equal(isFiniteNumber(3), true);
  assert.equal(isFiniteNumber("3"), true);
  assert.equal(isFiniteNumber(Number.NaN), false);
  assert.equal(isFiniteNumber(Number.POSITIVE_INFINITY), false);
  assert.equal(isFiniteNumber(null), true, "Number(null) is 0, matching the original helper");

  assert.equal(isPositiveNumber(0.1), true);
  assert.equal(isPositiveNumber(0), false);
  assert.equal(isPositiveNumber(-1), false);
  assert.equal(isPositiveNumber("abc"), false);
});
