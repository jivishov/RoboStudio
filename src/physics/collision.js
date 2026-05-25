import * as THREE from "three";
import { transformPoint } from "./kinematics.js";

function proxyHalfExtents(proxy) {
  const [a = 10, b = a, c = a] = proxy.dimensions ?? [10, 10, 10];
  if (proxy.type === "sphere") return [a, a, a];
  if (proxy.type === "capsule") return [a, Math.max(a, b / 2 + a), a];
  if (proxy.type === "cylinder") return [a, b / 2, a];
  return [a / 2, b / 2, c / 2];
}

export function collisionPairKey(a, b) {
  return [a, b].sort().join("|");
}

export function proxyAabb(proxy, linkMatrix = new THREE.Matrix4()) {
  const center = transformPoint(linkMatrix, proxy.origin ?? [0, 0, 0]);
  const [hx, hy, hz] = proxyHalfExtents(proxy).map((value) => Math.max(0.001, Number(value) || 0.001));
  return new THREE.Box3(
    new THREE.Vector3(center.x - hx, center.y - hy, center.z - hz),
    new THREE.Vector3(center.x + hx, center.y + hy, center.z + hz)
  );
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
