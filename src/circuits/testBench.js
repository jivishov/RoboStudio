import { TERMINAL_KINDS, catalog } from "./catalog.js";
import {
  connectedGround,
  connectedPower,
  endpointLabel,
  findConnectedTerminals,
  firstControllerTerminalFor,
  projectController,
  resolveTerminal
} from "./connectivity.js";
import {
  analyzeCircuit,
  currentScenarioForComponent,
  terminalAcceptsVoltage,
  terminalIsPowerInput,
  terminalIsPowerSource,
  terminalIsSignalInput,
  terminalIsSignalOutput,
  terminalNominalVoltage,
  voltageRangeForComponentInput
} from "./electricalAnalysis.js";
import { normalizeProject, setComponentControl } from "./model.js";
import { derivePhysicalOccupancy } from "./occupancy.js";

function issue(severity, code, message, details = {}) {
  const componentIds = details.targets?.componentIds
    ?? (details.componentId ? [details.componentId] : []);
  const terminalRefs = details.targets?.terminalRefs ?? details.endpoints ?? [];
  const connectionIds = details.targets?.connectionIds ?? details.connectionIds ?? [];
  const targetSuffix = details.endpointKey
    || (terminalRefs.length ? terminalRefs.map((endpoint) => `${endpoint.componentId}_${endpoint.terminalId}`).join("_") : "")
    || details.componentId
    || details.connectionId
    || "project";
  return {
    id: `${code}_${targetSuffix || "project"}`,
    severity,
    code,
    message,
    fix: details.fix ?? "",
    blocks: {
      sourceMapping: severity === "error",
      semanticRun: severity === "error",
      realWorldReadiness: severity === "error",
      ...(details.blocks ?? {})
    },
    targets: {
      componentIds,
      terminalRefs,
      connectionIds
    },
    endpoints: terminalRefs,
    connectionIds,
    componentId: details.componentId ?? null
  };
}

function severityRank(severity) {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function summarize(issues) {
  return {
    errors: issues.filter((item) => item.severity === "error").length,
    warnings: issues.filter((item) => item.severity === "warning").length,
    info: issues.filter((item) => item.severity === "info").length
  };
}

function componentEndpoint(component, terminalId) {
  return { componentId: component.id, terminalId };
}

function hasPassiveResistance(path = []) {
  return path.some((edge) => edge.type === "passive" && Number(edge.resistanceOhm) > 0);
}

function connectionIdsForEndpoint(project, endpoint) {
  const key = `${endpoint.componentId}:${endpoint.terminalId}`;
  return normalizeProject(project).connections
    .filter((connection) => connection.endpoints.some((item) => `${item.componentId}:${item.terminalId}` === key))
    .map((connection) => connection.id);
}

function endpointKey(endpoint) {
  return `${endpoint.componentId}:${endpoint.terminalId}`;
}

function compatiblePowerSourceForInput(project, endpoint) {
  const input = resolveTerminal(project, endpoint);
  if (!input.ok) return null;
  const linked = findConnectedTerminals(project, endpoint, { includePassive: false });
  for (const source of linked) {
    if (endpointKey(source.endpoint) === endpointKey(input.endpoint)) continue;
    if (!terminalIsPowerSource(source.componentDefinition, source.terminal)) continue;
    const sourceVoltage = terminalNominalVoltage(source.componentDefinition, source.terminal);
    if (!Number.isFinite(Number(sourceVoltage))) continue;
    const range = voltageRangeForComponentInput(input.component, input.componentDefinition, input.terminal);
    const accepts = terminalAcceptsVoltage({
      ...input.componentDefinition,
      engineering: {
        ...input.componentDefinition.engineering,
        voltageDomains: [
          ...(input.componentDefinition.engineering?.voltageDomains ?? []).filter((domain) => domain.id !== input.terminal.voltageDomainId),
          { id: input.terminal.voltageDomainId, role: "input", ...range }
        ]
      }
    }, input.terminal, sourceVoltage);
    if (accepts) return source;
  }
  return null;
}

function checkConnections(project, issues) {
  const normalized = normalizeProject(project);
  for (const connection of normalized.connections) {
    if (connection.endpoints.length < 2) {
      issues.push(issue("warning", "dangling-wire", `${connection.name} has fewer than two terminals.`, {
        connectionId: connection.id,
        connectionIds: [connection.id],
        fix: "Connect the wire to a second terminal or remove it."
      }));
    }
    for (const endpoint of connection.endpoints) {
      const resolved = resolveTerminal(normalized, endpoint);
      if (!resolved.ok) {
        issues.push(issue("error", "unknown-terminal", resolved.error, {
          connectionId: connection.id,
          connectionIds: [connection.id],
          endpoints: [endpoint],
          fix: "Reconnect the wire to an existing terminal."
        }));
      } else if (resolved.componentDefinition.sim.role === "controller" && resolved.terminal.strapping) {
        issues.push(issue("warning", "controller-strapping-pin", `${resolved.label} is a boot or mode strapping pin.`, {
          endpointKey: resolved.endpointKey,
          endpoints: [resolved.endpoint],
          connectionIds: [connection.id],
          fix: "Prefer a non-strapping GPIO for starter wiring."
        }));
      } else if (resolved.componentDefinition.sim.role === "controller" && resolved.terminal.reserved) {
        issues.push(issue("warning", "controller-reserved-pin", `${resolved.label} is reserved.`, {
          endpointKey: resolved.endpointKey,
          endpoints: [resolved.endpoint],
          connectionIds: [connection.id],
          fix: "Choose a normal input/output terminal."
        }));
      }
    }
  }
}

function checkOccupancy(project, issues) {
  const occupancy = derivePhysicalOccupancy(project);
  for (const conflict of occupancy.conflicts) {
    issues.push(issue("error", "physical-terminal-occupied", `${endpointLabel(project, conflict.endpoint)} has ${conflict.attachments.length} physical attachments but supports ${conflict.capacity}.`, {
      endpoints: [conflict.endpoint],
      connectionIds: conflict.attachments.map((item) => item.connectionId),
      fix: "Move one wire or direct insertion to a separate physical socket or terminal."
    }));
  }
}

function checkDirectGroups(project, issues, analysis) {
  for (const group of analysis.directGroups) {
    const powers = group.terminals.filter((item) => terminalIsPowerSource(item.componentDefinition, item.terminal) && Number(item.terminal.voltage) > 0);
    const grounds = group.terminals.filter((item) => item.terminal.kind === TERMINAL_KINDS.GROUND || item.terminal.electricalRole === "ground");
    if (powers.length && grounds.length) {
      issues.push(issue("error", "power-ground-short", "A direct net ties power to ground.", {
        endpoints: [...powers, ...grounds].slice(0, 6).map((item) => item.endpoint),
        fix: "Separate the positive rail from ground and remove any reversed rail bridge."
      }));
    }
    const voltages = [...new Set(powers.map((item) => Number(item.terminal.voltage)).filter(Number.isFinite))];
    if (voltages.length > 1) {
      issues.push(issue("error", "voltage-mismatch", `A direct net ties multiple voltage domains: ${voltages.join(" V, ")} V.`, {
        endpoints: powers.slice(0, 6).map((item) => item.endpoint),
        fix: "Keep controller logic power and external actuator power on separate positive rails."
      }));
    }
  }
}

function directGroupsWithPowerGroundShort(analysis) {
  return analysis.directGroups.filter((group) => {
    const powers = group.terminals.filter((item) => terminalIsPowerSource(item.componentDefinition, item.terminal) && Number(item.terminal.voltage) > 0);
    const grounds = group.terminals.filter((item) => item.terminal.kind === TERMINAL_KINDS.GROUND || item.terminal.electricalRole === "ground");
    return powers.length && grounds.length;
  });
}

function checkPotentialControlShorts(project, issues) {
  const normalized = normalizeProject(project);
  let scenarioCount = 0;
  for (const component of normalized.components) {
    const definition = catalog.getComponent(component.typeId);
    if (definition?.sim?.role === "button") {
      scenarioCount += 1;
      const analysis = analyzeCircuit(normalized, {
        sessionState: { controlPresses: { [component.id]: new Set(["press"]) } }
      });
      if (directGroupsWithPowerGroundShort(analysis).length) {
        issues.push(issue("error", "control-state-short", `${component.name} can short power to ground when pressed.`, {
          componentId: component.id,
          fix: "Rewire the button so the pressed bridge does not tie a powered net directly to ground."
        }));
      }
    }
    if (definition?.sim?.role === "switch") {
      for (const value of ["a", "b"]) {
        scenarioCount += 1;
        const candidate = setComponentControl(normalized, component.id, "throw", value, { now: normalized.updatedAt });
        const analysis = analyzeCircuit(candidate);
        if (directGroupsWithPowerGroundShort(analysis).length) {
          issues.push(issue("error", "control-state-short", `${component.name} can short power to ground in throw ${value.toUpperCase()}.`, {
            componentId: component.id,
            fix: "Move the SPDT common or throw wiring so no switch position ties power directly to ground."
          }));
        }
      }
    }
  }
  if (scenarioCount > 64) {
    issues.push(issue("info", "control-state-limit", "Control-state short checks were capped at 64 finite scenarios.", {
      fix: "Review complex interactive switch/button combinations manually."
    }));
  }
}

function controllerOutputPredicate(terminal) {
  return terminal.kind === TERMINAL_KINDS.SIGNAL && terminal.capabilities?.includes("output") && !terminal.inputOnly;
}

function controllerInputPredicate(terminal) {
  return terminal.kind === TERMINAL_KINDS.SIGNAL && terminal.capabilities?.includes("input");
}

function checkControllerSelection(project, issues) {
  const normalized = normalizeProject(project);
  const controller = projectController(normalized);
  if (!normalized.controllerId || !controller || controller.instance.id !== normalized.controllerId) {
    issues.push(issue("error", "controller-missing", "Circuit Lab needs a valid selected controller.", {
      fix: "Select the controller component that owns the generated firmware channels."
    }));
  }
}

function checkRequiredConnections(project, issues) {
  const normalized = normalizeProject(project);
  for (const component of normalized.components) {
    const definition = catalog.getComponent(component.typeId);
    const requiredConnections = definition?.engineering?.requiredConnections ?? [];
    for (const required of requiredConnections) {
      const endpoint = componentEndpoint(component, required.terminalId);
      const connectionIds = connectionIdsForEndpoint(normalized, endpoint);
      if (!connectionIds.length) {
        const code = definition.sim.role === "motorDriver" ? "driver-incomplete" : "required-connection-missing";
        issues.push(issue("error", code, `${component.name} is missing ${required.role} on ${required.terminalId}.`, {
          componentId: component.id,
          endpoints: [endpoint],
          fix: "Complete every required catalog connection before source export or physical bring-up."
        }));
        continue;
      }
      if (required.role === "controller-output" && !firstControllerTerminalFor(normalized, endpoint, controllerOutputPredicate)) {
        issues.push(issue("error", "required-controller-output-missing", `${component.name} ${required.terminalId} needs a controller output.`, {
          componentId: component.id,
          endpoints: [endpoint],
          connectionIds,
          fix: "Wire this terminal to an output-capable controller terminal."
        }));
      }
      if (required.role === "controller-input" && !firstControllerTerminalFor(normalized, endpoint, controllerInputPredicate)) {
        issues.push(issue("error", "required-controller-input-missing", `${component.name} ${required.terminalId} needs a controller input.`, {
          componentId: component.id,
          endpoints: [endpoint],
          connectionIds,
          fix: "Wire this terminal to an input-capable controller terminal."
        }));
      }
      if (required.role === "common-ground" && !connectedGround(normalized, endpoint)) {
        issues.push(issue("error", "required-ground-missing", `${component.name} ${required.terminalId} needs a ground reference.`, {
          componentId: component.id,
          endpoints: [endpoint],
          connectionIds,
          fix: "Tie this terminal into the common ground net."
        }));
      }
      if ((required.role === "power-input" || required.role === "external-power") && !compatiblePowerSourceForInput(normalized, endpoint)) {
        issues.push(issue("error", "required-power-missing", `${component.name} ${required.terminalId} needs a compatible powered source.`, {
          componentId: component.id,
          endpoints: [endpoint],
          connectionIds,
          fix: "Connect this terminal to a powered source within the component input range."
        }));
      }
    }
  }
}

function checkVoltageCompatibility(project, issues, analysis) {
  for (const group of analysis.directGroups) {
    const sources = group.terminals.filter((record) => terminalIsPowerSource(record.componentDefinition, record.terminal));
    const inputs = group.terminals.filter((record) => terminalIsPowerInput(record.componentDefinition, record.terminal));
    for (const source of sources) {
      const sourceVoltage = terminalNominalVoltage(source.componentDefinition, source.terminal);
      if (!Number.isFinite(Number(sourceVoltage))) continue;
      for (const input of inputs) {
        if (source.endpointKey === input.endpointKey) continue;
        const range = voltageRangeForComponentInput(input.component, input.componentDefinition, input.terminal);
        const accepts = terminalAcceptsVoltage({ ...input.componentDefinition, engineering: { ...input.componentDefinition.engineering, voltageDomains: [
          ...(input.componentDefinition.engineering?.voltageDomains ?? []).filter((domain) => domain.id !== input.terminal.voltageDomainId),
          { id: input.terminal.voltageDomainId, role: "input", ...range }
        ] } }, input.terminal, sourceVoltage);
        if (!accepts) {
          issues.push(issue("error", "voltage-out-of-range", `${input.label} is connected to ${sourceVoltage} V outside its accepted range.`, {
            componentId: input.component.id,
            endpoints: [input.endpoint, source.endpoint],
            fix: "Use a supply or regulator within the component input range."
          }));
        }
      }
    }
  }
}

function checkPolarity(project, issues, analysis) {
  for (const group of analysis.directGroups) {
    const sources = group.terminals.filter((record) => terminalIsPowerSource(record.componentDefinition, record.terminal));
    const grounds = group.terminals.filter((record) => record.terminal.kind === TERMINAL_KINDS.GROUND || record.terminal.electricalRole === "ground");
    for (const record of group.terminals) {
      if (terminalIsPowerInput(record.componentDefinition, record.terminal) && grounds.length) {
        issues.push(issue("error", "polarity-reversed", `${record.label} is tied directly to ground.`, {
          componentId: record.component.id,
          endpoints: [record.endpoint, grounds[0].endpoint],
          fix: "Move the positive/input lead to a positive supply net."
        }));
      }
      if ((record.terminal.kind === TERMINAL_KINDS.GROUND || record.terminal.electricalRole === "ground") && sources.length && record.componentDefinition.sim.role !== "controller" && record.componentDefinition.sim.role !== "externalSupply") {
        issues.push(issue("error", "polarity-reversed", `${record.label} is tied directly to a positive supply.`, {
          componentId: record.component.id,
          endpoints: [record.endpoint, sources[0].endpoint],
          fix: "Move the ground lead to the ground/common return net."
        }));
      }
    }
  }

  const normalized = normalizeProject(project);
  for (const component of normalized.components) {
    const definition = catalog.getComponent(component.typeId);
    if (definition?.sim.role !== "capacitor" || !definition.sim.polarized) continue;
    const pos = componentEndpoint(component, "pos");
    const neg = componentEndpoint(component, "neg");
    if (connectedGround(normalized, pos)) {
      issues.push(issue("error", "capacitor-polarity-reversed", `${component.name} positive leg is tied to ground.`, {
        componentId: component.id,
        endpoints: [pos],
        fix: "Place the positive capacitor leg on the positive rail."
      }));
    }
    if (connectedPower(normalized, neg)) {
      issues.push(issue("error", "capacitor-polarity-reversed", `${component.name} negative leg is tied to a positive rail.`, {
        componentId: component.id,
        endpoints: [neg],
        fix: "Place the negative capacitor leg on ground."
      }));
    }
  }
}

function checkLogicLevels(project, issues, analysis) {
  for (const group of analysis.directGroups) {
    const outputs = group.signalOutputs.filter((record) => record.componentDefinition.sim.role !== "button");
    const inputs = group.signalInputs;
    for (const output of outputs) {
      const outputMax = Number(output.terminal.logicMaximumV);
      if (!Number.isFinite(outputMax)) continue;
      for (const input of inputs) {
        if (input.endpointKey === output.endpointKey) continue;
        const inputMax = Number(input.terminal.logicMaximumV);
        if (!Number.isFinite(inputMax) || outputMax <= inputMax + 0.05) continue;
        const hasIntegratedLevelShift = input.componentDefinition.engineering?.protection?.levelShifting === "integrated"
          || output.componentDefinition.engineering?.protection?.levelShifting === "integrated";
        if (hasIntegratedLevelShift) continue;
        issues.push(issue("error", "logic-level-mismatch", `${output.label} can drive ${outputMax} V into ${input.label}, which is rated for ${inputMax} V logic.`, {
          componentId: input.component.id,
          endpoints: [output.endpoint, input.endpoint],
          fix: "Add level shifting or use a tolerant controller input."
        }));
      }
    }
  }
}

function checkServo(project, servo, issues) {
  const def = catalog.getComponent(servo.typeId);
  const signal = componentEndpoint(servo, def.sim.signalTerminal ?? "signal");
  const power = componentEndpoint(servo, def.sim.powerTerminal ?? "vplus");
  const ground = componentEndpoint(servo, def.sim.groundTerminal ?? "gnd");
  const signalController = firstControllerTerminalFor(project, signal, controllerOutputPredicate);
  if (!signalController) {
    issues.push(issue("error", "servo-missing-signal", `${servo.name} needs a controller signal terminal.`, {
      componentId: servo.id,
      endpoints: [signal],
      fix: "Connect the servo signal wire to a PWM-capable Arduino digital pin or safe ESP32 GPIO."
    }));
  } else if (!signalController.terminal.capabilities?.servoPulse) {
    issues.push(issue("error", "servo-pulse-unsupported", `${servo.name} uses ${signalController.label}, which is not marked for servo-pulse output.`, {
      componentId: servo.id,
      endpoints: [signalController.endpoint],
      fix: "Use a firmware-supported servo-pulse terminal, not just an ordinary PWM marker."
    }));
  } else if (signalController.componentDefinition.sim.servoRequiresPwm === true && !signalController.terminal.pwm) {
    issues.push(issue("warning", "servo-non-pwm-signal", `${servo.name} uses ${signalController.label}, which is not marked PWM-capable.`, {
      componentId: servo.id,
      endpoints: [signalController.endpoint],
      fix: "Prefer D3/D5/D6/D9/D10/D11 on Arduino Uno for starter servo tests."
    }));
  }

  const powerLinks = findConnectedTerminals(project, power);
  const controllerPower = powerLinks.find((item) => item.componentDefinition.sim.role === "controller" && item.terminal.kind === TERMINAL_KINDS.POWER);
  const externalPower = powerLinks.find((item) => item.componentDefinition.sim.role === "externalSupply" && item.terminal.kind === TERMINAL_KINDS.POWER);
  if (controllerPower) {
    issues.push(issue("error", "servo-controller-power", `${servo.name} is powered from ${controllerPower.label}.`, {
      componentId: servo.id,
      endpoints: [power, controllerPower.endpoint],
      fix: "Move the servo red/+V wire to an external 5-6 V supply. Keep only signal and shared ground on the controller."
    }));
  } else if (!externalPower) {
    issues.push(issue("error", "servo-no-external-power", `${servo.name} has no external actuator supply on +V.`, {
      componentId: servo.id,
      endpoints: [power],
      fix: "Connect servo +V to a current-rated external 5-6 V supply."
    }));
  }

  const groundLinks = findConnectedTerminals(project, ground);
  const anyGround = groundLinks.find((item) => item.terminal.kind === TERMINAL_KINDS.GROUND);
  const controllerGround = groundLinks.find((item) => item.componentDefinition.sim.role === "controller" && item.terminal.kind === TERMINAL_KINDS.GROUND);
  if (!anyGround) {
    issues.push(issue("error", "servo-missing-ground", `${servo.name} ground is not tied to ground.`, {
      componentId: servo.id,
      endpoints: [ground],
      fix: "Connect servo ground to the external supply ground."
    }));
  } else if (!controllerGround) {
    issues.push(issue("error", "missing-common-ground", `${servo.name} lacks a common ground reference with the controller.`, {
      componentId: servo.id,
      endpoints: [ground],
      fix: "Tie external supply ground and controller GND together before testing the servo."
    }));
  }
}

function checkLed(project, led, issues) {
  const def = catalog.getComponent(led.typeId);
  const output = componentEndpoint(led, def.sim.outputTerminal ?? "anode");
  const ret = componentEndpoint(led, def.sim.returnTerminal ?? "cathode");
  const controllerSignal = firstControllerTerminalFor(project, output, controllerOutputPredicate);
  if (!controllerSignal) {
    issues.push(issue("warning", "led-no-output", `${led.name} is not connected to a controller output path.`, {
      componentId: led.id,
      endpoints: [output],
      fix: "Connect the LED anode through a resistor to an output terminal."
    }));
  } else if (!hasPassiveResistance(controllerSignal.path)) {
    issues.push(issue("error", "led-missing-resistor", `${led.name} is connected to ${controllerSignal.label} without series resistance.`, {
      componentId: led.id,
      endpoints: [output, controllerSignal.endpoint],
      fix: "Place a 220 ohm or larger resistor in series with the LED."
    }));
  }
  if (!connectedGround(project, ret)) {
    issues.push(issue("warning", "led-no-ground-return", `${led.name} cathode is not connected to ground.`, {
      componentId: led.id,
      endpoints: [ret],
      fix: "Connect the LED cathode to GND."
    }));
  }
}

function checkButton(project, button, issues) {
  const def = catalog.getComponent(button.typeId);
  const input = componentEndpoint(button, def.sim.inputTerminal ?? "sense");
  const ret = componentEndpoint(button, def.sim.returnTerminal ?? "return");
  const controllerInput = firstControllerTerminalFor(project, input, controllerInputPredicate);
  if (!controllerInput) {
    issues.push(issue("warning", "button-floating-input", `${button.name} is not connected to a controller input.`, {
      componentId: button.id,
      endpoints: [input],
      fix: "Connect the button sense terminal to an input-capable controller terminal."
    }));
  }
  if (!connectedGround(project, ret)) {
    issues.push(issue("warning", "button-no-return", `${button.name} return is not connected to ground.`, {
      componentId: button.id,
      endpoints: [ret],
      fix: "Connect the button return terminal to GND."
    }));
  }
}

function checkMotorDriver(project, driver, issues) {
  const required = [
    ["VMOTOR", "motor supply power"],
    ["GND", "common ground"],
    ["IN1", "controller input IN1"],
    ["IN2", "controller input IN2"],
    ["OUT1", "motor output OUT1"],
    ["OUT2", "motor output OUT2"]
  ];
  for (const [terminalId, label] of required) {
    const endpoint = componentEndpoint(driver, terminalId);
    const connections = connectionIdsForEndpoint(project, endpoint);
    if (!connections.length) {
      issues.push(issue("error", "driver-incomplete", `${driver.name} is missing ${label}.`, {
        componentId: driver.id,
        endpoints: [endpoint],
        fix: "Complete the driver power, control, and motor output wiring before testing."
      }));
    }
  }
  if (!connectedPower(project, componentEndpoint(driver, "VMOTOR"))) {
    issues.push(issue("error", "driver-no-motor-power", `${driver.name} has no motor supply voltage.`, {
      componentId: driver.id,
      endpoints: [componentEndpoint(driver, "VMOTOR")],
      fix: "Connect VMOT to an external motor supply."
    }));
  }
  if (!firstControllerTerminalFor(project, componentEndpoint(driver, "IN1"), controllerOutputPredicate)
    || !firstControllerTerminalFor(project, componentEndpoint(driver, "IN2"), controllerOutputPredicate)) {
    issues.push(issue("warning", "driver-control-missing", `${driver.name} needs controller outputs on IN1 and IN2.`, {
      componentId: driver.id,
      endpoints: [componentEndpoint(driver, "IN1"), componentEndpoint(driver, "IN2")],
      fix: "Wire both driver inputs to safe controller outputs."
    }));
  }
}

function checkComponents(project, issues) {
  const normalized = normalizeProject(project);
  for (const component of normalized.components) {
    const definition = catalog.getComponent(component.typeId);
    if (!definition) {
      issues.push(issue("error", "unknown-component", `Unknown component type: ${component.typeId}.`, {
        componentId: component.id,
        fix: "Replace this component with a catalog item."
      }));
      continue;
    }
    if (definition.custom?.missing) {
      issues.push(issue("error", "missing-custom-component", `${component.name} needs a local custom component library entry before it can be wired or validated.`, {
        componentId: component.id,
        fix: "Import the matching custom component into this browser's Circuit Lab custom library."
      }));
      continue;
    }
    const roboticsRole = definition.engineering?.robotics?.role ?? "";
    if ((roboticsRole.startsWith("actuator.") || roboticsRole.startsWith("driver."))
      && definition.engineering?.specificationBasis === "generic") {
      issues.push(issue("warning", "generic-rating-review", `${component.name} uses generic catalog ratings that need confirmation before physical bring-up.`, {
        componentId: component.id,
        fix: "Enter confirmed voltage/current specifications in Engineering specifications before relying on the build checklist."
      }));
    }
    if (definition.sim.role === "servo") checkServo(normalized, component, issues);
    if (definition.sim.role === "led") checkLed(normalized, component, issues);
    if (definition.sim.role === "button") checkButton(normalized, component, issues);
    if (definition.sim.role === "motorDriver") checkMotorDriver(normalized, component, issues);
  }
}

function checkCurrentBudgets(project, issues) {
  const normalized = normalizeProject(project);
  const supplyComponents = normalized.components.filter((component) => catalog.getComponent(component.typeId)?.sim.role === "externalSupply");
  for (const supply of supplyComponents) {
    const supplyDef = catalog.getComponent(supply.typeId);
    const powerEndpoint = componentEndpoint(supply, "VPLUS");
    const linked = findConnectedTerminals(normalized, powerEndpoint);
    const loadComponents = new Map();
    for (const item of linked) {
      const role = item.componentDefinition.sim.role;
      const roboticsRole = item.componentDefinition.engineering?.robotics?.role;
      if (role === "externalSupply" || role === "breadboard" || roboticsRole === "power-source" || roboticsRole === "prototyping" || roboticsRole === "passive") continue;
      const scenario = currentScenarioForComponent(item.component, item.componentDefinition);
      const loadCurrent = Number(scenario.typical ?? item.componentDefinition.sim.loadCurrentMa);
      const peakCurrent = Number(scenario.peak);
      if (Number.isFinite(loadCurrent) && loadCurrent > 0) loadComponents.set(item.component.id, { item, loadCurrent, peakCurrent });
    }
    const totalMa = [...loadComponents.values()].reduce((total, item) => total + item.loadCurrent, 0);
    const peakMa = [...loadComponents.values()].reduce((total, item) => total + (Number.isFinite(item.peakCurrent) ? item.peakCurrent : item.loadCurrent), 0);
    const maxMa = Number(supplyDef.sim.maxCurrentMa);
    if (totalMa > maxMa) {
      issues.push(issue("error", "supply-current-budget", `${supply.name} typical load is ${totalMa} mA, above its ${maxMa} mA continuous budget.`, {
        componentId: supply.id,
        endpoints: [powerEndpoint],
        fix: "Use a higher-current external supply or test fewer actuators at once."
      }));
    }
    if (Number.isFinite(peakMa) && peakMa > maxMa) {
      issues.push(issue("error", "supply-peak-current-budget", `${supply.name} peak load is ${peakMa} mA, above its known ${maxMa} mA peak budget.`, {
        componentId: supply.id,
        endpoints: [powerEndpoint],
        fix: "Use a supply with a peak-current rating above the actuator demand."
      }));
    }
    const breadboard = linked.find((item) => item.componentDefinition.sim.role === "breadboard");
    if (breadboard && totalMa > Number(breadboard.componentDefinition.sim.maxRailCurrentMa ?? 1000)) {
      issues.push(issue("error", "breadboard-actuator-current", "Actuator current exceeds the breadboard rail hard limit.", {
        componentId: breadboard.component.id,
        endpoints: [breadboard.endpoint],
        fix: "For real hardware, use a proper power junction or distribution block for servo current."
      }));
    } else if (breadboard && totalMa > 800) {
      issues.push(issue("warning", "breadboard-current-recommendation", "Actuator current is routed through a breadboard rail above the conservative recommendation.", {
        componentId: breadboard.component.id,
        endpoints: [breadboard.endpoint],
        fix: "For real hardware, use a proper power junction or distribution block for actuator current."
      }));
    }
  }
}

function checkInductiveLoads(project, issues) {
  const normalized = normalizeProject(project);
  for (const component of normalized.components) {
    const definition = catalog.getComponent(component.typeId);
    if (!definition?.engineering?.protection?.inductiveLoad) continue;
    if (definition.engineering.protection.flyback !== "required") continue;
    const loadTerminals = definition.terminals.filter((terminal) => terminal.kind === TERMINAL_KINDS.LOAD);
    const linked = loadTerminals.flatMap((terminal) => findConnectedTerminals(normalized, componentEndpoint(component, terminal.id)));
    const hasDriver = linked.some((record) => record.componentDefinition.engineering?.protection?.flyback === "integrated");
    const hasControllerDirect = linked.some((record) => record.componentDefinition.sim.role === "controller");
    if (hasControllerDirect || !hasDriver) {
      issues.push(issue("error", "inductive-load-without-driver", `${component.name} needs a suitable driver and flyback path.`, {
        componentId: component.id,
        endpoints: loadTerminals.map((terminal) => componentEndpoint(component, terminal.id)),
        fix: "Drive motors, relays, and solenoids through a cataloged driver with integrated or external flyback protection."
      }));
    }
  }
}

function dedupeIssues(issues) {
  const byKey = new Map();
  for (const item of issues) {
    const key = `${item.code}:${item.componentId ?? ""}:${item.message}`;
    const existing = byKey.get(key);
    if (!existing || severityRank(item.severity) > severityRank(existing.severity)) byKey.set(key, item);
  }
  return [...byKey.values()].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta) return severityDelta;
    return left.code.localeCompare(right.code);
  });
}

function bringUpSteps(project, issues) {
  const normalized = normalizeProject(project);
  const servoCount = normalized.components.filter((component) => catalog.getComponent(component.typeId)?.sim.role === "servo").length;
  const hasBlocking = issues.some((item) => item.severity === "error");
  if (servoCount) {
    return [
      "Connect controller USB only; keep external actuator power OFF.",
      "Verify controller GND is tied to the external supply ground.",
      "Connect the first servo signal, +V, and ground only.",
      "Turn ON external actuator power and test one servo.",
      "Turn OFF actuator power before adding the next servo.",
      servoCount > 1 ? "Repeat the same staged order for each remaining servo." : "Add more actuators only after the first servo test passes."
    ];
  }
  return hasBlocking
    ? ["Fix blocking test errors before applying power.", "Rerun Circuit Test after each wiring change."]
    : ["Power the controller first.", "Apply external power only after common ground and polarity are verified.", "Run generated source only after the wiring test stays clear."];
}

export function runCircuitLabTest(project, options = {}) {
  const normalized = normalizeProject(project);
  const analysis = analyzeCircuit(normalized, { sessionState: options.sessionState ?? null });
  const issues = [];
  checkControllerSelection(normalized, issues);
  checkConnections(normalized, issues);
  checkOccupancy(normalized, issues);
  checkDirectGroups(normalized, issues, analysis);
  checkRequiredConnections(normalized, issues);
  checkVoltageCompatibility(normalized, issues, analysis);
  checkPolarity(normalized, issues, analysis);
  checkLogicLevels(normalized, issues, analysis);
  checkComponents(normalized, issues);
  checkCurrentBudgets(normalized, issues);
  checkInductiveLoads(normalized, issues);
  checkPotentialControlShorts(normalized, issues);
  const deduped = dedupeIssues(issues);
  const summary = summarize(deduped);
  const controller = projectController(normalized);
  const observations = [
    `${normalized.components.length} components on the bench`,
    `${normalized.connections.length} routed wires`,
    controller ? `Controller: ${controller.instance.name}` : "No primary controller selected",
    summary.errors ? "Blocking wiring errors present" : "No blocking wiring errors detected"
  ];
  return {
    ok: summary.errors === 0,
    summary,
    issues: deduped,
    observations,
    bringUpSteps: bringUpSteps(normalized, deduped),
    highlights: deduped.flatMap((item) => [
      ...item.targets.componentIds.map((componentId) => ({ type: "component", componentId, severity: item.severity })),
      ...item.endpoints.map((endpoint) => ({ type: "endpoint", endpoint, label: endpointLabel(normalized, endpoint), severity: item.severity })),
      ...item.connectionIds.map((connectionId) => ({ type: "connection", connectionId, severity: item.severity }))
    ])
  };
}
