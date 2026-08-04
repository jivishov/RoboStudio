/**
 * Binary STL export, and the parser that proves it round-trips.
 *
 * Written directly rather than through `@jscad/stl-serializer`, which was
 * declared in `package.json` and imported nowhere. The mesh already arrives from
 * `solidToMeshData` as a flat `Float32Array` of nine floats per triangle, which is
 * exactly the layout the file wants, so the writer is a `DataView` and a loop.
 * Going through a serializer would mean converting back to polygons to have them
 * re-triangulated, and would give up control of the 80-byte header.
 *
 * The format, little-endian throughout:
 *
 * - 80 bytes of free-form header. It must not begin with `solid`, or a reader
 *   sniffing the first five bytes will try to parse the file as ASCII.
 * - `uint32` triangle count.
 * - 50 bytes per facet: three `float32` normal, nine `float32` vertices, one
 *   `uint16` attribute byte count, which is always zero.
 *
 * So the byte length is exactly `84 + 50 * triangleCount`, with no padding and no
 * trailing newline. That is asserted rather than assumed.
 *
 * The module is DOM-free: it runs in the CAD worker and under `node:test`.
 */

export const STL_HEADER_BYTES = 80;
export const STL_TRIANGLE_BYTES = 50;
export const STL_COUNT_OFFSET = 80;
export const STL_TRIANGLE_OFFSET = 84;

export function binaryStlByteLength(triangleCount) {
  return STL_TRIANGLE_OFFSET + STL_TRIANGLE_BYTES * Math.max(0, Math.floor(triangleCount));
}

/**
 * Write the 80-byte header.
 *
 * ASCII only and truncated to fit, because the field is fixed width. The leading
 * `RoboStudio` also guarantees the file cannot be mistaken for ASCII STL.
 */
function writeHeader(bytes, text) {
  const banner = `RoboStudio ${text ?? ""}`.slice(0, STL_HEADER_BYTES);
  for (let index = 0; index < banner.length; index += 1) {
    const code = banner.charCodeAt(index);
    bytes[index] = code > 0 && code < 128 ? code : 0x20;
  }
}

/**
 * Binary STL for a mesh in `solidToMeshData` shape.
 *
 * `normals` carries one normal per vertex, all three identical per triangle
 * because `solidToMeshData` writes a face normal, so the first of each three is
 * the facet normal the format wants.
 */
export function serializeMeshToBinaryStl(mesh, name = "") {
  const vertices = mesh?.vertices ?? [];
  const normals = mesh?.normals ?? [];
  const triangleCount = Number.isFinite(Number(mesh?.triangleCount))
    ? Math.max(0, Math.floor(Number(mesh.triangleCount)))
    : Math.floor(vertices.length / 9);

  const bytes = new Uint8Array(binaryStlByteLength(triangleCount));
  const view = new DataView(bytes.buffer);
  writeHeader(bytes, name);
  view.setUint32(STL_COUNT_OFFSET, triangleCount, true);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const source = triangle * 9;
    let offset = STL_TRIANGLE_OFFSET + triangle * STL_TRIANGLE_BYTES;

    for (let axis = 0; axis < 3; axis += 1) {
      view.setFloat32(offset, Number(normals[source + axis]) || 0, true);
      offset += 4;
    }
    for (let component = 0; component < 9; component += 1) {
      view.setFloat32(offset, Number(vertices[source + component]) || 0, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
  }

  return bytes;
}

/**
 * Parse a binary STL back into triangles, normals and bounds.
 *
 * This exists so the writer can be verified by reading the bytes back rather than
 * by snapshotting them, and it is the reader half the page will need if STL
 * import ever lands. It refuses a file whose declared count disagrees with its
 * length instead of reading past the end.
 */
export function parseBinaryStl(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source ?? []);
  if (bytes.byteLength < STL_TRIANGLE_OFFSET) {
    throw new Error(`Binary STL is too short: ${bytes.byteLength} bytes.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(STL_COUNT_OFFSET, true);
  const expected = binaryStlByteLength(triangleCount);
  if (bytes.byteLength !== expected) {
    throw new Error(`Binary STL declares ${triangleCount} triangles, which needs ${expected} bytes, but the file is ${bytes.byteLength}.`);
  }

  let header = "";
  for (let index = 0; index < STL_HEADER_BYTES; index += 1) {
    if (bytes[index] === 0) break;
    header += String.fromCharCode(bytes[index]);
  }

  const triangles = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    let offset = STL_TRIANGLE_OFFSET + triangle * STL_TRIANGLE_BYTES;
    const normal = [0, 1, 2].map(() => {
      const value = view.getFloat32(offset, true);
      offset += 4;
      return value;
    });
    const points = [0, 1, 2].map(() =>
      [0, 1, 2].map(() => {
        const value = view.getFloat32(offset, true);
        offset += 4;
        return value;
      })
    );
    for (const point of points) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    triangles.push({ normal, points, attributeByteCount: view.getUint16(offset, true) });
  }

  const finite = min.every(Number.isFinite) && max.every(Number.isFinite);
  return {
    header: header.trim(),
    triangleCount,
    triangles,
    bounds: finite
      ? { min, max, size: max.map((value, index) => value - min[index]) }
      : { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] }
  };
}
