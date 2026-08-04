/**
 * How a derived number reaches an output cell.
 *
 * This lives beside the modules that produce the numbers rather than inside the page
 * because it is the page's half of audit A2 (absent-not-zero), and the assertion the
 * audit asks for is about the *rendered string* - not about some object property being
 * `null`, which was already true both times the defect shipped. `src/parts.js` cannot be
 * imported by a node test, so the string a cell will hold is only checkable if the
 * function that produces it is.
 *
 * DOM-free on purpose: it returns text, and the caller appends it.
 */

/** What an output cell shows when the page does not hold the number. */
export const ABSENT_OUTPUT = "-";

/**
 * For a rendered output cell: the number, or a dash saying there is not one.
 *
 * A derived number the page does not hold must not render as `0` or `0.000` - a reader
 * cannot tell a fabricated zero from a measured one, and `0.000` mm of tip-root gap is a
 * binding pair while an absent gap is an unanswered question. `null`, `undefined` and
 * `""` are absences and are spelled out here rather than left to `Number`, which maps the
 * first and the last to a perfectly finite `0`.
 *
 * Not `contracts.js`'s `asFiniteNumber`, and not `isFiniteNumber`: those answer with a
 * number for code that has to keep computing. This one answers with display text, and its
 * whole contract is the case where there is no number to answer with.
 */
export function formatOutput(value, digits = 1) {
  if (value == null) return ABSENT_OUTPUT;
  if (typeof value === "string" && value.trim() === "") return ABSENT_OUTPUT;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : ABSENT_OUTPUT;
}
