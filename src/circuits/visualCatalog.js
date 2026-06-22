import { getPhysicalDefinition } from "./physicalCatalog.js";
import { photorealAssetIds } from "./generated/photorealAssets.js";

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function terminalVisuals(componentTypeId, mappings = {}) {
  const physical = getPhysicalDefinition(componentTypeId);
  const result = {};
  for (const terminalId of Object.keys(physical?.terminals ?? {})) {
    result[terminalId] = {
      sourceConnectorRef: mappings[terminalId] ?? terminalId,
      socketLayerId: `${componentTypeId}__terminal__${terminalId}`,
      emphasisShape: physical.terminals[terminalId].connectorInterface.includes("breadboard") ? "hole" : "socket"
    };
  }
  return result;
}

function visual(id, definition) {
  return freezeDeep({
    id,
    version: 1,
    componentTypeId: definition.componentTypeId ?? id,
    physicalDefinitionId: definition.physicalDefinitionId ?? definition.componentTypeId ?? id,
    assetKind: definition.assetKind ?? "procedural-fallback",
    assetId: definition.assetId ?? null,
    symbolId: definition.symbolId ?? `${id}-symbol`,
    assetModule: definition.assetModule ?? null,
    viewBox: definition.viewBox ?? null,
    preserveAspectRatio: "xMidYMid meet",
    terminalVisuals: definition.terminalVisuals ?? terminalVisuals(definition.componentTypeId ?? id, definition.sourceConnectorRefs ?? {}),
    controlVisuals: definition.controlVisuals ?? {},
    layers: definition.layers ?? ["body", "terminals", "labels"],
    fallbackVisualId: definition.fallbackVisualId ?? `${id}-procedural`,
    provenanceId: definition.provenanceId ?? `${id}-robostudio-original`
  });
}

const photorealControlVisuals = Object.freeze({
  "servo-standard": {
    previewAngleDeg: {
      stateLayers: ["servo-horn"],
      transformSpec: "rotate-about-horn-center",
      pressedLayerId: null
    }
  },
  "servo-micro-9g": {
    previewAngleDeg: {
      stateLayers: ["servo-horn"],
      transformSpec: "rotate-about-horn-center",
      pressedLayerId: null
    }
  },
  "supply-servo-6v": {
    power: {
      stateLayers: ["power-switch", "power-indicator"],
      transformSpec: "translate-y-power",
      pressedLayerId: null
    }
  },
  "button-tactile": {
    press: {
      stateLayers: ["button-cap-up", "button-cap-down"],
      transformSpec: "translate-y-pressed",
      pressedLayerId: "button-cap-down"
    }
  },
  "potentiometer-10k": {
    wiper: {
      stateLayers: ["knob-indicator"],
      transformSpec: "rotate-270deg-range",
      pressedLayerId: null
    }
  },
  "input-joystick-module": {
    wiper: {
      stateLayers: ["joystick-knob"],
      transformSpec: "static",
      pressedLayerId: null
    }
  },
  "switch-spdt-slide": {
    throw: {
      stateLayers: ["throw-a", "throw-b"],
      transformSpec: "translate-x-throw",
      pressedLayerId: null
    }
  },
  "switch-limit-micro": {
    throw: {
      stateLayers: ["throw-a", "throw-b"],
      transformSpec: "translate-x-throw",
      pressedLayerId: null
    }
  }
});

function photorealVisual(componentTypeId) {
  return visual(componentTypeId, {
    assetKind: "photorealistic-svg-wrapper",
    assetId: componentTypeId,
    provenanceId: "robostudio-photorealistic-component-wrappers",
    layers: ["photorealistic-body", "state-overlays", "terminals", "labels"],
    controlVisuals: photorealControlVisuals[componentTypeId] ?? {}
  });
}

export const visualCatalog = freezeDeep({
  ...Object.fromEntries(photorealAssetIds.map((componentTypeId) => [componentTypeId, photorealVisual(componentTypeId)])),
  "breadboard-400": visual("breadboard-400", {
    assetKind: "procedural-fallback",
    provenanceId: "robostudio-legacy-breadboard-procedural",
    layers: ["body", "legacy-holes", "legacy-legends"]
  })
});

export function getVisualDefinition(componentTypeId) {
  return visualCatalog[componentTypeId] ?? null;
}

export function listVisualDefinitions() {
  return Object.values(visualCatalog);
}
