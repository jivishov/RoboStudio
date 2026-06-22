import { TERMINAL_KINDS, catalog } from "./catalog.js";
import { connectedGroups, findConnectedTerminals, projectController, resolveTerminal } from "./connectivity.js";
import { normalizeProject } from "./model.js";

function endpointKey(endpoint) {
  return `${endpoint.componentId}:${endpoint.terminalId}`;
}

function terminalRecord(project, component, definition, terminal) {
  return {
    endpoint: { componentId: component.id, terminalId: terminal.id },
    endpointKey: `${component.id}:${terminal.id}`,
    component,
    componentDefinition: definition,
    terminal,
    label: `${component.name}.${terminal.label ?? terminal.id}`
  };
}

function voltageDomain(definition, domainId) {
  return definition?.engineering?.voltageDomains?.find((domain) => domain.id === domainId) ?? null;
}

export function terminalVoltageRange(definition, terminal) {
  const domain = voltageDomain(definition, terminal?.voltageDomainId);
  if (domain) {
    return {
      minimumV: domain.minimumV ?? null,
      nominalV: domain.nominalV ?? terminal.voltage ?? null,
      maximumV: domain.maximumV ?? null,
      role: domain.role ?? null
    };
  }
  return {
    minimumV: terminal?.voltage ?? null,
    nominalV: terminal?.voltage ?? null,
    maximumV: terminal?.voltage ?? null,
    role: null
  };
}

export function terminalNominalVoltage(definition, terminal) {
  const range = terminalVoltageRange(definition, terminal);
  return range.nominalV != null && Number.isFinite(Number(range.nominalV)) ? Number(range.nominalV) : null;
}

export function terminalAcceptsVoltage(definition, terminal, sourceVoltage) {
  if (!Number.isFinite(Number(sourceVoltage))) return true;
  const range = terminalVoltageRange(definition, terminal);
  const minimum = range.minimumV != null ? Number(range.minimumV) : null;
  const maximum = range.maximumV != null ? Number(range.maximumV) : null;
  if (Number.isFinite(minimum) && sourceVoltage < minimum) return false;
  if (Number.isFinite(maximum) && sourceVoltage > maximum) return false;
  return true;
}

export function terminalIsPowerSource(definition, terminal) {
  return terminal?.electricalRole === "power-source"
    || (terminal?.kind === TERMINAL_KINDS.POWER && definition?.engineering?.voltageDomains?.some((domain) => domain.id === terminal.voltageDomainId && domain.role === "source"));
}

export function terminalIsPowerInput(definition, terminal) {
  return terminal?.electricalRole === "power-input"
    || (terminal?.kind === TERMINAL_KINDS.POWER && definition?.engineering?.voltageDomains?.some((domain) => domain.id === terminal.voltageDomainId && domain.role === "input"));
}

export function terminalIsSignalInput(terminal) {
  return terminal?.electricalRole === "signal-input" || terminal?.capabilities?.digitalInput === true || terminal?.capabilities?.includes?.("input");
}

export function terminalIsSignalOutput(terminal) {
  return terminal?.electricalRole === "signal-output" || terminal?.capabilities?.digitalOutput === true || terminal?.capabilities?.includes?.("output");
}

export function currentScenarioForComponent(component, definition) {
  const base = definition?.engineering?.currentMa ?? {};
  const overrides = component?.props?.engineeringOverrides ?? {};
  return {
    idle: Number.isFinite(Number(overrides.idleCurrentMa)) ? Number(overrides.idleCurrentMa) : base.idle ?? null,
    typical: Number.isFinite(Number(overrides.typicalCurrentMa)) ? Number(overrides.typicalCurrentMa) : base.typical ?? null,
    peak: Number.isFinite(Number(overrides.peakCurrentMa)) ? Number(overrides.peakCurrentMa) : base.peak ?? null,
    stall: Number.isFinite(Number(overrides.stallCurrentMa)) ? Number(overrides.stallCurrentMa) : base.stall ?? null
  };
}

export function voltageRangeForComponentInput(component, definition, terminal) {
  const range = terminalVoltageRange(definition, terminal);
  const overrides = component?.props?.engineeringOverrides ?? {};
  return {
    minimumV: Number.isFinite(Number(overrides.minimumVoltageV)) ? Number(overrides.minimumVoltageV) : range.minimumV,
    nominalV: Number.isFinite(Number(overrides.nominalVoltageV)) ? Number(overrides.nominalVoltageV) : range.nominalV,
    maximumV: Number.isFinite(Number(overrides.maximumVoltageV)) ? Number(overrides.maximumVoltageV) : range.maximumV
  };
}

function connectionIdsTouching(project, endpoint) {
  const key = endpointKey(endpoint);
  return project.connections
    .filter((connection) => connection.endpoints.some((item) => endpointKey(item) === key))
    .map((connection) => connection.id);
}

function directGroupRecords(project, options = {}) {
  return connectedGroups(project, { includePassive: false, sessionState: options.sessionState }).map((group) => ({
    ...group,
    sources: group.terminals.filter((record) => terminalIsPowerSource(record.componentDefinition, record.terminal)),
    powerInputs: group.terminals.filter((record) => terminalIsPowerInput(record.componentDefinition, record.terminal)),
    grounds: group.terminals.filter((record) => record.terminal.kind === TERMINAL_KINDS.GROUND || record.terminal.electricalRole === "ground"),
    signalInputs: group.terminals.filter((record) => record.terminal.kind === TERMINAL_KINDS.SIGNAL && terminalIsSignalInput(record.terminal)),
    signalOutputs: group.terminals.filter((record) => record.terminal.kind === TERMINAL_KINDS.SIGNAL && terminalIsSignalOutput(record.terminal))
  }));
}

export function analyzeCircuit(project, options = {}) {
  const normalized = normalizeProject(project);
  const terminalRecords = [];
  const terminalByKey = new Map();
  for (const component of normalized.components) {
    const definition = catalog.getComponent(component.typeId);
    for (const terminal of definition?.terminals ?? []) {
      const record = terminalRecord(normalized, component, definition, terminal);
      terminalRecords.push(record);
      terminalByKey.set(record.endpointKey, record);
    }
  }

  const directGroups = directGroupRecords(normalized, options);
  const passiveGroups = connectedGroups(normalized, { includePassive: true, sessionState: options.sessionState });
  const sourceTerminals = terminalRecords.filter((record) => terminalIsPowerSource(record.componentDefinition, record.terminal));
  const loadInputTerminals = terminalRecords.filter((record) => terminalIsPowerInput(record.componentDefinition, record.terminal) || terminalIsSignalInput(record.terminal));
  const currentScenarios = normalized.components.map((component) => {
    const definition = catalog.getComponent(component.typeId);
    return {
      componentId: component.id,
      role: definition?.engineering?.robotics?.role ?? definition?.sim?.role ?? "unknown",
      ...currentScenarioForComponent(component, definition)
    };
  });

  const controller = projectController(normalized);
  const controllerTerminalAssignments = [];
  if (controller) {
    for (const terminal of controller.definition.terminals ?? []) {
      const endpoint = { componentId: controller.instance.id, terminalId: terminal.id };
      const linked = findConnectedTerminals(normalized, endpoint);
      if (linked.length > 1) {
        controllerTerminalAssignments.push({
          controllerId: controller.instance.id,
          terminalId: terminal.id,
          endpoint,
          connectedEndpoints: linked.map((record) => record.endpoint).filter((item) => endpointKey(item) !== endpointKey(endpoint))
        });
      }
    }
  }

  const connectorTransitions = normalized.connections.map((connection) => {
    const endpoints = connection.endpoints.map((endpoint) => resolveTerminal(normalized, endpoint)).filter((resolved) => resolved.ok);
    return {
      connectionId: connection.id,
      endpointCount: endpoints.length,
      connectorFamilies: [...new Set(endpoints.map((record) => {
        const connector = record.componentDefinition.engineering.connectors.find((item) => item.id === record.terminal.connectorId);
        return connector?.family ?? "unknown";
      }))]
    };
  });

  return {
    project: normalized,
    terminalRecords,
    terminalByKey,
    directGroups,
    passiveGroups,
    sourceTerminals,
    loadInputTerminals,
    currentScenarios,
    controllerTerminalAssignments,
    connectorTransitions,
    connectionIdsTouching: (endpoint) => connectionIdsTouching(normalized, endpoint)
  };
}
