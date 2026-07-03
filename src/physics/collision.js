import * as THREE from "three";

function proxyDimensions(proxy) {
  const [a = 10, b = a, c = a] = proxy.dimensions ?? [10, 10, 10];
  return [a, b, c].map((value) => Math.max(0.001, Number(value) || 0.001));
}

export function proxyWorldMatrix(proxy, linkMatrix = new THREE.Matrix4()) {
  const [x = 0, y = 0, z = 0] = proxy.origin ?? [0, 0, 0];
  return linkMatrix.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
}

export function collisionPairKey(a, b) {
  return [a, b].sort().join("|");
}

export function proxyAabb(proxy, linkMatrix = new THREE.Matrix4()) {
  const [a, b, c] = proxyDimensions(proxy);
  const matrix = proxyWorldMatrix(proxy, linkMatrix);

  if (proxy.type === "sphere") {
    const center = new THREE.Vector3().setFromMatrixPosition(matrix);
    return new THREE.Box3(
      new THREE.Vector3(center.x - a, center.y - a, center.z - a),
      new THREE.Vector3(center.x + a, center.y + a, center.z + a)
    );
  }

  if (proxy.type === "capsule" || proxy.type === "cylinder") {
    const radius = a;
    const halfLength = b / 2;
    const box = new THREE.Box3().setFromPoints([
      new THREE.Vector3(0, -halfLength, 0).applyMatrix4(matrix),
      new THREE.Vector3(0, halfLength, 0).applyMatrix4(matrix)
    ]);
    return box.expandByScalar(radius);
  }

  return new THREE.Box3(
    new THREE.Vector3(-a / 2, -b / 2, -c / 2),
    new THREE.Vector3(a / 2, b / 2, c / 2)
  ).applyMatrix4(matrix);
}

export function checkCollisionProxies(design, transforms) {
  const collisions = [];
  const allowed = new Set(design.allowedCollisions ?? []);
  const proxies = [];

  for (const link of design.links) {
    const linkMatrix = transforms.get(link.id) ?? new THREE.Matrix4();
    for (const proxy of link.collisionProxies ?? []) {
      if (proxy.enabled === false) continue;
      proxies.push({ link, proxy, box: proxyAabb(proxy, linkMatrix) });
    }
  }

  for (let left = 0; left < proxies.length; left += 1) {
    for (let right = left + 1; right < proxies.length; right += 1) {
      const a = proxies[left];
      const b = proxies[right];
      if (a.link.id === b.link.id) continue;
      if (allowed.has(collisionPairKey(a.link.id, b.link.id))) continue;
      if (!a.box.intersectsBox(b.box)) continue;
      const overlap = new THREE.Box3().copy(a.box).intersect(b.box).getSize(new THREE.Vector3());
      collisions.push({
        linkA: a.link.id,
        linkB: b.link.id,
        proxyA: a.proxy.id,
        proxyB: b.proxy.id,
        overlapMm: Number(Math.max(overlap.x, overlap.y, overlap.z).toFixed(2))
      });
    }
  }

  return collisions;
}
