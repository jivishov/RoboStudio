import path from "node:path";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const CRITICAL_PNG_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);

export function hasForbiddenEmbeddedData(value) {
  return /(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|sha256|file_id|\bfile-[a-z0-9_-]{6,}|sk-[a-z0-9_-]+|https?:\/\/|file:\/?\/?)/i.test(String(value ?? ""));
}

export function assertRepoRelativePath(repoRoot, value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a repo-relative path.`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value) || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} must be a normalized repo-relative path.`);
  }
  const resolved = path.resolve(repoRoot, value);
  const rootWithSep = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  if (resolved !== repoRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`${label} must stay inside the repository.`);
  }
  return resolved;
}

export function readPngInfo(source, label = "PNG") {
  if (!Buffer.isBuffer(source) || source.length < 33 || !source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a valid PNG file.`);
  }

  const chunks = [];
  let offset = 8;
  let ihdr = null;
  let sawIend = false;
  let iendEndOffset = 0;

  while (offset < source.length) {
    if (offset + 8 > source.length) throw new Error(`${label} has a truncated PNG chunk header.`);
    const length = source.readUInt32BE(offset);
    const type = source.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkEnd = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new Error(`${label} has an invalid PNG chunk type.`);
    if (chunkEnd > source.length) throw new Error(`${label} PNG chunk ${type} is truncated.`);

    const chunk = { type, length, buffer: source.subarray(offset, chunkEnd) };
    chunks.push(chunk);

    if (type === "IHDR") {
      ihdr = {
        width: source.readUInt32BE(offset + 8),
        height: source.readUInt32BE(offset + 12),
        bitDepth: source.readUInt8(offset + 16),
        colorType: source.readUInt8(offset + 17)
      };
    }
    offset = chunkEnd;
    if (type === "IEND") {
      sawIend = true;
      iendEndOffset = chunkEnd;
      break;
    }
  }

  if (!ihdr) throw new Error(`${label} is missing an IHDR chunk.`);
  if (!sawIend) throw new Error(`${label} is missing an IEND chunk.`);
  if (iendEndOffset !== source.length) throw new Error(`${label} has trailing data after IEND.`);

  return {
    ...ihdr,
    chunks,
    hasAlpha: ihdr.colorType === 4 || ihdr.colorType === 6 || chunks.some((chunk) => chunk.type === "tRNS"),
    criticalOnly: chunks.every((chunk) => CRITICAL_PNG_CHUNKS.has(chunk.type))
  };
}

export function stripPngMetadata(source, label = "PNG") {
  const info = readPngInfo(source, label);
  return Buffer.concat([
    PNG_SIGNATURE,
    ...info.chunks
      .filter((chunk) => CRITICAL_PNG_CHUNKS.has(chunk.type))
      .map((chunk) => chunk.buffer)
  ]);
}
