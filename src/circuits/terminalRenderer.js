export function terminalRadius(componentDef) {
  if (componentDef?.sim?.role === "breadboard") return 1.35;
  return 3.1;
}

export function terminalAriaLabel(component, terminal) {
  const parts = [
    component?.name ?? component?.id ?? "Component",
    terminal?.physicalLabel ?? terminal?.label ?? terminal?.id ?? "terminal",
    terminal?.id ? `terminal ${terminal.id}` : "",
    terminal?.connectorInterface ? `connector ${terminal.connectorInterface}` : "",
    terminal?.electricalRole ? `role ${terminal.electricalRole}` : ""
  ].filter(Boolean);
  return parts.join(", ");
}

export function terminalTooltip(component, terminal, occupancyRecord = null) {
  const occupancy = occupancyRecord ? `${occupancyRecord.length} attachment(s)` : "empty";
  return [
    `${component?.name ?? component?.id} ${terminal?.physicalLabel ?? terminal?.label ?? terminal?.id}`,
    `ID: ${terminal?.id}`,
    `Connector: ${terminal?.connectorInterface ?? "unknown"}`,
    `Role: ${terminal?.electricalRole ?? terminal?.kind ?? "unknown"}`,
    `Occupancy: ${occupancy}`
  ].join("\n");
}
