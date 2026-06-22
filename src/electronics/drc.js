import { PIN_TYPES, catalog, gpioNumber, isGroundPin, isPowerPin } from "./catalog.js";
import { normalizeCircuitDesign } from "./schema.js";
import {
  boardPinsInUse,
  componentsBySimRole,
  connectedGroundForComponentPin,
  findConnectedBoardPins,
  firstUsableGpioForComponentPin,
  resolvePin
} from "./pins.js";

function issue(severity, code, message, details = {}) {
  return {
    id: `${code}_${details.netId ?? details.instanceId ?? details.pinId ?? details.index ?? "design"}`,
    severity,
    code,
    message,
    ...details
  };
}

function severityRank(severity) {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function summarizeIssues(issues) {
  return {
    errors: issues.filter((item) => item.severity === "error").length,
    warnings: issues.filter((item) => item.severity === "warning").length,
    info: issues.filter((item) => item.severity === "info").length
  };
}

function passiveResistorsOnPath(design, path = []) {
  const normalized = normalizeCircuitDesign(design);
  const resistors = [];
  for (const edge of path) {
    if (edge.type !== "passive") continue;
    const instance = normalized.components.find((component) => component.id === edge.componentId);
    const componentDef = instance ? catalog.getComponent(instance.componentId) : null;
    if (componentDef?.sim?.role !== "resistor") continue;
    resistors.push({
      instance,
      definition: componentDef,
      resistanceOhm: Number(componentDef.sim.resistanceOhm)
    });
  }
  return resistors;
}

function netResolvedPins(design, net) {
  return net.endpoints.map((endpoint) => resolvePin(design, endpoint));
}

function checkNetShape(design, issues) {
  const normalized = normalizeCircuitDesign(design);
  normalized.nets.forEach((net, index) => {
    if (net.endpoints.length < 2) {
      issues.push(issue("warning", "dangling-net", `${net.name} has fewer than two endpoints.`, { netId: net.id, index }));
    }
    const resolved = netResolvedPins(normalized, net);
    for (const pin of resolved) {
      if (!pin.ok) issues.push(issue("error", "unknown-pin", pin.error, { netId: net.id, index }));
    }
    const validPins = resolved.filter((pin) => pin.ok);
    const hasGround = validPins.some((pin) => isGroundPin(pin.definition));
    const powerPins = validPins.filter((pin) => isPowerPin(pin.definition));
    if (hasGround && powerPins.length) {
      issues.push(issue("error", "power-ground-short", `${net.name} shorts power to ground.`, { netId: net.id }));
    }
    const voltages = [...new Set(powerPins.map((pin) => Number(pin.definition.voltage)).filter(Number.isFinite))];
    if (voltages.length > 1) {
      issues.push(issue("warning", "voltage-mismatch", `${net.name} ties multiple supply voltages together: ${voltages.join(" V, ")} V.`, { netId: net.id }));
    }
    for (const pin of validPins.filter((item) => item.ownerType === "board")) {
      if (pin.definition.reserved) {
        issues.push(issue("warning", "reserved-pin", `${pin.pinId} is reserved on ${normalized.board.name}.`, { netId: net.id, pinId: pin.pinId }));
      }
      if (pin.definition.flash) {
        issues.push(issue("warning", "flash-pin", `${pin.pinId} is commonly connected to SPI flash and should not be used.`, { netId: net.id, pinId: pin.pinId }));
      }
      if (pin.definition.strapping) {
        issues.push(issue("warning", "strapping-pin", `${pin.pinId} is a boot strapping pin; external circuits can affect boot mode.`, { netId: net.id, pinId: pin.pinId }));
      }
    }
  });
}

function checkLedRules(design, issues) {
  for (const led of componentsBySimRole(design, "led")) {
    const componentDef = catalog.getComponent(led.componentId);
    const outputPin = componentDef?.sim?.outputPin ?? "anode";
    const returnPin = componentDef?.sim?.returnPin ?? "cathode";
    const candidates = findConnectedBoardPins(design, { type: "component", instanceId: led.id, pinId: outputPin });
    const gpio = candidates.find((pin) => pin.definition.type === PIN_TYPES.GPIO);
    if (!gpio) {
      issues.push(issue("warning", "led-no-gpio", `${led.name} is not connected to a GPIO output path.`, { instanceId: led.id }));
      continue;
    }
    if (gpio.definition.inputOnly) {
      issues.push(issue("error", "input-only-output", `${led.name} is driven from input-only ${gpio.pinId}.`, { instanceId: led.id, pinId: gpio.pinId }));
    }
    const resistors = passiveResistorsOnPath(design, gpio.path);
    if (!resistors.length) {
      issues.push(issue("error", "led-missing-resistor", `${led.name} is connected to ${gpio.pinId} without a series resistor.`, { instanceId: led.id, pinId: gpio.pinId }));
    } else {
      const smallest = resistors.reduce((best, item) => item.resistanceOhm < best.resistanceOhm ? item : best, resistors[0]);
      if (smallest.resistanceOhm < 100) {
        issues.push(issue("warning", "led-resistor-low", `${led.name} uses ${smallest.resistanceOhm} ohm series resistance; use at least 100 ohm for a safe starter design.`, {
          instanceId: led.id,
          pinId: gpio.pinId
        }));
      }
      const ledVoltage = Number(componentDef?.sim?.nominalVoltage ?? 2.0);
      const currentMa = ((3.3 - ledVoltage) / Math.max(1, smallest.resistanceOhm)) * 1000;
      if (Number.isFinite(gpio.definition.maxCurrentMa) && currentMa > gpio.definition.maxCurrentMa) {
        issues.push(issue("warning", "gpio-current-budget", `${led.name} may draw ${currentMa.toFixed(1)} mA from ${gpio.pinId}, above the ${gpio.definition.maxCurrentMa} mA starter budget.`, {
          instanceId: led.id,
          pinId: gpio.pinId
        }));
      }
    }
    if (!connectedGroundForComponentPin(design, led.id, returnPin)) {
      issues.push(issue("warning", "led-no-return", `${led.name} cathode is not connected to ground.`, { instanceId: led.id }));
    }
  }
}

function checkButtonRules(design, issues) {
  for (const button of componentsBySimRole(design, "button")) {
    const componentDef = catalog.getComponent(button.componentId);
    const inputPin = componentDef?.sim?.inputPin ?? "a";
    const returnPin = componentDef?.sim?.returnPin ?? "b";
    const gpio = firstUsableGpioForComponentPin(design, button.id, inputPin);
    if (!gpio) {
      issues.push(issue("warning", "button-no-gpio", `${button.name} is not connected to a GPIO input.`, { instanceId: button.id }));
    } else if (!gpio.definition.capabilities?.includes("input")) {
      issues.push(issue("error", "pin-not-input-capable", `${button.name} uses ${gpio.pinId}, which is not input capable.`, { instanceId: button.id, pinId: gpio.pinId }));
    }
    if (!connectedGroundForComponentPin(design, button.id, returnPin)) {
      issues.push(issue("warning", "button-no-return", `${button.name} return pin is not connected to ground.`, { instanceId: button.id }));
    }
  }
}

function dedupeIssues(issues) {
  const bestByKey = new Map();
  for (const item of issues) {
    const key = `${item.code}:${item.netId ?? ""}:${item.instanceId ?? ""}:${item.pinId ?? ""}:${item.message}`;
    const existing = bestByKey.get(key);
    if (!existing || severityRank(item.severity) > severityRank(existing.severity)) {
      bestByKey.set(key, item);
    }
  }
  return [...bestByKey.values()].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta) return severityDelta;
    return left.code.localeCompare(right.code);
  });
}

export function runDrc(design) {
  const normalized = normalizeCircuitDesign(design);
  const issues = [];
  if (!catalog.getBoard(normalized.board.id)) {
    issues.push(issue("error", "unknown-board", `Unknown board: ${normalized.board.id}`));
  }
  normalized.components.forEach((component, index) => {
    if (!catalog.getComponent(component.componentId)) {
      issues.push(issue("error", "unknown-component", `Unknown component catalog id: ${component.componentId}`, {
        instanceId: component.id,
        index
      }));
    }
  });
  checkNetShape(normalized, issues);
  checkLedRules(normalized, issues);
  checkButtonRules(normalized, issues);
  const deduped = dedupeIssues(issues);
  return {
    ok: deduped.every((item) => item.severity !== "error"),
    issues: deduped,
    summary: summarizeIssues(deduped)
  };
}

export function suggestSafePin(design, options = {}) {
  const normalized = normalizeCircuitDesign(design);
  const board = catalog.getBoard(normalized.board.id);
  if (!board) return null;
  const role = options.role ?? "output";
  const used = boardPinsInUse(normalized);
  const candidates = board.pins
    .filter((pin) => pin.type === PIN_TYPES.GPIO)
    .filter((pin) => !used.has(pin.id))
    .filter((pin) => !pin.reserved && !pin.flash)
    .filter((pin) => role !== "output" || (!pin.inputOnly && pin.capabilities.includes("output")))
    .filter((pin) => role !== "input" || pin.capabilities.includes("input"))
    .map((pin) => ({
      pinId: pin.id,
      label: pin.label ?? pin.id,
      gpio: gpioNumber(pin.id),
      strapping: pin.strapping,
      notes: pin.notes
    }))
    .sort((left, right) => {
      if (left.strapping !== right.strapping) return left.strapping ? 1 : -1;
      return (left.gpio ?? 999) - (right.gpio ?? 999);
    });
  return candidates[0] ?? null;
}
