import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jscad from "@jscad/modeling";
import { buildPartSolids } from "./generate-six-axis-arm.mjs";

const { geom3 } = jscad.geometries;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DRAWINGS_DIR = path.join(ROOT_DIR, "drawings");
const PARTS_DIR = path.join(DRAWINGS_DIR, "parts");

const ISO_COS = Math.cos(Math.PI / 6);
const ISO_SIN = Math.sin(Math.PI / 6);

const PALETTE = [
  { h: 205, s: 20, accent: "#1d4ed8" },
  { h: 188, s: 22, accent: "#0e7490" },
  { h: 216, s: 14, accent: "#475569" },
  { h: 166, s: 22, accent: "#0f766e" },
  { h: 33, s: 24, accent: "#a16207" },
  { h: 262, s: 16, accent: "#6d5bd0" }
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cleanNumber(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function projectPoint(point) {
  const [x, y, z] = point;
  return {
    x: (x - y) * ISO_COS,
    y: -z + (x + y) * ISO_SIN,
    depth: x + y + z * 1.25
  };
}

function normalForTriangle(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function faceShade(vertices, palette) {
  if (vertices.length < 3) return `hsl(${palette.h}, ${palette.s}%, 72%)`;
  const normal = normalForTriangle(vertices[0], vertices[1], vertices[2]);
  const light = [-0.45, -0.35, 0.82];
  const dot = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
  const lightness = Math.round(46 + dot * 34);
  return `hsl(${palette.h}, ${palette.s}%, ${lightness}%)`;
}

function buildProjectedFaces(solid, palette) {
  const faces = [];
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };

  for (const polygon of geom3.toPolygons(solid)) {
    const vertices = polygon.vertices;
    if (vertices.length < 3) continue;
    const projected = vertices.map(projectPoint);
    for (const point of projected) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    faces.push({
      projected,
      fill: faceShade(vertices, palette),
      depth: projected.reduce((total, point) => total + point.depth, 0) / projected.length
    });
  }

  faces.sort((a, b) => a.depth - b.depth);
  return { faces, bounds };
}

function boundsSize(bounds) {
  return {
    width: Math.max(1, bounds.maxX - bounds.minX),
    height: Math.max(1, bounds.maxY - bounds.minY)
  };
}

function renderFaces(faces, bounds, box, options = {}) {
  const { width, height } = boundsSize(bounds);
  const scale = Math.min(box.width / width, box.height / height);
  const offsetX = box.x + (box.width - width * scale) / 2 - bounds.minX * scale;
  const offsetY = box.y + (box.height - height * scale) / 2 - bounds.minY * scale;
  const strokeWidth = options.strokeWidth ?? 0.18;
  const strokeOpacity = options.strokeOpacity ?? 0.06;
  const stroke = options.stroke ?? "#0f172a";
  const opacity = options.opacity ?? 1;
  const strokeAttrs =
    strokeWidth > 0
      ? ` stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"`
      : "";

  return faces
    .map((face) => {
      const points = face.projected
        .map((point) => `${cleanNumber(point.x * scale + offsetX)},${cleanNumber(point.y * scale + offsetY)}`)
        .join(" ");
      return `<polygon points="${points}" fill="${face.fill}"${strokeAttrs} opacity="${opacity}"/>`;
    })
    .join("\n");
}

function baseSvg({ width, height, title, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M 1 1 L 11 6 L 1 11 z" fill="#111827"/>
    </marker>
    <style>
      .sheet-bg { fill: #f8fafc; }
      .panel { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1.4; }
      .title { font: 800 36px Arial, sans-serif; fill: #0f172a; }
      .subtitle { font: 400 18px Arial, sans-serif; fill: #475569; }
      .label { font: 800 22px Arial, sans-serif; fill: #0f172a; }
      .body { font: 400 16px Arial, sans-serif; fill: #475569; }
      .small { font: 400 14px Arial, sans-serif; fill: #64748b; }
      .tiny { font: 400 12px Arial, sans-serif; fill: #64748b; }
      .part-num { font: 800 24px Arial, sans-serif; fill: #ffffff; }
      .axis { stroke: #2563eb; stroke-width: 6; fill: none; marker-end: url(#arrow); }
      .arrow { stroke: #111827; stroke-width: 4; fill: none; marker-end: url(#arrow); }
      .ghost { fill: #e2e8f0; stroke: #475569; stroke-width: 2.4; }
      .ghost2 { fill: #dbeafe; stroke: #1d4ed8; stroke-width: 2.4; }
      .teal { fill: #0f766e; stroke: #064e3b; stroke-width: 2.4; }
      .blue { fill: #2563eb; stroke: #1e3a8a; stroke-width: 2.4; }
      .gold { fill: #ca8a04; stroke: #713f12; stroke-width: 2.4; }
      .line { stroke: #334155; stroke-width: 4; fill: none; }
      .dash { stroke: #94a3b8; stroke-width: 2.2; fill: none; stroke-dasharray: 9 7; }
      .callout { fill: #111827; }
    </style>
  </defs>
  <rect class="sheet-bg" x="0" y="0" width="${width}" height="${height}"/>
${body}
</svg>
`;
}

function partFileBase(fileName) {
  return fileName.replace(/\.stl$/i, ".svg");
}

function partSheetName(pageIndex) {
  const start = pageIndex * 4 + 1;
  const end = start + 3;
  return `part_sheet_${String(start).padStart(2, "0")}_${String(end).padStart(2, "0")}.svg`;
}

function callout(x, y, number, text, options = {}) {
  const radius = options.radius ?? 20;
  return `
  <circle class="callout" cx="${x}" cy="${y}" r="${radius}"/>
  <text class="part-num" x="${x - (number >= 10 ? 14 : 7)}" y="${y + 8}">${number}</text>
  <text class="${options.className ?? "body"}" x="${x + radius + 12}" y="${y + 6}">${escapeXml(text)}</text>`;
}

function partCard(part, index, x, y, width, height, options = {}) {
  const palette = PALETTE[index % PALETTE.length];
  const { faces, bounds } = buildProjectedFaces(part.solid, palette);
  const metrics = part.metrics;
  const dimensions = metrics.boundsMm.size.map((value) => `${cleanNumber(value, 1)} mm`).join(" x ");
  const label = `${String(index + 1).padStart(2, "0")} ${part.definition.name}`;
  const imageBox = {
    x: x + 34,
    y: y + 92,
    width: width - 68,
    height: height - 190
  };
  const interfaces = part.definition.interfaces.join(", ");
  const strokeWidth = options.compact ? 0.08 : 0.12;

  return `
  <rect class="panel" x="${x}" y="${y}" width="${width}" height="${height}" rx="14"/>
  <circle cx="${x + 38}" cy="${y + 38}" r="22" fill="#111827"/>
  <text class="part-num" x="${x + 24}" y="${y + 46}">${String(index + 1).padStart(2, "0")}</text>
  <text class="label" x="${x + 74}" y="${y + 36}">${escapeXml(part.definition.name)}</text>
  <text class="small" x="${x + 74}" y="${y + 61}">${escapeXml(part.definition.fileName)}</text>
  <rect x="${imageBox.x - 12}" y="${imageBox.y - 12}" width="${imageBox.width + 24}" height="${imageBox.height + 24}" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
  ${renderFaces(faces, bounds, imageBox, { strokeWidth, strokeOpacity: 0.045 })}
  <text class="body" x="${x + 34}" y="${y + height - 62}">${escapeXml(part.definition.jointRole)}</text>
  <text class="small" x="${x + 34}" y="${y + height - 36}">Bounds: ${escapeXml(dimensions)} | Interfaces: ${escapeXml(interfaces)}</text>`;
}

function renderPartDrawing(part, index) {
  const body = `
  <text class="title" x="44" y="58">${escapeXml(part.definition.name)}</text>
  <text class="subtitle" x="44" y="86">Large technical view generated from the STL source solid.</text>
  ${partCard(part, index, 44, 118, 1112, 742)}`;
  return baseSvg({ width: 1200, height: 900, title: part.definition.name, body });
}

function renderPartSheet(parts, pageIndex) {
  const pageParts = parts.slice(pageIndex * 4, pageIndex * 4 + 4);
  const positions = [
    [56, 128],
    [820, 128],
    [56, 624],
    [820, 624]
  ];
  const cards = pageParts
    .map((part, offset) => partCard(part, pageIndex * 4 + offset, positions[offset][0], positions[offset][1], 704, 438, { compact: true }))
    .join("\n");
  const first = pageIndex * 4 + 1;
  const last = first + pageParts.length - 1;

  return baseSvg({
    width: 1580,
    height: 1110,
    title: `STL object drawings ${first}-${last}`,
    body: `
  <text class="title" x="56" y="58">STL Object Drawings ${String(first).padStart(2, "0")}-${String(last).padStart(2, "0")}</text>
  <text class="subtitle" x="56" y="88">Four large panels per sheet for readable part geometry and labels.</text>
${cards}`
  });
}

function renderContactSheet(parts) {
  const cardWidth = 820;
  const cardHeight = 380;
  const margin = 58;
  const headerHeight = 126;
  const width = margin * 2 + cardWidth * 2 + 36;
  const rows = Math.ceil(parts.length / 2);
  const height = headerHeight + rows * (cardHeight + 28) + 50;
  const cards = parts
    .map((part, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      return partCard(part, index, margin + col * (cardWidth + 36), headerHeight + row * (cardHeight + 28), cardWidth, cardHeight, {
        compact: true
      });
    })
    .join("\n");

  return baseSvg({
    width,
    height,
    title: "All generated STL object drawings",
    body: `
  <text class="title" x="${margin}" y="58">All Generated STL Objects</text>
  <text class="subtitle" x="${margin}" y="90">Readable two-column contact sheet. For presentation, use the four part_sheet SVGs.</text>
${cards}`
  });
}

function renderAssemblySketch() {
  const body = `
  <text class="title" x="60" y="60">Full Arm Assembly Sketch</text>
  <text class="subtitle" x="60" y="92">Large exploded layout on top, assembled axis layout below. Numbers match the STL object drawings.</text>

  <rect class="panel" x="60" y="126" width="1680" height="480" rx="16"/>
  <text class="label" x="96" y="168">Exploded build order</text>

  <ellipse class="ghost" cx="190" cy="496" rx="118" ry="32"/>
  <rect class="ghost" x="152" y="342" width="76" height="154" rx="13"/>
  <rect class="ghost" x="118" y="305" width="144" height="44" rx="12"/>
  <path class="axis" d="M 190 518 L 190 274"/>
  ${callout(105, 495, 1, "base yaw turntable")}
  ${callout(262, 325, 2, "rotating column")}

  <path class="arrow" d="M 326 420 L 408 386"/>
  <rect class="ghost" x="446" y="266" width="42" height="220" rx="12"/>
  <rect class="ghost" x="590" y="266" width="42" height="220" rx="12"/>
  <circle class="blue" cx="467" cy="366" r="22"/>
  <circle class="blue" cx="611" cy="366" r="22"/>
  <path class="axis" d="M 410 366 L 662 366"/>
  ${callout(452, 225, 3, "shoulder yoke pair")}

  <path class="arrow" d="M 672 366 L 760 332"/>
  <path class="ghost" d="M 790 352 L 1014 268 L 1052 346 L 828 430 z"/>
  <path class="ghost" d="M 810 408 L 1034 324 L 1072 402 L 848 486 z" opacity="0.72"/>
  <circle class="teal" cx="818" cy="390" r="38"/>
  <circle class="teal" cx="1048" cy="356" r="40"/>
  <path class="axis" d="M 762 390 L 876 390"/>
  <path class="axis" d="M 996 356 L 1110 356"/>
  ${callout(795, 225, 4, "upper arm shells")}
  ${callout(1038, 267, 5, "elbow hub")}

  <path class="arrow" d="M 1112 356 L 1198 346"/>
  <path class="ghost" d="M 1232 360 L 1420 300 L 1453 372 L 1264 432 z"/>
  <path class="ghost" d="M 1248 414 L 1436 354 L 1468 426 L 1280 486 z" opacity="0.72"/>
  <circle class="teal" cx="1262" cy="396" r="34"/>
  <circle class="teal" cx="1445" cy="388" r="34"/>
  ${callout(1245, 265, 6, "forearm shells")}

  <path class="arrow" d="M 1498 388 L 1564 388"/>
  <circle class="ghost2" cx="1618" cy="388" r="54"/>
  <path class="axis" d="M 1550 388 L 1686 388"/>
  ${callout(1554, 256, 7, "wrist roll")}
  <path class="ghost" d="M 1668 330 L 1732 330 L 1732 446 L 1668 446 z" opacity="0.3"/>

  <rect class="panel" x="60" y="646" width="1680" height="474" rx="16"/>
  <text class="label" x="96" y="688">Assembled side profile and six axes</text>
  <ellipse class="ghost" cx="220" cy="1030" rx="126" ry="34"/>
  <rect class="ghost" x="176" y="824" width="88" height="206" rx="14"/>
  <rect class="ghost" x="132" y="782" width="176" height="54" rx="14"/>
  <circle class="blue" cx="220" cy="812" r="28"/>
  <path class="line" d="M 220 812 L 500 670 L 786 754 L 1018 754"/>
  <path class="line" d="M 220 864 L 512 724 L 792 810 L 1024 810"/>
  <circle class="teal" cx="220" cy="838" r="40"/>
  <circle class="teal" cx="506" cy="697" r="42"/>
  <circle class="teal" cx="790" cy="782" r="38"/>
  <circle class="blue" cx="1048" cy="782" r="52"/>
  <path class="ghost" d="M 1090 730 L 1220 730 L 1262 782 L 1220 834 L 1090 834 z"/>
  <circle class="ghost2" cx="1328" cy="782" r="48"/>
  <rect class="ghost" x="1392" y="744" width="154" height="76" rx="14"/>

  <path class="axis" d="M 220 1060 L 220 788"/>
  <path class="axis" d="M 154 838 L 292 838"/>
  <path class="axis" d="M 442 697 L 568 697"/>
  <path class="axis" d="M 980 782 L 1116 782"/>
  <path class="axis" d="M 1188 782 L 1308 782"/>
  <path class="axis" d="M 1328 852 L 1328 714"/>
  <text class="body" x="252" y="994">J1 yaw</text>
  <text class="body" x="308" y="832">J2 shoulder pitch</text>
  <text class="body" x="590" y="692">J3 elbow pitch</text>
  <text class="body" x="958" y="720">J4 wrist roll</text>
  <text class="body" x="1168" y="706">J5 wrist pitch</text>
  <text class="body" x="1365" y="706">J6 tool roll</text>
  <path class="dash" d="M 230 910 L 506 764"/>
  <text class="small" x="338" y="920">upper arm link, 138 mm pivot span</text>
  <path class="dash" d="M 518 806 L 790 888"/>
  <text class="small" x="600" y="902">forearm link, 118 mm pivot span</text>
  ${callout(1620, 747, 8, "tool flange + adapter", { className: "body" })}
  `;

  return baseSvg({ width: 1800, height: 1180, title: "Full Arm Assembly Sketch", body });
}

function stepCard(x, y, number, title, description, iconBody) {
  return `
  <rect class="panel" x="${x}" y="${y}" width="520" height="300" rx="16"/>
  <circle class="callout" cx="${x + 46}" cy="${y + 48}" r="24"/>
  <text class="part-num" x="${x + 38}" y="${y + 57}">${number}</text>
  <text class="label" x="${x + 86}" y="${y + 43}">${escapeXml(title)}</text>
  <text class="body" x="${x + 86}" y="${y + 70}">${escapeXml(description)}</text>
  ${iconBody}`;
}

function renderAssemblySteps() {
  const body = `
  <text class="title" x="60" y="60">Assembly Steps</text>
  <text class="subtitle" x="60" y="92">Build one joint group at a time. Check pin fit and free motion before adding the next group.</text>
  ${stepCard(
    60,
    132,
    1,
    "Base + J1 column",
    "Bolt column to turntable.",
    `<ellipse class="ghost" cx="222" cy="360" rx="108" ry="30"/>
     <rect class="ghost" x="184" y="218" width="76" height="142" rx="12"/>
     <path class="axis" d="M 222 382 L 222 190"/>
     <text class="body" x="286" y="286">J1 yaw axis</text>`
  )}
  ${stepCard(
    640,
    132,
    2,
    "Shoulder yoke pair",
    "Install left and right plates.",
    `<rect class="ghost" x="748" y="220" width="48" height="160" rx="12"/>
     <rect class="ghost" x="902" y="220" width="48" height="160" rx="12"/>
     <circle class="blue" cx="772" cy="292" r="24"/>
     <circle class="blue" cx="926" cy="292" r="24"/>
     <path class="axis" d="M 714 292 L 982 292"/>`
  )}
  ${stepCard(
    1220,
    132,
    3,
    "Upper arm + elbow",
    "Sandwich hub between arm shells.",
    `<path class="ghost" d="M 1340 340 L 1516 250 L 1560 330 L 1384 420 z"/>
     <circle class="teal" cx="1350" cy="350" r="34"/>
     <circle class="teal" cx="1540" cy="322" r="38"/>
     <path class="axis" d="M 1295 350 L 1410 350"/>
     <path class="axis" d="M 1480 322 L 1605 322"/>`
  )}
  ${stepCard(
    60,
    492,
    4,
    "Forearm pair",
    "Connect forearm shells to elbow.",
    `<path class="ghost" d="M 178 704 L 344 640 L 386 708 L 220 772 z"/>
     <circle class="teal" cx="188" cy="716" r="34"/>
     <circle class="teal" cx="366" cy="704" r="34"/>
     <path class="arrow" d="M 400 704 L 510 682"/>`
  )}
  ${stepCard(
    640,
    492,
    5,
    "Wrist stack",
    "Add J4, J5, and J6.",
    `<circle class="ghost2" cx="780" cy="704" r="50"/>
     <path class="ghost" d="M 858 654 L 960 654 L 1002 704 L 960 754 L 858 754 z"/>
     <circle class="blue" cx="1048" cy="704" r="46"/>
     <path class="axis" d="M 704 704 L 1118 704"/>`
  )}
  ${stepCard(
    1220,
    492,
    6,
    "Tool + support parts",
    "Mount adapter, cover, spacers.",
    `<circle class="ghost2" cx="1350" cy="710" r="52"/>
     <rect class="ghost" x="1420" y="670" width="134" height="80" rx="14"/>
     <rect class="gold" x="1580" y="688" width="82" height="44" rx="8"/>
     <path class="arrow" d="M 1402 710 L 1418 710"/>
     <path class="arrow" d="M 1556 710 L 1576 710"/>`
  )}
  `;
  return baseSvg({ width: 1800, height: 850, title: "Assembly Steps", body });
}

function renderIndexHtml(parts) {
  const sheetLinks = Array.from({ length: Math.ceil(parts.length / 4) }, (_, pageIndex) => {
    const file = partSheetName(pageIndex);
    return `<a class="sheet" href="${file}">Part sheet ${pageIndex + 1}<img src="${file}" alt="Part sheet ${pageIndex + 1}"></a>`;
  }).join("\n");
  const partLinks = parts
    .map((part, index) => {
      const file = `parts/${partFileBase(part.definition.fileName)}`;
      return `<li><a href="${escapeXml(file)}">${String(index + 1).padStart(2, "0")} ${escapeXml(part.definition.name)}</a><span>${escapeXml(part.definition.jointRole)}</span></li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Six-Axis Arm Drawings</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; background: #f8fafc; }
    main { max-width: 1280px; margin: 0 auto; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 38px; }
    p { color: #475569; line-height: 1.5; }
    .hero, .sheets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin: 24px 0; }
    .hero a, .sheet, li { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; }
    .hero a, .sheet { display: block; padding: 14px; color: #0f172a; text-decoration: none; font-weight: 700; }
    img { display: block; width: 100%; height: auto; margin-top: 12px; border: 1px solid #e2e8f0; }
    ul { list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0; }
    li { padding: 12px 14px; }
    li a { display: block; color: #1d4ed8; font-weight: 700; text-decoration: none; }
    li span { display: block; margin-top: 4px; color: #64748b; font-size: 13px; }
    @media (max-width: 800px) { main { padding: 18px; } .hero, .sheets, ul { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Six-Axis Arm Drawings</h1>
    <p>Clear technical drawings generated from the same original procedural solids used for the STL kit. Existing workspace STL assets are not used as drawing input.</p>
    <section class="hero">
      <a href="assembly_sketch.svg">Full arm assembly sketch<img src="assembly_sketch.svg" alt="Full arm assembly sketch"></a>
      <a href="assembly_steps.svg">Assembly steps<img src="assembly_steps.svg" alt="Assembly steps"></a>
    </section>
    <h2>Readable Part Sheets</h2>
    <section class="sheets">
${sheetLinks}
    </section>
    <h2>Individual STL Object Drawings</h2>
    <ul>
${partLinks}
    </ul>
  </main>
</body>
</html>
`;
}

export async function drawKit() {
  await fs.mkdir(PARTS_DIR, { recursive: true });
  const parts = buildPartSolids();

  await Promise.all(
    parts.map((part, index) =>
      fs.writeFile(path.join(PARTS_DIR, partFileBase(part.definition.fileName)), renderPartDrawing(part, index), "utf8")
    )
  );

  await Promise.all(
    Array.from({ length: Math.ceil(parts.length / 4) }, (_, pageIndex) =>
      fs.writeFile(path.join(DRAWINGS_DIR, partSheetName(pageIndex)), renderPartSheet(parts, pageIndex), "utf8")
    )
  );

  await fs.writeFile(path.join(DRAWINGS_DIR, "all_stl_objects.svg"), renderContactSheet(parts), "utf8");
  await fs.writeFile(path.join(DRAWINGS_DIR, "assembly_sketch.svg"), renderAssemblySketch(), "utf8");
  await fs.writeFile(path.join(DRAWINGS_DIR, "assembly_steps.svg"), renderAssemblySteps(), "utf8");
  await fs.writeFile(path.join(DRAWINGS_DIR, "parts_index.html"), renderIndexHtml(parts), "utf8");

  console.log(`Wrote clear drawings for ${parts.length} STL objects to ${path.relative(process.cwd(), DRAWINGS_DIR)}`);
}

if (process.argv[1] === __filename) {
  await drawKit();
}
