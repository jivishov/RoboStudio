/**
 * The drawing sheet: A3, views, dimensions, a hole table and a title block, as SVG text.
 *
 * ## Why a string rather than DOM
 *
 * The sheet is a document. Returning markup keeps this module DOM-free like the rest of
 * `drawings/`, lets the page insert it in one assignment, and - the reason that decided it
 * - lets a test **parse the emitted SVG** rather than snapshot it. A snapshot of an SVG
 * pins the renderer's formatting rather than the drawing's correctness and churns on every
 * unrelated change; cycle 04's DXF group-code parser is the pattern being copied.
 *
 * ## Legible with colour disabled
 *
 * A drawing whose dimension lines vanish on a black-and-white printer is not a drawing. So
 * **no line role is distinguished by colour alone**: visible is solid, hidden is dashed,
 * centre is dash-dot, and the weights differ too. Colour comes from `tokens.css` through
 * custom properties with fallbacks, so the sheet follows the page's palette instead of
 * founding a second one - and losing the palette entirely loses nothing but the tint.
 *
 * ## Nominal, and it says so on the sheet
 *
 * Every dimension is the number the designer authored. The title block states it, because
 * a shop reading this needs to know it is not looking at as-made figures - those are
 * `bodyCompensationReport`'s, under their own labels, in the Manufacturability card.
 */

import { bodyDimensions, formatDimension } from "./dimensions.js";
import { bodyHoleTable, describePocketNote } from "./holeTable.js";
import { isometricFaces, meshExtents } from "./isometric.js";
import { LINE_CENTRE, LINE_HIDDEN, bodyOrthographicViews, DRAWING_DATUM, taggedCuts } from "./views.js";

/** ISO A3 landscape, in millimetres. The sheet's user units are millimetres of paper. */
export const SHEET_WIDTH_MM = 420;
export const SHEET_HEIGHT_MM = 297;
const MARGIN_MM = 10;
const TITLE_BLOCK_HEIGHT_MM = 40;
const TITLE_BLOCK_WIDTH_MM = 170;

/**
 * Line styling per role, and the reason it is not colour.
 *
 * Every role differs in **dash pattern and weight** as well as tint, so the three survive a
 * greyscale printer, a monochrome laser, and a photocopy. Colour is the last of the three
 * signals rather than the only one.
 */
const LINE_STYLE = Object.freeze({
  visible: { width: 0.5, dash: "", stroke: "var(--rs-text, #141922)" },
  hidden: { width: 0.3, dash: "2 1.5", stroke: "var(--rs-muted, #4f5b6b)" },
  centre: { width: 0.25, dash: "6 1.5 1 1.5", stroke: "var(--rs-soft, #7d8795)" }
});

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function strokeAttrs(role) {
  const style = LINE_STYLE[role] ?? LINE_STYLE.visible;
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
  return `fill="none" stroke="${style.stroke}" stroke-width="${style.width}"${dash}`;
}

/**
 * One view entity as SVG, in the view's own millimetre frame.
 *
 * A circle stays a `<circle>` and a rounded rectangle stays a `<rect rx>`, which is the
 * whole point of deriving from the sketch: the emitted markup is as analytic as the
 * profile it came from, and a test can read a diameter back out of it.
 */
function entityMarkup(entity) {
  const attrs = strokeAttrs(entity.role);
  const tag = ` data-entity="${escapeXml(entity.id)}" data-role="${escapeXml(entity.role)}"`;

  if (entity.kind === "circle") {
    return `<circle cx="${round(entity.cu)}" cy="${round(entity.cv)}" r="${round(entity.diameterMm / 2)}" `
      + `${attrs}${tag} data-diameter-mm="${round(entity.diameterMm)}"/>`;
  }
  if (entity.kind === "rect") {
    const rx = entity.cornerRadiusMm > 0 ? ` rx="${round(entity.cornerRadiusMm)}"` : "";
    return `<rect x="${round(entity.cu - entity.widthMm / 2)}" y="${round(entity.cv - entity.heightMm / 2)}" `
      + `width="${round(entity.widthMm)}" height="${round(entity.heightMm)}"${rx} ${attrs}${tag}/>`;
  }
  if (entity.kind === "slot") {
    const radius = entity.widthMm / 2;
    return `<rect x="${round(entity.cu - entity.lengthMm / 2)}" y="${round(entity.cv - entity.widthMm / 2)}" `
      + `width="${round(entity.lengthMm)}" height="${round(entity.widthMm)}" rx="${round(radius)}" ${attrs}${tag}/>`;
  }
  if (entity.kind === "polyline") {
    const points = entity.points.map(([u, v]) => `${round(u)},${round(v)}`).join(" ");
    return `<polygon points="${points}" ${attrs}${tag}/>`;
  }
  if (entity.kind === "line") {
    return `<line x1="${round(entity.from[0])}" y1="${round(entity.from[1])}" `
      + `x2="${round(entity.to[0])}" y2="${round(entity.to[1])}" ${attrs}${tag}/>`;
  }
  return "";
}

/**
 * Place one view at an already-decided scale and origin.
 *
 * ⚠ The scale is **not** chosen here, and the first draft of this file got that wrong: it
 * fitted each view to its own box independently, so a 120 mm-wide top view came out at
 * 1.25x and an 80 mm-deep right view at 0.75x. Three views of one part at three scales is
 * not an orthographic drawing - it is three pictures - and it was only visible by looking
 * at a rendered sheet, which is why the check for this asks for a browser and not an
 * assertion. `arrangeViews` decides one scale for all three.
 *
 * The scale is written onto the group because a drawing that does not say what scale it is
 * at is a drawing nobody can measure with a rule.
 */
function placeView(view, scale, origin, labels = new Map()) {
  if (!view.available || !view.extents) return "";
  const widthMm = Math.max(view.extents.widthMm, 1e-6);
  const heightMm = Math.max(view.extents.heightMm, 1e-6);
  const offsetX = origin.x - view.extents.minU * scale;
  const offsetY = origin.y - view.extents.minV * scale;

  const body = view.entities.map(entityMarkup).join("");

  // ⚠ Balloons live OUTSIDE the scaled group, in sheet millimetres. Inside it they would
  // be scaled with the geometry, so a small part would render unreadable type and a large
  // one absurd type - the text has to stay the size the sheet says it is.
  //
  // A cut carries its tag and its size here, and the hole table carries the tag and the
  // full designation: the letter is what ties the two together. Without this the view was
  // an unannotated outline and the reader had nothing to carry to the table.
  const balloons = view.entities
    .filter((entity) => entity.kind === "circle" && labels.has(entity.id))
    .map((entity) => {
      const x = offsetX + entity.cu * scale;
      const y = offsetY + entity.cv * scale;
      const label = labels.get(entity.id);
      return `<text x="${round(x + 1.6)}" y="${round(y - 1.2)}" class="sheet-note" `
        + `data-hole-balloon="${escapeXml(label.tag)}" data-entity="${escapeXml(entity.id)}">`
        + `${escapeXml(`${label.tag} ${label.size}`)}</text>`;
    })
    .join("");

  return (
    `<g data-view="${escapeXml(view.id)}" data-scale="${round(scale, 5)}" `
    + `data-width-mm="${round(widthMm)}" data-height-mm="${round(heightMm)}" `
    + `transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale, 5)})">${body}</g>`
    + balloons
    + `<text x="${round(origin.x)}" y="${round(origin.y - 1.5)}" class="sheet-label">${escapeXml(view.label)}</text>`
  );
}

/** The gap between adjacent views, in sheet millimetres. */
const VIEW_GAP_MM = 14;

/**
 * Third-angle arrangement: the front below the top, the right beside the top.
 *
 * One scale for all three, and the alignment that scale makes meaningful - the front view
 * sits directly under the top view sharing its horizontal extent, and the right view sits
 * directly beside the top sharing its vertical one. That is what lets a reader carry a
 * dimension from one view into another with a straightedge, which is the entire reason
 * orthographic views are drawn as a set rather than as three separate pictures.
 *
 * ⚠ The block's total width uses the **right view's own paper width**, not the front
 * view's height. The first version used the latter - the thickness - and so underestimated
 * the block by the whole depth of the part; on this plate the right view ran 80 mm past
 * the area it was supposed to fit in and only missed the isometric because the two happened
 * to occupy different bands of the sheet. Read from the views rather than re-derived.
 */
function arrangeViews(views, area) {
  const [top, front, right] = views;
  if (!top?.available || !top.extents) return { scale: null, origins: null };

  const widthMm = Math.max(top.extents.widthMm, 1e-6);
  const heightMm = Math.max(top.extents.heightMm, 1e-6);
  const rightWidthMm = Math.max(right?.extents?.widthMm ?? 0, 0);
  const frontHeightMm = Math.max(front?.extents?.heightMm ?? 0, 0);

  const totalWidthMm = widthMm + VIEW_GAP_MM + rightWidthMm;
  const totalHeightMm = heightMm + VIEW_GAP_MM + frontHeightMm;
  const scale = Math.min(area.width / totalWidthMm, area.height / totalHeightMm);

  const x = area.x + (area.width - totalWidthMm * scale) / 2;
  const y = area.y + (area.height - totalHeightMm * scale) / 2;
  return {
    scale,
    origins: {
      top: { x, y },
      front: { x, y: y + (heightMm + VIEW_GAP_MM) * scale },
      right: { x: x + (widthMm + VIEW_GAP_MM) * scale, y }
    }
  };
}

function unavailableView(view, box) {
  return (
    `<g data-view="${escapeXml(view.id)}" data-available="false">`
    + `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" `
    + `fill="none" stroke="${LINE_STYLE.hidden.stroke}" stroke-width="0.3" stroke-dasharray="3 2"/>`
    + `<text x="${round(box.x + box.width / 2)}" y="${round(box.y + box.height / 2)}" class="sheet-note" `
    + `text-anchor="middle">${escapeXml(view.reason)}</text></g>`
  );
}

function isometricMarkup(mesh, box) {
  const projected = isometricFaces(mesh?.vertices, mesh?.triangleCount);
  if (!projected.faces.length || !projected.extents) {
    return `<g data-view="isometric" data-available="false"><text x="${round(box.x)}" y="${round(box.y + 6)}" `
      + `class="sheet-note">No compiled mesh yet, so there is no isometric to draw.</text></g>`;
  }

  const widthMm = Math.max(projected.extents.widthMm, 1e-6);
  const heightMm = Math.max(projected.extents.heightMm, 1e-6);
  const scale = Math.min(box.width / widthMm, box.height / heightMm);
  const offsetX = box.x + (box.width - widthMm * scale) / 2 - projected.extents.minU * scale;
  const offsetY = box.y + (box.height - heightMm * scale) / 2 - projected.extents.minV * scale;

  // The hue and saturation are the page's; `isometric.js` supplies only how lit a face is.
  const faces = projected.faces
    .map((face) => {
      const points = face.points.map(([u, v]) => `${round(u)},${round(v)}`).join(" ");
      return `<polygon points="${points}" fill="hsl(var(--rs-drawing-hue, 214) var(--rs-drawing-sat, 16%) ${face.lightness}%)" `
        + `stroke="var(--rs-text, #141922)" stroke-width="${round(0.15 / scale, 5)}" stroke-opacity="0.25"/>`;
    })
    .join("");

  return (
    `<g data-view="isometric" data-faces="${projected.triangleCount}" `
    + `transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale, 5)})">${faces}</g>`
    + `<text x="${round(box.x)}" y="${round(box.y - 1.5)}" class="sheet-label">Isometric</text>`
  );
}

/**
 * How many dimension lines fit the block before the sheet runs out of paper.
 *
 * ⚠ The last slot is spent on a count of what did not fit, never on one more dimension.
 * This block used to take the first 18 and drop the rest in silence: a 14-hole plate has
 * 31 dimensions, so 13 vanished and the reader had no way to know. `src/parts.js` caps the
 * assistant's payload the same way and carries the true total beside it, for the reason
 * written there - *a truncated list that reads as complete is the same class of dishonesty
 * as a fabricated zero*. A drawing has no second field to put the total in, so it goes on
 * the sheet.
 */
const MAX_DIMENSION_ROWS = 18;

function dimensionsMarkup(dimensionReport, box) {
  const lines = dimensionReport.available
    ? dimensionReport.dimensions.map((entry) => `${entry.tag ? `${entry.tag} ` : ""}${entry.label}: ${formatDimension(entry)}`)
    : [dimensionReport.reason];

  // ⚠ `omitted` counts against what is actually printed, not against the cap. The count
  // line occupies a row, so it displaces a dimension: at 31 dimensions in 18 rows, 17 are
  // shown and **14** are missing, not 13. Deriving it from the cap under-reports by one,
  // which is a truncation notice that is itself slightly untrue.
  const overflowing = lines.length > MAX_DIMENSION_ROWS;
  const shown = overflowing ? lines.slice(0, MAX_DIMENSION_ROWS - 1) : lines;
  const omitted = lines.length - shown.length;
  const printed = overflowing
    ? [...shown, `+${omitted} more dimension${omitted === 1 ? "" : "s"} not shown on this sheet`]
    : shown;

  const rows = printed
    .map(
      (line, index) =>
        `<text x="${round(box.x)}" y="${round(box.y + 4 + index * 4)}" class="sheet-note" `
        + `data-dimension-row="${index}">${escapeXml(line)}</text>`
    )
    .join("");
  return `<g data-block="dimensions" data-datum="${escapeXml(DRAWING_DATUM.id)}" `
    + `data-dimension-total="${lines.length}" data-dimension-omitted="${omitted}">`
    + `<text x="${round(box.x)}" y="${round(box.y)}" class="sheet-label">Dimensions (nominal)</text>${rows}</g>`;
}

function holeTableMarkup(rows, box) {
  if (!rows.length) {
    return `<g data-block="hole-table" data-rows="0"><text x="${round(box.x)}" y="${round(box.y)}" `
      + "class=\"sheet-label\">Hole table</text>"
      + `<text x="${round(box.x)}" y="${round(box.y + 4)}" class="sheet-note">No cut in this body resolves to a fastener.</text></g>`;
  }

  const lines = rows
    .map((row, index) => {
      const note = describePocketNote(row);
      // ⚠ **Every** tag in the group, not just the first. The dimensions block labels each
      // resolved cut A, B, C, D…, and this table groups identical holes into one row - so
      // printing only `row.tag` left B, C and D on the sheet with nothing to look them up
      // in. The letters are the only thing tying the two blocks together, and half of them
      // pointed at a row that did not exist.
      const tags = row.positions.map((position) => position.tag).join(", ");
      const text = `${tags}  x${row.quantity}  ${row.designation}  Ø${round(row.pilotDiameterMm)}${note ? `  (${note})` : ""}`;
      return `<text x="${round(box.x)}" y="${round(box.y + 4 + index * 4)}" class="sheet-note" `
        + `data-hole-row="${escapeXml(row.tag)}" data-hole-tags="${escapeXml(tags)}" `
        + `data-hole-quantity="${row.quantity}" `
        + `data-hole-pilot-mm="${round(row.pilotDiameterMm)}">${escapeXml(text)}</text>`;
    })
    .join("");
  return `<g data-block="hole-table" data-rows="${rows.length}">`
    + `<text x="${round(box.x)}" y="${round(box.y)}" class="sheet-label">Hole table</text>${lines}</g>`;
}

function titleBlockMarkup(body, options, extents) {
  const x = SHEET_WIDTH_MM - MARGIN_MM - TITLE_BLOCK_WIDTH_MM;
  const y = SHEET_HEIGHT_MM - MARGIN_MM - TITLE_BLOCK_HEIGHT_MM;
  const rows = [
    ["Part", body?.name ?? "-"],
    ["Material", options.materialLabel ?? "-"],
    ["Process", options.processLabel ?? "-"],
    ["Units", "mm"],
    // ⚠ On the sheet, not only in a comment. A shop reading this needs to know it is
    // looking at the drawing and not at what a kerf or a nozzle will make of it.
    ["Dimensions", "Nominal as drawn. Kerf and printer compensation are reported separately."],
    ["Datum", DRAWING_DATUM.label]
  ];
  if (extents) {
    rows.push(["Extents", `${round(extents.xMm, 2)} x ${round(extents.yMm, 2)} x ${round(extents.zMm, 2)} mm (measured)`]);
  }

  const lines = rows
    .map(
      ([label, value], index) =>
        `<text x="${round(x + 2)}" y="${round(y + 5 + index * 5)}" class="sheet-note" `
        + `data-title-field="${escapeXml(label)}">${escapeXml(`${label}: ${value}`)}</text>`
    )
    .join("");

  return `<g data-block="title">`
    + `<rect x="${round(x)}" y="${round(y)}" width="${TITLE_BLOCK_WIDTH_MM}" height="${TITLE_BLOCK_HEIGHT_MM}" `
    + `fill="none" stroke="${LINE_STYLE.visible.stroke}" stroke-width="0.5"/>${lines}</g>`;
}

/**
 * The whole sheet for one body.
 *
 * `options.mesh` is the compiled mesh for the isometric - `{ vertices, triangleCount,
 * bounds }`, exactly the shape the CAD worker returns - and everything else is presentation
 * text the page already holds. Nothing here compiles, measures or re-derives geometry.
 */
export function bodyDrawingSheet(body, options = {}) {
  const views = bodyOrthographicViews(body);
  const dimensionReport = bodyDimensions(body);
  const holeRows = bodyHoleTable(body);
  const extents = meshExtents(options.mesh?.bounds);

  const boxes = {
    // The three orthographic views share this one area and one scale inside it.
    orthographic: { x: MARGIN_MM + 8, y: MARGIN_MM + 12, width: 168, height: 226 },
    unavailable: {
      top: { x: MARGIN_MM + 8, y: MARGIN_MM + 12, width: 168, height: 100 },
      front: { x: MARGIN_MM + 8, y: MARGIN_MM + 126, width: 100, height: 100 },
      right: { x: MARGIN_MM + 120, y: MARGIN_MM + 126, width: 56, height: 100 }
    },
    isometric: { x: MARGIN_MM + 188, y: MARGIN_MM + 12, width: 108, height: 116 },
    dimensions: { x: SHEET_WIDTH_MM - MARGIN_MM - 106, y: MARGIN_MM + 14, width: 104, height: 86 },
    holes: { x: SHEET_WIDTH_MM - MARGIN_MM - 106, y: MARGIN_MM + 108, width: 104, height: 60 }
  };

  const arrangement = arrangeViews(views, boxes.orthographic);
  // Ballooned on the top view only. Repeating every tag on all three would treble the
  // clutter to say the same thing once, and the top view is where a hole reads.
  const balloonLabels = new Map(
    taggedCuts(body).map((entry) => [entry.profileId, { tag: entry.tag, size: entry.resolved.spec.size }])
  );
  const viewMarkup = views
    .map((view) =>
      view.available && arrangement.origins
        ? placeView(view, arrangement.scale, arrangement.origins[view.id], view.id === "top" ? balloonLabels : new Map())
        : unavailableView(view, boxes.unavailable[view.id])
    )
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}" `
    + `class="parts-sheet" role="img" data-body-id="${escapeXml(body?.id ?? "")}" `
    + `aria-label="Drawing sheet for ${escapeXml(body?.name ?? "the selected body")}">`
    + `<rect x="0" y="0" width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="var(--rs-panel-strong, #ffffff)"/>`
    + `<rect x="${MARGIN_MM / 2}" y="${MARGIN_MM / 2}" width="${SHEET_WIDTH_MM - MARGIN_MM}" `
    + `height="${SHEET_HEIGHT_MM - MARGIN_MM}" fill="none" stroke="${LINE_STYLE.visible.stroke}" stroke-width="0.7"/>`
    + viewMarkup
    + isometricMarkup(options.mesh, boxes.isometric)
    + dimensionsMarkup(dimensionReport, boxes.dimensions)
    + holeTableMarkup(holeRows, boxes.holes)
    + titleBlockMarkup(body, options, extents)
    + "</svg>"
  );
}
