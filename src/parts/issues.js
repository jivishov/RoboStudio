export const ISSUE_SEVERITIES = Object.freeze(["error", "warning", "info"]);

/**
 * Build a validation or manufacturability issue.
 *
 * `validateBody` is a hard compile and export gate: `cadCompile.js` refuses to
 * compile a body whose issue list is non-empty, regardless of severity. Only
 * structural faults belong there. Advisory findings must be emitted from
 * `validateManufacturability` instead, which shares this shape but is never
 * consulted as a gate.
 */
export function createIssue(code, message, path, severity = "error", extra = null) {
  const issue = { code, message, path, severity };
  return extra ? { ...issue, ...extra } : issue;
}
