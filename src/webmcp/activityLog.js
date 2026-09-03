const DEFAULT_LIMIT = 120;
const STABLE_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

function safeId(value) {
  const text = String(value ?? "");
  return STABLE_ID.test(text) ? text : null;
}

function safeIds(values) {
  return [...new Set((values ?? []).map(safeId).filter(Boolean))].slice(0, 24);
}

function safeCode(value) {
  const text = String(value ?? "");
  return /^[a-z0-9_.:-]{1,80}$/i.test(text) ? text : null;
}

export function createActivityLog(options = {}) {
  const limit = Math.max(20, Math.min(300, Number(options.limit) || DEFAULT_LIMIT));
  const events = [];
  let sequence = 0;

  function record(input = {}) {
    const event = {
      sequence: ++sequence,
      activityId: safeId(input.activityId) ?? `activity_${sequence}`,
      actor: ["webmcp", "human", "human-confirmation", "system"].includes(input.actor) ? input.actor : "system",
      toolName: safeCode(input.toolName),
      status: safeCode(input.status) ?? "complete",
      code: safeCode(input.code),
      revisionBefore: safeCode(input.revisionBefore),
      revisionAfter: safeCode(input.revisionAfter),
      affectedComponentIds: safeIds(input.affectedComponentIds),
      affectedConnectionIds: safeIds(input.affectedConnectionIds),
      endpointPairKey: typeof input.endpointPairKey === "string" ? input.endpointPairKey.slice(0, 260) : null,
      durationMs: Number.isFinite(Number(input.durationMs)) ? Math.max(0, Math.round(Number(input.durationMs))) : null,
      at: input.at ?? new Date().toISOString()
    };
    events.push(event);
    while (events.length > limit) events.shift();
    return { ...event };
  }

  return {
    record,
    recent(count = 12) {
      return events.slice(-Math.max(1, Math.min(50, Number(count) || 12))).map((event) => ({ ...event }));
    },
    all() {
      return events.map((event) => ({ ...event }));
    },
    clear() {
      events.length = 0;
      sequence = 0;
    }
  };
}

export function canonicalEndpointPairKey(endpointA, endpointB) {
  return [endpointA, endpointB]
    .map((endpoint) => `${endpoint?.componentId ?? ""}:${endpoint?.terminalId ?? ""}`)
    .sort()
    .join("|");
}

export function findActivityEvents(events = [], activityId) {
  const id = safeId(activityId);
  if (!id) return [];
  return (events ?? []).filter((event) => event?.activityId === id).map((event) => ({ ...event }));
}
