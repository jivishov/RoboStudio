export const CIRCUIT_CUSTOM_COMPONENT_KIND = "CircuitCustomComponentDefinition";
export const CIRCUIT_CUSTOM_COMPONENT_VERSION = 1;
export const CIRCUIT_CUSTOM_TYPE_PREFIX = "custom:";
export const CIRCUIT_CUSTOM_COMPONENT_KEY_PREFIX = "circuit-custom-component:";

const SAFE_TEXT_MAX = 120;
const TERMINAL_KINDS = new Set(["signal", "power", "ground", "passive", "load"]);
const CONNECTOR_INTERFACES = new Set([
  "female-breadboard-socket",
  "female-controller-header",
  "male-header-pin",
  "component-lead",
  "screw-terminal",
  "servo-female-plug",
  "servo-male-header",
  "pigtail-conductor",
  "solder-lug",
  "motor-tab",
  "jumper-wire-end"
]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeText(value, fallback = "", maxLength = SAFE_TEXT_MAX) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.replace(/\s+/g, " ").slice(0, maxLength);
}

function safeToken(value, fallback = "item") {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return text || fallback;
}

function svgToken(value, fallback = "id") {
  return safeToken(value, fallback).replace(/:/g, "_");
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveNumber(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function requiredPositiveNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive millimeter value.`);
  }
  return numeric;
}

function vector2(value, fallback = [0, 0]) {
  if (!Array.isArray(value)) return [...fallback];
  return [numberOr(value[0], fallback[0] ?? 0), numberOr(value[1], fallback[1] ?? 0)];
}

function bounds(value, fallbackWidth, fallbackHeight) {
  const source = value && typeof value === "object" ? value : {};
  return {
    x: numberOr(source.x, -fallbackWidth / 2),
    y: numberOr(source.y, -fallbackHeight / 2),
    width: positiveNumber(source.width, fallbackWidth),
    height: positiveNumber(source.height, fallbackHeight)
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function basename(value) {
  return String(value ?? "").split(/[\\/]/).at(-1) ?? "";
}

export function customComponentTypeId(id) {
  const raw = String(id ?? "").startsWith(CIRCUIT_CUSTOM_TYPE_PREFIX)
    ? String(id).slice(CIRCUIT_CUSTOM_TYPE_PREFIX.length)
    : String(id ?? "");
  return `${CIRCUIT_CUSTOM_TYPE_PREFIX}${safeToken(raw, "component")}`;
}

export function circuitCustomComponentStorageKey(id) {
  return `${CIRCUIT_CUSTOM_COMPONENT_KEY_PREFIX}${customComponentTypeId(id).slice(CIRCUIT_CUSTOM_TYPE_PREFIX.length)}`;
}

export function isCircuitCustomComponentDefinition(value) {
  return value?.kind === CIRCUIT_CUSTOM_COMPONENT_KIND && Number(value.version) === CIRCUIT_CUSTOM_COMPONENT_VERSION;
}

function sanitizeTerminalKind(value) {
  const kind = String(value ?? "").trim();
  return TERMINAL_KINDS.has(kind) ? kind : "passive";
}

function sanitizeConnectorInterface(value) {
  const connector = String(value ?? "").trim();
  return CONNECTOR_INTERFACES.has(connector) ? connector : "jumper-wire-end";
}

function normalizeTerminal(rawTerminal, index = 0) {
  const id = safeToken(rawTerminal?.id ?? rawTerminal?.terminalId ?? `terminal_${index + 1}`, `terminal_${index + 1}`);
  const positionMm = vector2(rawTerminal?.positionMm ?? rawTerminal?.position, [index * 2.54, 0]);
  const kind = sanitizeTerminalKind(rawTerminal?.kind);
  const label = safeText(rawTerminal?.label ?? rawTerminal?.physicalLabel ?? id, id, 40);
  const connectorInterface = sanitizeConnectorInterface(rawTerminal?.connectorInterface);
  const visibleSize = positiveNumber(rawTerminal?.visibleSizeMm, 2.4);
  const visibleBoundsMm = rawTerminal?.visibleBoundsMm
    ? bounds(rawTerminal.visibleBoundsMm, visibleSize, visibleSize)
    : {
        x: positionMm[0] - visibleSize / 2,
        y: positionMm[1] - visibleSize / 2,
        width: visibleSize,
        height: visibleSize
      };
  return {
    id,
    label,
    kind,
    positionMm,
    visibleBoundsMm,
    connectorInterface,
    attachmentCapacity: Math.max(1, Math.round(positiveNumber(rawTerminal?.attachmentCapacity, 1))),
    sourceMappingId: safeText(rawTerminal?.sourceMappingId ?? "", "", 80) || null,
    physicalLabel: safeText(rawTerminal?.physicalLabel ?? label, label, 40),
    electricalRole: safeText(rawTerminal?.electricalRole ?? "", "", 40) || null,
    voltageDomainId: safeText(rawTerminal?.voltageDomainId ?? "", "", 40) || null,
    notes: safeText(rawTerminal?.notes ?? "", "", 160)
  };
}

function normalizeTerminals(input) {
  const rawTerminals = Array.isArray(input)
    ? input
    : Object.entries(input ?? {}).map(([id, terminal]) => ({ ...terminal, id }));
  if (!rawTerminals.length) throw new Error("A custom Circuit Lab component needs at least one calibrated terminal.");
  const seenIds = new Set();
  const seenPositions = new Map();
  return rawTerminals.map((terminal, index) => {
    const normalized = normalizeTerminal(terminal, index);
    if (seenIds.has(normalized.id)) throw new Error(`Duplicate custom terminal id: ${normalized.id}.`);
    seenIds.add(normalized.id);
    const positionKey = normalized.positionMm.map((value) => Number(value).toFixed(4)).join(",");
    if (seenPositions.has(positionKey)) {
      throw new Error(`Custom terminals ${seenPositions.get(positionKey)} and ${normalized.id} share the same anchor.`);
    }
    seenPositions.set(positionKey, normalized.id);
    return normalized;
  });
}

function normalizeInternalBuses(rawBuses, terminalIds) {
  const validTerminalIds = new Set(terminalIds);
  return (rawBuses ?? [])
    .map((bus, index) => ({
      id: safeToken(bus?.id ?? `bus_${index + 1}`, `bus_${index + 1}`),
      terminalIds: [...new Set((bus?.terminalIds ?? []).map((terminalId) => safeToken(terminalId, "")).filter((terminalId) => validTerminalIds.has(terminalId)))],
      passive: bus?.passive !== false,
      resistanceOhm: Number.isFinite(Number(bus?.resistanceOhm)) ? Number(bus.resistanceOhm) : null
    }))
    .filter((bus) => bus.terminalIds.length > 1);
}

function parseAttributes(source = "") {
  const attributes = {};
  const attrRegex = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRegex.exec(source))) {
    attributes[match[1]] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

function parseNumberWithUnit(value) {
  const numeric = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function textContent(source, tagName) {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(source);
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : "";
}

function breadboardViewImageBasename(source) {
  const breadboard = /<breadboardView\b[\s\S]*?<\/breadboardView>/i.exec(source)?.[0] ?? "";
  const layersAttrs = parseAttributes(/<layers\b([^>]*)\/?>/i.exec(breadboard)?.[1] ?? "");
  const image = safeText(layersAttrs.image ?? "", "", 160);
  return image ? basename(image) : null;
}

export function parseFritzingPart(fzpText) {
  const source = String(fzpText ?? "");
  if (!/<module\b/i.test(source)) throw new Error("Fritzing import needs a .fzp module file.");
  const moduleAttrs = parseAttributes(source.match(/<module\b([^>]*)>/i)?.[1] ?? "");
  const title = textContent(source, "title") || textContent(source, "label") || moduleAttrs.moduleId || "Imported Fritzing part";
  const breadboardImage = breadboardViewImageBasename(source);
  const connectors = [];
  const connectorRegex = /<connector\b([^>]*)>([\s\S]*?)<\/connector>/gi;
  let connectorMatch;
  while ((connectorMatch = connectorRegex.exec(source))) {
    const attrs = parseAttributes(connectorMatch[1]);
    const body = connectorMatch[2] ?? "";
    const breadboard = /<breadboardView\b[\s\S]*?<\/breadboardView>/i.exec(body)?.[0] ?? body;
    const pAttrs = parseAttributes(/<p\b([^>]*)\/?>/i.exec(breadboard)?.[1] ?? "");
    const id = safeText(attrs.id ?? "", "", 80);
    if (!id) continue;
    connectors.push({
      id,
      name: safeText(attrs.name ?? textContent(body, "name") ?? id, id, 80),
      type: safeText(attrs.type ?? "", "", 40),
      gender: safeText(textContent(body, "gender") || attrs.gender || "", "", 40),
      svgId: safeText(pAttrs.svgId ?? pAttrs.svgid ?? "", "", 80) || null,
      terminalId: safeText(pAttrs.terminalId ?? pAttrs.terminalid ?? "", "", 80) || null
    });
  }
  if (!connectors.length) throw new Error("Fritzing part has no breadboard connectors to import.");
  const buses = [];
  const busRegex = /<bus\b([^>]*)>([\s\S]*?)<\/bus>/gi;
  let busMatch;
  while ((busMatch = busRegex.exec(source))) {
    const attrs = parseAttributes(busMatch[1]);
    const members = [];
    const memberRegex = /<nodeMember\b([^>]*)\/?>/gi;
    let memberMatch;
    while ((memberMatch = memberRegex.exec(busMatch[2] ?? ""))) {
      const memberAttrs = parseAttributes(memberMatch[1]);
      if (memberAttrs.connectorId) members.push(memberAttrs.connectorId);
    }
    if (members.length > 1) buses.push({ id: safeText(attrs.id ?? `bus_${buses.length + 1}`, `bus_${buses.length + 1}`, 80), connectorIds: members });
  }
  return { moduleId: safeText(moduleAttrs.moduleId ?? "", "", 80) || null, title: safeText(title, "Imported Fritzing part"), breadboardImage, connectors, buses };
}

export function parseSvgViewBox(svgText) {
  const source = String(svgText ?? "");
  const svgAttrs = parseAttributes(source.match(/<svg\b([^>]*)>/i)?.[1] ?? "");
  const viewBox = String(svgAttrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
  }
  const width = parseNumberWithUnit(svgAttrs.width);
  const height = parseNumberWithUnit(svgAttrs.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height };
  }
  throw new Error("SVG needs a viewBox or explicit width and height.");
}

function identityMatrix() {
  return [1, 0, 0, 1, 0, 0];
}

function multiplyMatrix(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function applyMatrix(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]
  ];
}

function transformMatrix(transformText) {
  const transform = String(transformText ?? "").trim();
  if (!transform) return identityMatrix();
  let matrix = identityMatrix();
  const transformRegex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = transformRegex.exec(transform))) {
    const kind = match[1].toLowerCase();
    const values = (match[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    let next = identityMatrix();
    if (kind === "matrix" && values.length >= 6) {
      next = values.slice(0, 6);
    } else if (kind === "translate") {
      next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    } else if (kind === "scale") {
      const sx = values[0] ?? 1;
      const sy = values.length > 1 ? values[1] : sx;
      next = [sx, 0, 0, sy, 0, 0];
    } else if (kind === "rotate") {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotate = [cos, sin, -sin, cos, 0, 0];
      if (values.length >= 3) {
        next = multiplyMatrix(
          multiplyMatrix([1, 0, 0, 1, values[1], values[2]], rotate),
          [1, 0, 0, 1, -values[1], -values[2]]
        );
      } else {
        next = rotate;
      }
    } else if (kind === "skewx") {
      next = [1, 0, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    } else if (kind === "skewy") {
      next = [1, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    matrix = multiplyMatrix(matrix, next);
  }
  return matrix;
}

function svgTagEnd(source, startIndex) {
  const end = source.indexOf(">", startIndex);
  return end >= 0 ? end + 1 : startIndex;
}

function matchingClosingTagIndex(source, tagName, fromIndex) {
  const tagPattern = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = fromIndex;
  let depth = 1;
  let match;
  while ((match = tagPattern.exec(source))) {
    const tagText = match[0];
    if (/^<\//.test(tagText)) {
      depth -= 1;
      if (depth === 0) return match.index;
    } else if (!/\/\s*>$/.test(tagText)) {
      depth += 1;
    }
  }
  return -1;
}

function localElementCenter(tag, attrs) {
  if (tag === "circle" || tag === "ellipse") {
    const cx = parseNumberWithUnit(attrs.cx);
    const cy = parseNumberWithUnit(attrs.cy);
    return Number.isFinite(cx) && Number.isFinite(cy) ? [cx, cy] : null;
  }
  if (tag === "rect" || tag === "image" || tag === "use") {
    const x = parseNumberWithUnit(attrs.x) ?? 0;
    const y = parseNumberWithUnit(attrs.y) ?? 0;
    const width = parseNumberWithUnit(attrs.width);
    const height = parseNumberWithUnit(attrs.height);
    return Number.isFinite(width) && Number.isFinite(height) ? [x + width / 2, y + height / 2] : null;
  }
  if (tag === "line") {
    const x1 = parseNumberWithUnit(attrs.x1);
    const y1 = parseNumberWithUnit(attrs.y1);
    const x2 = parseNumberWithUnit(attrs.x2);
    const y2 = parseNumberWithUnit(attrs.y2);
    return [x1, y1, x2, y2].every(Number.isFinite) ? [(x1 + x2) / 2, (y1 + y2) / 2] : null;
  }
  const points = String(attrs.points ?? attrs.d ?? "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  if (points.length >= 2) {
    const xs = points.filter((_, index) => index % 2 === 0);
    const ys = points.filter((_, index) => index % 2 === 1);
    return [xs.reduce((sum, value) => sum + value, 0) / xs.length, ys.reduce((sum, value) => sum + value, 0) / ys.length];
  }
  return null;
}

function localHrefTarget(attrs) {
  const href = String(attrs.href ?? attrs["xlink:href"] ?? "").trim();
  return href.startsWith("#") ? href.slice(1) : null;
}

function referencedUseCenter(fullSource, attrs, matrix, seen = new Set()) {
  const targetId = localHrefTarget(attrs);
  if (!targetId || seen.has(targetId)) return null;
  const x = parseNumberWithUnit(attrs.x) ?? 0;
  const y = parseNumberWithUnit(attrs.y) ?? 0;
  return svgElementCenterFromSource(fullSource, targetId, multiplyMatrix(matrix, [1, 0, 0, 1, x, y]), new Set([...seen, targetId]));
}

function collectSvgCenters(source, baseMatrix = identityMatrix(), fullSource = source, seen = new Set()) {
  const centers = [];
  const stack = [{ tag: "root", matrix: baseMatrix }];
  const tagRegex = /<\s*(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let match;
  while ((match = tagRegex.exec(source))) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (closing) {
      while (stack.length > 1) {
        const current = stack.pop();
        if (current.tag === tag) break;
      }
      continue;
    }
    const attrs = parseAttributes(match[3]);
    const parent = stack.at(-1)?.matrix ?? baseMatrix;
    const matrix = multiplyMatrix(parent, transformMatrix(attrs.transform));
    const center = localElementCenter(tag, attrs);
    if (center) {
      centers.push(applyMatrix(matrix, center));
    } else if (tag === "use") {
      const referenced = referencedUseCenter(fullSource, attrs, matrix, seen);
      if (referenced) centers.push(referenced);
    }
    if (!/\/\s*>$/.test(match[0])) stack.push({ tag, matrix });
  }
  return centers;
}

function findSvgElement(source, elementId) {
  const target = String(elementId ?? "");
  if (!target) return null;
  const stack = [{ tag: "root", matrix: identityMatrix() }];
  const tagRegex = /<\s*(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let match;
  while ((match = tagRegex.exec(source))) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (closing) {
      while (stack.length > 1) {
        const current = stack.pop();
        if (current.tag === tag) break;
      }
      continue;
    }
    const attrs = parseAttributes(match[3]);
    const parent = stack.at(-1)?.matrix ?? identityMatrix();
    const matrix = multiplyMatrix(parent, transformMatrix(attrs.transform));
    if (attrs.id === target) {
      const startEnd = svgTagEnd(source, match.index);
      const endIndex = /\/\s*>$/.test(match[0]) ? startEnd : matchingClosingTagIndex(source, tag, startEnd);
      const inner = endIndex > startEnd ? source.slice(startEnd, endIndex) : "";
      return { tag, attrs, matrix, inner };
    }
    if (!/\/\s*>$/.test(match[0])) stack.push({ tag, matrix });
  }
  return null;
}

function svgElementCenterFromSource(source, elementId, baseMatrix = identityMatrix(), seen = new Set()) {
  const element = findSvgElement(source, elementId);
  if (!element) return null;
  const matrix = multiplyMatrix(baseMatrix, element.matrix);
  const localCenter = localElementCenter(element.tag, element.attrs);
  if (localCenter) return applyMatrix(matrix, localCenter);
  if (element.tag === "use") return referencedUseCenter(source, element.attrs, matrix, seen);
  const childCenters = collectSvgCenters(element.inner, matrix, source, seen);
  if (childCenters.length) {
    const xs = childCenters.map((point) => point[0]);
    const ys = childCenters.map((point) => point[1]);
    return [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2
    ];
  }
  return null;
}

export function svgElementCenter(svgText, elementId) {
  return svgElementCenterFromSource(String(svgText ?? ""), elementId);
}

const ALLOWED_SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "filter",
  "fegaussianblur",
  "feoffset",
  "feblend",
  "fecolormatrix",
  "fecomposite",
  "feflood",
  "femerge",
  "femergenode",
  "fedropshadow",
  "image"
]);

function stripSvgMetadata(source) {
  return source
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, "")
    .replace(/<sodipodi:namedview\b[\s\S]*?(?:\/>|<\/sodipodi:namedview>)/gi, "");
}

function validateSvgElements(source) {
  const tagRegex = /<\s*\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match;
  while ((match = tagRegex.exec(source))) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_SVG_ELEMENTS.has(tag)) {
      throw new Error(`Custom component SVG contains unsupported <${tag}> content.`);
    }
  }
}

function assertSafeSvgReferences(source, knownIds) {
  const hrefRegex = /\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi;
  let hrefMatch;
  while ((hrefMatch = hrefRegex.exec(source))) {
    const value = hrefMatch[2].trim();
    if (!value.startsWith("#")) {
      throw new Error("Custom component SVG references external or embedded resources.");
    }
    if (!knownIds.has(value.slice(1))) {
      throw new Error(`Custom component SVG references unresolved id ${value}.`);
    }
  }
  const urlRegex = /url\(\s*(["']?)#([^"')\s]+)\1\s*\)/gi;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(source))) {
    if (!knownIds.has(urlMatch[2])) {
      throw new Error(`Custom component SVG references unresolved id #${urlMatch[2]}.`);
    }
  }
}

export function sanitizeLocalSvg(svgText, namespace = "custom-svg") {
  const source = stripSvgMetadata(String(svgText ?? "").trim());
  if (!source || !/<svg\b/i.test(source)) throw new Error("Custom component visual must be an SVG.");
  const blockedPatterns = [
    /<\s*script\b/i,
    /<\s*foreignObject\b/i,
    /<\s*(iframe|object|embed|canvas|audio|video)\b/i,
    /\son[a-z]+\s*=/i,
    /(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|file:|\/\/|data:)/i,
    /url\(\s*(?:https?:|file:|\/\/|data:)/i,
    /@import/i,
    /expression\s*\(/i
  ];
  for (const pattern of blockedPatterns) {
    if (pattern.test(source)) throw new Error("Custom component SVG contains unsupported or unsafe content.");
  }
  validateSvgElements(source);
  const prefix = svgToken(namespace, "custom_svg");
  const idMatches = [...source.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/g)];
  const duplicateIds = new Set();
  const originalIdCounts = new Map();
  for (const match of idMatches) {
    const original = match[2];
    const count = originalIdCounts.get(original) ?? 0;
    originalIdCounts.set(original, count + 1);
    if (count) duplicateIds.add(original);
  }
  if (duplicateIds.size) {
    throw new Error(`Custom component SVG contains duplicate ids: ${[...duplicateIds].join(", ")}.`);
  }
  const knownOriginalIds = new Set(idMatches.map((match) => match[2]));
  assertSafeSvgReferences(source, knownOriginalIds);
  const seen = new Map();
  const idMap = new Map();
  for (const match of idMatches) {
    const original = match[2];
    const base = `${prefix}__${svgToken(original, "id")}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    idMap.set(original, count ? `${base}_${count + 1}` : base);
  }
  let sanitized = source;
  for (const [original, namespaced] of idMap.entries()) {
    const escaped = escapeRegExp(original);
    sanitized = sanitized
      .replace(new RegExp(`\\bid\\s*=\\s*(["'])${escaped}\\1`, "g"), `id="${namespaced}"`)
      .replace(new RegExp(`url\\(\\s*(["']?)#${escaped}\\1\\s*\\)`, "g"), `url(#${namespaced})`)
      .replace(new RegExp(`(href|xlink:href)\\s*=\\s*(["'])#${escaped}\\2`, "g"), `$1="#${namespaced}"`);
  }
  sanitized = sanitized
    .replace(/\s+xmlns:xlink=(["'])http:\/\/www\.w3\.org\/1999\/xlink\1/gi, " xmlns:xlink=\"http://www.w3.org/1999/xlink\"");
  assertSafeSvgReferences(sanitized, new Set(idMap.values()));
  return sanitized;
}

function terminalKindFromConnector(connector) {
  const text = `${connector.name} ${connector.id}`.toLowerCase();
  if (/\b(gnd|ground|0v|vss|-)\b/.test(text)) return "ground";
  if (/\b(vcc|vdd|vin|v\+|power|\+|5v|3v3|3\.3v)\b/.test(text)) return "power";
  return "signal";
}

function connectorInterfaceFromConnector(connector) {
  const gender = String(connector.gender ?? connector.type ?? "").toLowerCase();
  if (gender.includes("female")) return "female-controller-header";
  if (gender.includes("male")) return "male-header-pin";
  return "jumper-wire-end";
}

export function buildFritzingCustomComponentDefinition(input = {}) {
  if (input.licenseAccepted !== true) throw new Error("Fritzing import requires explicit local-use license acceptance.");
  const part = parseFritzingPart(input.fzpText);
  const viewBox = parseSvgViewBox(input.svgText);
  const svgFileBasename = basename(input.svgFileName);
  if (part.breadboardImage && svgFileBasename && part.breadboardImage !== svgFileBasename) {
    throw new Error(`Selected SVG ${svgFileBasename} does not match the Fritzing breadboard SVG ${part.breadboardImage}.`);
  }
  const widthMm = requiredPositiveNumber(input.physicalWidthMm, "Fritzing custom component physical width");
  const heightMm = requiredPositiveNumber(input.physicalHeightMm, "Fritzing custom component physical height");
  const terminalIdByConnectorId = new Map();
  const terminals = part.connectors.map((connector, index) => {
    const sourceAnchor = connector.terminalId ?? connector.svgId;
    if (!sourceAnchor) throw new Error(`Connector ${connector.id} has no breadboard svgId or terminalId.`);
    const center = svgElementCenter(input.svgText, sourceAnchor);
    if (!center) throw new Error(`Connector ${connector.id} references missing SVG element ${sourceAnchor}.`);
    const terminalId = safeToken(input.terminalMap?.[connector.id] ?? connector.id ?? `terminal_${index + 1}`, `terminal_${index + 1}`);
    terminalIdByConnectorId.set(connector.id, terminalId);
    return {
      id: terminalId,
      label: connector.name || terminalId,
      kind: terminalKindFromConnector(connector),
      positionMm: [
        ((center[0] - (viewBox.x + viewBox.width / 2)) / viewBox.width) * widthMm,
        ((center[1] - (viewBox.y + viewBox.height / 2)) / viewBox.height) * heightMm
      ],
      connectorInterface: connectorInterfaceFromConnector(connector),
      attachmentCapacity: 1,
      sourceMappingId: connector.id,
      physicalLabel: connector.name || terminalId
    };
  });
  const internalBuses = part.buses.map((bus) => ({
    id: bus.id,
    terminalIds: bus.connectorIds.map((connectorId) => terminalIdByConnectorId.get(connectorId)).filter(Boolean),
    passive: true
  }));
  const id = customComponentTypeId(input.id ?? part.moduleId ?? part.title);
  return normalizeCircuitCustomComponentDefinition({
    kind: CIRCUIT_CUSTOM_COMPONENT_KIND,
    version: CIRCUIT_CUSTOM_COMPONENT_VERSION,
    id,
    name: input.name ?? part.title,
    category: "Custom",
    units: "mm",
    physical: {
      physicalSizeMm: [widthMm, heightMm],
      bodyBoundsMm: { x: -widthMm / 2, y: -heightMm / 2, width: widthMm, height: heightMm },
      visualBoundsMm: { x: -widthMm / 2, y: -heightMm / 2, width: widthMm, height: heightMm },
      clampBoundsMm: { x: -widthMm / 2, y: -heightMm / 2, width: widthMm, height: heightMm }
    },
    terminals,
    internalBuses,
    visual: {
      assetKind: "local-sanitized-svg",
      sanitizedSvg: sanitizeLocalSvg(input.svgText, id),
      viewBox
    },
    provenance: {
      sourceProject: "Fritzing local import",
      sourceAssetName: safeText(part.title, "Imported Fritzing part"),
      sourceFileBasenames: [safeText(basename(input.fzpFileName), "", 120), safeText(svgFileBasename, "", 120)].filter(Boolean),
      connectorMappings: terminals.map((terminal) => ({ terminalId: terminal.id, sourceMappingId: terminal.sourceMappingId })),
      localOnly: true
    },
    licenseAcceptance: {
      accepted: true,
      licenseSpdx: "CC-BY-SA-3.0",
      shareAlike: true,
      localOnly: true,
      acceptedAt: input.acceptedAt ?? input.now ?? new Date().toISOString()
    },
    createdAt: input.now,
    updatedAt: input.now
  });
}

export function normalizeCircuitCustomComponentDefinition(input = {}, options = {}) {
  const now = options.now ?? input.updatedAt ?? new Date().toISOString();
  const id = customComponentTypeId(input.id ?? input.name ?? "component");
  const physicalSizeMm = vector2(input.physical?.physicalSizeMm ?? input.physicalSizeMm ?? input.dimensions, [40, 24])
    .map((value) => positiveNumber(value, 1));
  const [width, height] = physicalSizeMm;
  const terminals = normalizeTerminals(input.terminals).map((terminal) => ({
    ...terminal,
    electricalRole: null,
    voltageDomainId: null
  }));
  const terminalIds = terminals.map((terminal) => terminal.id);
  const sanitizedSvg = input.visual?.sanitizedSvg
    ? sanitizeLocalSvg(input.visual.sanitizedSvg, id)
    : null;
  const viewBox = input.visual?.viewBox ?? (sanitizedSvg ? parseSvgViewBox(sanitizedSvg) : { x: 0, y: 0, width, height });
  const licenseAcceptance = {
    accepted: input.licenseAcceptance?.accepted === true,
    licenseSpdx: safeText(input.licenseAcceptance?.licenseSpdx ?? "CC-BY-SA-3.0", "CC-BY-SA-3.0", 32),
    shareAlike: input.licenseAcceptance?.shareAlike !== false,
    localOnly: true,
    acceptedAt: safeText(input.licenseAcceptance?.acceptedAt ?? now, now, 40)
  };
  if (!licenseAcceptance.accepted) throw new Error("Custom Fritzing-derived components require local-use license acceptance.");
  return {
    kind: CIRCUIT_CUSTOM_COMPONENT_KIND,
    version: CIRCUIT_CUSTOM_COMPONENT_VERSION,
    id,
    name: safeText(input.name, "Custom component", 64),
    category: safeText(input.category, "Custom", 32),
    units: "mm",
    physical: {
      physicalSizeMm,
      bodyBoundsMm: bounds(input.physical?.bodyBoundsMm, width, height),
      visualBoundsMm: bounds(input.physical?.visualBoundsMm, width, height),
      clampBoundsMm: bounds(input.physical?.clampBoundsMm, width, height)
    },
    terminals,
    internalBuses: normalizeInternalBuses(input.internalBuses, terminalIds),
    engineering: {
      specificationBasis: "local-custom",
      connectors: [{
        id: "custom-connectors",
        family: "local-fritzing-import",
        pinPitchMm: null,
        keyed: false,
        terminalIds
      }],
      robotics: { role: "passive", interface: "passive" }
    },
    sim: { role: "custom" },
    visual: {
      assetKind: sanitizedSvg ? "local-sanitized-svg" : "procedural-fallback",
      sanitizedSvg,
      viewBox,
      localOnly: true
    },
    provenance: {
      sourceProject: safeText(input.provenance?.sourceProject ?? "Fritzing local import", "Fritzing local import", 80),
      sourceAssetName: safeText(input.provenance?.sourceAssetName ?? input.name, input.name ?? "Custom component", 120),
      sourceFileBasenames: (input.provenance?.sourceFileBasenames ?? []).map((item) => safeText(basename(item), "", 120)).filter(Boolean),
      connectorMappings: cloneJson(input.provenance?.connectorMappings ?? []),
      localOnly: true
    },
    licenseAcceptance,
    createdAt: safeText(input.createdAt ?? now, now, 40),
    updatedAt: now
  };
}
