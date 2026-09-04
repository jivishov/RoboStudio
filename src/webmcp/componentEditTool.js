import { catalog } from "../circuits/catalog.js";
import { circuitDesignRevision, isCircuitDesignRevision } from "../circuits/designRevision.js";
import { normalizeProject } from "../circuits/model.js";
import { createActivityLog } from "./activityLog.js";

export const COMPONENT_EDIT_TOOL_NAME = "edit_circuit_component";
export const ORDINARY_WEBMCP_TOOL_COUNT = 8;

const ID_PATTERN = "^[A-Za-z0-9_.:-]{1,120}$";
const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const REVISION_PATTERN = "^clp1-[0-9a-f]{16}$";
const OPERATIONS = Object.freeze(["add", "remove", "move", "rotate", "resize"]);
const MAX_OUTPUT = 1500;

const schema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

const positionSchema = {
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: { type: "number", minimum: 0, maximum: 2000 }
};

function sanitize(value, max = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

function result(ok, code, revision, summary, data = {}) {
  const value = { ok, code, revision, summary: sanitize(summary, 220), data };
  if (JSON.stringify(value).length <= MAX_OUTPUT) return value;
  return {
    ok,
    code,
    revision,
    summary: sanitize(summary, 100),
    data: {
      componentId: data.componentId ?? null,
      operation: data.operation ?? null,
      outputTruncated: true
    }
  };
}

function invalidKeys(input, allowed, required = []) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Input must be an object.";
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) return `Unexpected property: ${extra}.`;
  const missing = required.find((key) => !(key in input));
  return missing ? `Missing required property: ${missing}.` : null;
}

function finitePosition(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((item) => Number.isFinite(Number(item)) && Number(item) >= 0 && Number(item) <= 2000);
}

function validateInput(input) {
  const allowed = ["expectedRevision", "operation", "componentId", "componentTypeId", "name", "position", "rotationDegrees", "scale"];
  const bad = invalidKeys(input, allowed, ["expectedRevision", "operation"]);
  if (bad) return bad;
  if (!isCircuitDesignRevision(input.expectedRevision)) return "Invalid expectedRevision.";
  if (!OPERATIONS.includes(input.operation)) return `operation must be one of ${OPERATIONS.join(", ")}.`;
  if (input.componentId != null && !ID_RE.test(String(input.componentId))) return "componentId must be a stable Circuit Lab ID.";
  if (input.componentTypeId != null && !ID_RE.test(String(input.componentTypeId))) return "componentTypeId must be a stable Circuit Lab catalog ID.";
  if (input.name != null && (typeof input.name !== "string" || input.name.length > 80)) return "name must be a string of 80 characters or fewer.";

  const operationKeys = {
    add: new Set(["expectedRevision", "operation", "componentTypeId", "name", "position"]),
    remove: new Set(["expectedRevision", "operation", "componentId"]),
    move: new Set(["expectedRevision", "operation", "componentId", "position"]),
    rotate: new Set(["expectedRevision", "operation", "componentId", "rotationDegrees"]),
    resize: new Set(["expectedRevision", "operation", "componentId", "scale"])
  };
  const unexpected = Object.keys(input).find((key) => !operationKeys[input.operation].has(key));
  if (unexpected) return `${unexpected} is not valid for operation ${input.operation}.`;

  if (input.operation === "add") {
    if (!input.componentTypeId) return "componentTypeId is required for add.";
    if (input.position != null && !finitePosition(input.position)) return "position must be a finite [x,y] pair between 0 and 2000 mm.";
  } else {
    if (!input.componentId) return `componentId is required for ${input.operation}.`;
  }
  if (input.operation === "move" && !finitePosition(input.position)) return "position must be a finite [x,y] pair between 0 and 2000 mm.";
  if (input.operation === "rotate" && (!Number.isFinite(Number(input.rotationDegrees)) || Number(input.rotationDegrees) < 0 || Number(input.rotationDegrees) > 359)) return "rotationDegrees must be between 0 and 359.";
  if (input.operation === "resize" && (!Number.isFinite(Number(input.scale)) || Number(input.scale) < 0.55 || Number(input.scale) > 1.9)) return "scale must be between 0.55 and 1.9.";
  return null;
}

function pendingConfirmationVisible(documentRef = globalThis.document) {
  const bench = documentRef?.querySelector?.("#circuit-mutation-confirmation");
  const agent = documentRef?.querySelector?.("#webmcp-pending-card");
  return Boolean((bench && !bench.hidden) || (agent && !agent.hidden));
}

async function pageActionBridge(runtime) {
  if (typeof runtime.executePageAction === "function") return runtime.executePageAction;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const execute = globalThis.__circuitLabCycle4?.executeAssistantAction;
    if (typeof execute === "function") return (name, args) => execute(name, args);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

function componentSummary(component) {
  if (!component) return null;
  return {
    id: component.id,
    typeId: component.typeId,
    position: component.position,
    rotation: component.rotation,
    scale: Number(component.props?.scale ?? 1)
  };
}

function actionFor(input) {
  if (input.operation === "add") return ["circuits_add_hardware", {
    componentTypeId: input.componentTypeId,
    ...(input.name ? { name: input.name } : {}),
    ...(input.position ? { position: input.position.map(Number) } : {})
  }];
  if (input.operation === "move") return ["circuits_move_component", { componentId: input.componentId, position: input.position.map(Number) }];
  if (input.operation === "rotate") return ["circuits_rotate_component", { componentId: input.componentId, rotationDegrees: Number(input.rotationDegrees) }];
  if (input.operation === "resize") return ["circuits_resize_component", { componentId: input.componentId, scale: Number(input.scale) }];
  return ["circuits_remove_component", { componentId: input.componentId }];
}

function operationCode(operation) {
  return {
    add: "component_added",
    remove: "component_removed",
    move: "component_moved",
    rotate: "component_rotated",
    resize: "component_resized"
  }[operation];
}

export function createCircuitComponentEditTool(runtime = {}) {
  if (typeof runtime.getProject !== "function") throw new Error("Component edit tool requires getProject().");
  const activityLog = runtime.activityLog ?? createActivityLog();
  let sequence = 0;
  const builtInTypeIds = catalog.listComponents().filter((item) => !item.custom?.localOnly).map((item) => item.id).sort();

  return {
    name: COMPONENT_EDIT_TOOL_NAME,
    title: "Edit Circuit Component",
    description: "Add, remove, move, rotate, or resize one Circuit Lab component. Requires the current design revision. Removal always asks the human before deleting the component and attached wiring; insertion-aware edits may surface the existing electrical-hazard confirmation.",
    inputSchema: schema({
      expectedRevision: { type: "string", pattern: REVISION_PATTERN, maxLength: 21 },
      operation: { type: "string", enum: OPERATIONS },
      componentId: { type: "string", pattern: ID_PATTERN, maxLength: 120 },
      componentTypeId: { type: "string", pattern: ID_PATTERN, maxLength: 120, description: `Built-in catalog type ID. Examples: ${builtInTypeIds.slice(0, 8).join(", ")}.` },
      name: { type: "string", maxLength: 80 },
      position: positionSchema,
      rotationDegrees: { type: "number", minimum: 0, maximum: 359 },
      scale: { type: "number", minimum: 0.55, maximum: 1.9 }
    }, ["expectedRevision", "operation"]),
    annotations: { readOnlyHint: false },
    async execute(input = {}, client = {}) {
      if (client.signal?.aborted) throw new DOMException("WebMCP execution aborted", "AbortError");
      const beforeProject = normalizeProject(runtime.getProject());
      const beforeRevision = circuitDesignRevision(beforeProject);
      const activityId = `activity_component_edit_${++sequence}`;
      const started = globalThis.performance?.now?.() ?? Date.now();
      activityLog.record({ activityId, actor: "webmcp", toolName: COMPONENT_EDIT_TOOL_NAME, status: "start", revisionBefore: beforeRevision, affectedComponentIds: [input.componentId].filter(Boolean) });

      const finish = (value, componentIds = []) => {
        const afterRevision = circuitDesignRevision(normalizeProject(runtime.getProject()));
        activityLog.record({
          activityId,
          actor: "webmcp",
          toolName: COMPONENT_EDIT_TOOL_NAME,
          status: "complete",
          code: value.code,
          revisionBefore: beforeRevision,
          revisionAfter: afterRevision,
          affectedComponentIds: componentIds,
          durationMs: (globalThis.performance?.now?.() ?? Date.now()) - started
        });
        runtime.onActivity?.();
        return value;
      };

      const bad = validateInput(input);
      if (bad) return finish(result(false, "invalid_arguments", beforeRevision, bad));
      if (input.expectedRevision !== beforeRevision) return finish(result(false, "stale_revision", beforeRevision, "Circuit state changed. Read state and retry the component edit."));
      if (pendingConfirmationVisible(runtime.document ?? globalThis.document)) return finish(result(false, "pending_confirmation_exists", beforeRevision, "Resolve the visible pending confirmation before editing another component."));

      if (input.operation === "add") {
        if (!catalog.getComponent(input.componentTypeId)) {
          return finish(result(false, "unknown_id", beforeRevision, `Unknown component type ${sanitize(input.componentTypeId, 120)}.`, { availableTypeIds: builtInTypeIds.slice(0, 16) }));
        }
      } else if (!beforeProject.components.some((component) => component.id === input.componentId)) {
        return finish(result(false, "unknown_id", beforeRevision, `Unknown component ID ${sanitize(input.componentId, 120)}.`), [input.componentId]);
      }

      if (input.operation === "remove") {
        const component = beforeProject.components.find((item) => item.id === input.componentId);
        const confirmRemoval = runtime.confirmRemoval ?? ((message) => globalThis.confirm?.(message) === true);
        const approved = await confirmRemoval(`Remove ${component?.name ?? input.componentId} (${input.componentId}) from Circuit Lab? Attached wiring endpoints may also be removed.`);
        if (!approved) return finish(result(false, "user_cancelled", beforeRevision, "Component removal was cancelled by the user.", { componentId: input.componentId, operation: input.operation }), [input.componentId]);
        if (circuitDesignRevision(normalizeProject(runtime.getProject())) !== beforeRevision) return finish(result(false, "stale_revision", circuitDesignRevision(normalizeProject(runtime.getProject())), "Circuit state changed while removal confirmation was open. Nothing was removed."), [input.componentId]);
      }

      const executePageAction = await pageActionBridge(runtime);
      if (!executePageAction) return finish(result(false, "runtime_not_ready", beforeRevision, "Circuit Lab component-edit runtime is not ready."), [input.componentId].filter(Boolean));

      const [actionName, actionArgs] = actionFor(input);
      let actionResult;
      try {
        actionResult = await executePageAction(actionName, actionArgs);
      } catch (error) {
        return finish(result(false, "operation_failed", beforeRevision, sanitize(error?.message ?? "Component edit failed.", 220)), [input.componentId].filter(Boolean));
      }
      if (client.signal?.aborted) throw new DOMException("WebMCP execution aborted", "AbortError");

      const afterProject = normalizeProject(runtime.getProject());
      const afterRevision = circuitDesignRevision(afterProject);
      const added = afterProject.components.filter((component) => !beforeProject.components.some((before) => before.id === component.id));
      const componentId = input.operation === "add" ? added[0]?.id ?? null : input.componentId;
      const component = componentId ? afterProject.components.find((item) => item.id === componentId) ?? null : null;

      if (afterRevision !== beforeRevision) {
        return finish(result(true, operationCode(input.operation), afterRevision, `${input.operation} completed for ${componentId ?? input.componentTypeId}.`, {
          operation: input.operation,
          componentId,
          component: componentSummary(component),
          removedConnectionIds: input.operation === "remove"
            ? beforeProject.connections.filter((connection) => connection.endpoints.some((endpoint) => endpoint.componentId === input.componentId) && !afterProject.connections.some((after) => after.id === connection.id)).map((connection) => connection.id).slice(0, 20)
            : []
        }), [componentId].filter(Boolean));
      }

      if (pendingConfirmationVisible(runtime.document ?? globalThis.document)) {
        return finish(result(false, "pending_confirmation", beforeRevision, "The component edit is mechanically resolved but awaits visible electrical-hazard confirmation.", { operation: input.operation, componentId: componentId ?? input.componentId ?? null }), [componentId ?? input.componentId].filter(Boolean));
      }

      const message = sanitize(actionResult?.message ?? "", 180).toLowerCase();
      if (/blocked|not moved|not resized|not rotated|was not/.test(message)) {
        return finish(result(false, "mechanically_blocked", beforeRevision, actionResult?.message ?? "The component edit was mechanically blocked.", { operation: input.operation, componentId: input.componentId ?? null }), [input.componentId].filter(Boolean));
      }
      return finish(result(true, "no_change", beforeRevision, "The requested component edit produced no canonical design change.", { operation: input.operation, componentId: componentId ?? input.componentId ?? null }), [componentId ?? input.componentId].filter(Boolean));
    }
  };
}

export async function registerCircuitComponentEditTool(runtime = {}, options = {}) {
  const modelContext = options.modelContext ?? globalThis.document?.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return { supported: false, registered: false, tool: null, dispose() {} };
  const tool = createCircuitComponentEditTool(runtime);
  const controller = new AbortController();
  const pagehide = () => controller.abort();
  globalThis.addEventListener?.("pagehide", pagehide, { once: true });
  try {
    await modelContext.registerTool(tool, { signal: controller.signal });
    return {
      supported: true,
      registered: true,
      tool,
      controller,
      dispose() {
        controller.abort();
        globalThis.removeEventListener?.("pagehide", pagehide);
      }
    };
  } catch (error) {
    controller.abort();
    return { supported: true, registered: false, tool, controller, error, dispose() { controller.abort(); } };
  }
}
