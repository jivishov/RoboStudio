function endpointOrder(left, right) {
  return String(left.endpointKey).localeCompare(String(right.endpointKey), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function isVisible(anchor, rect) {
  const [x, y] = anchor?.screenPoint ?? [];
  return Number.isFinite(x)
    && Number.isFinite(y)
    && x >= rect.left
    && x <= rect.right
    && y >= rect.top
    && y <= rect.bottom;
}

function directionDeltas(direction, dx, dy) {
  if (direction === "ArrowLeft") return { primary: -dx, cross: Math.abs(dy) };
  if (direction === "ArrowRight") return { primary: dx, cross: Math.abs(dy) };
  if (direction === "ArrowUp") return { primary: -dy, cross: Math.abs(dx) };
  if (direction === "ArrowDown") return { primary: dy, cross: Math.abs(dx) };
  return null;
}

function byDistanceCrossThenIdentity(left, right) {
  return left.directionalScore - right.directionalScore
    || left.distance - right.distance
    || left.cross - right.cross
    || left.primary - right.primary
    || endpointOrder(left.anchor, right.anchor);
}

export function nearestVisibleTerminalInDirection(anchors, currentEndpointKey, direction, visibleRect) {
  const visible = (anchors ?? []).filter((anchor) => isVisible(anchor, visibleRect));
  if (!visible.length) return null;
  const current = visible.find((anchor) => anchor.endpointKey === currentEndpointKey)
    ?? (anchors ?? []).find((anchor) => anchor.endpointKey === currentEndpointKey);
  if (!current?.screenPoint) {
    const center = [(visibleRect.left + visibleRect.right) / 2, (visibleRect.top + visibleRect.bottom) / 2];
    return [...visible].sort((left, right) => (
      Math.hypot(left.screenPoint[0] - center[0], left.screenPoint[1] - center[1])
      - Math.hypot(right.screenPoint[0] - center[0], right.screenPoint[1] - center[1])
      || endpointOrder(left, right)
    ))[0];
  }
  const candidates = [];
  for (const anchor of visible) {
    if (anchor.endpointKey === current.endpointKey) continue;
    const dx = anchor.screenPoint[0] - current.screenPoint[0];
    const dy = anchor.screenPoint[1] - current.screenPoint[1];
    const deltas = directionDeltas(direction, dx, dy);
    if (!deltas || deltas.primary <= 0.5) continue;
    if (deltas.cross > 0.5 && deltas.primary < deltas.cross * 0.25) continue;
    candidates.push({
      anchor,
      primary: deltas.primary,
      cross: deltas.cross,
      directionalScore: deltas.primary + deltas.cross * 2,
      distance: Math.hypot(dx, dy)
    });
  }
  candidates.sort(byDistanceCrossThenIdentity);
  return candidates[0]?.anchor ?? current;
}
