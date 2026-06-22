import { catalog } from "./catalog.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeByRule(rule, value, fallback) {
  if (rule === "power") return value === "on" ? "on" : "off";
  if (rule === "throw") return value === "b" ? "b" : "a";
  if (rule === "unitInterval") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : fallback;
  }
  if (rule === "servoAngle") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 180) : fallback;
  }
  if (rule === "momentary") return value === "down" ? "down" : "up";
  return value ?? fallback;
}

export function persistentControlDefinitions(componentDefinition) {
  return Object.entries(componentDefinition?.controls ?? {})
    .filter(([, definition]) => definition.persistent);
}

export function normalizeControlState(componentDefinition, input = {}, options = {}) {
  const normalized = {};
  const controls = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const [controlId, definition] of persistentControlDefinitions(componentDefinition)) {
    const fallback = options.useLegacyDefaults ? definition.legacyDefaultValue : definition.defaultValue;
    normalized[controlId] = normalizeByRule(definition.normalize, controls[controlId], fallback);
  }
  return normalized;
}

export function normalizeControlValue(componentDefinition, controlId, value) {
  const definition = componentDefinition?.controls?.[controlId];
  if (!definition || !definition.persistent) throw new Error(`Unknown persistent control: ${controlId}`);
  return normalizeByRule(definition.normalize, value, definition.defaultValue);
}

export function setPersistentControlOnComponent(component, componentDefinition, controlId, value) {
  const current = normalizeControlState(componentDefinition, component?.props?.controls);
  return {
    ...component,
    props: {
      ...(component?.props ?? {}),
      controls: {
        ...current,
        [controlId]: normalizeControlValue(componentDefinition, controlId, value)
      }
    }
  };
}

export function deriveActiveContactBuses(component, componentDefinition, sessionState = {}) {
  const role = componentDefinition?.sim?.role;
  const controls = normalizeControlState(componentDefinition, component?.props?.controls);
  const momentary = sessionState?.controlPresses?.[component?.id];
  const pressed = momentary instanceof Set ? momentary.has("press") : Array.isArray(momentary) ? momentary.includes("press") : false;
  if (role === "button" && pressed) {
    return [{ id: "button_pressed_bridge", terminalIds: ["sense", "return"], dynamic: true }];
  }
  if (role === "switch") {
    return [{ id: `switch_throw_${controls.throw}`, terminalIds: ["COM", controls.throw === "b" ? "B" : "A"], dynamic: true }];
  }
  return [];
}

export function derivePotentialContactStates(component, componentDefinition) {
  const role = componentDefinition?.sim?.role;
  if (role === "button") {
    return [
      { id: `${component.id}:button-up`, buses: [] },
      { id: `${component.id}:button-down`, buses: [{ id: "button_pressed_bridge", terminalIds: ["sense", "return"], dynamic: true }] }
    ];
  }
  if (role === "switch") {
    return [
      { id: `${component.id}:throw-a`, buses: [{ id: "switch_throw_a", terminalIds: ["COM", "A"], dynamic: true }] },
      { id: `${component.id}:throw-b`, buses: [{ id: "switch_throw_b", terminalIds: ["COM", "B"], dynamic: true }] }
    ];
  }
  return [{ id: `${component.id}:static`, buses: [] }];
}

export function isSourceEnabled(component, componentDefinition) {
  if (componentDefinition?.sim?.role !== "externalSupply") return true;
  const controls = normalizeControlState(componentDefinition, component?.props?.controls);
  return controls.power === "on";
}

export function potentiometerSemanticValue(component, componentDefinition = catalog.getComponent(component?.typeId)) {
  if (componentDefinition?.sim?.role !== "potentiometer") return null;
  const controls = normalizeControlState(componentDefinition, component?.props?.controls);
  return controls.wiper;
}

export function componentControlSummary(component, componentDefinition = catalog.getComponent(component?.typeId)) {
  const controls = normalizeControlState(componentDefinition, component?.props?.controls);
  return Object.entries(componentDefinition?.controls ?? {}).map(([controlId, definition]) => ({
    controlId,
    type: definition.type,
    persistent: Boolean(definition.persistent),
    value: definition.persistent ? controls[controlId] : "session-only",
    defaultValue: definition.defaultValue
  }));
}
