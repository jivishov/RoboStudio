import {
  GEOMETRY_ACCURACY_CLASSES,
  GEOMETRY_SOURCE_KINDS,
  getGeometryEvidence
} from "./geometryEvidence.js";
import { registeredRasterFrame } from "./assetRegistrations.js";

const ANCHOR_KINDS = new Set(["on-body", "external-lead", "external-port"]);
const ACCURACY_CLASSES = new Set(Object.values(GEOMETRY_ACCURACY_CLASSES));
const SOURCE_KINDS = new Set(Object.values(GEOMETRY_SOURCE_KINDS));
const RIGHT_ANGLE_ORIENTATIONS = new Set([0, 90, 180, 270]);

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function finiteVector(value, length = 2) {
  return Array.isArray(value) && value.length === length && value.every(finiteNumber);
}

function validBounds(value) {
  return value
    && finiteNumber(value.x)
    && finiteNumber(value.y)
    && finiteNumber(value.width)
    && finiteNumber(value.height)
    && Number(value.width) > 0
    && Number(value.height) > 0;
}

function pointInBounds(point, bounds, tolerance = 0.001) {
  if (!finiteVector(point) || !validBounds(bounds)) return false;
  return Number(point[0]) >= Number(bounds.x) - tolerance
    && Number(point[0]) <= Number(bounds.x) + Number(bounds.width) + tolerance
    && Number(point[1]) >= Number(bounds.y) - tolerance
    && Number(point[1]) <= Number(bounds.y) + Number(bounds.height) + tolerance;
}

function vectorLength(vector) {
  return Math.hypot(Number(vector?.[0]), Number(vector?.[1]));
}

function dot(left, right) {
  return Number(left?.[0]) * Number(right?.[0]) + Number(left?.[1]) * Number(right?.[1]);
}

function orderIsSubsequence(candidateIds, authoritativeIds) {
  let cursor = 0;
  for (const terminalId of authoritativeIds) {
    if (candidateIds[cursor] === terminalId) cursor += 1;
  }
  return cursor === candidateIds.length;
}

function rotatePoint(point, orientationDeg, center) {
  const radians = Number(orientationDeg) * Math.PI / 180;
  const x = Number(point[0]) - Number(center[0]);
  const y = Number(point[1]) - Number(center[1]);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    Number(center[0]) + x * cos - y * sin,
    Number(center[1]) + x * sin + y * cos
  ];
}

export function validateGeometryEvidenceRecord(evidence) {
  const errors = [];
  if (!evidence?.id) return ["Geometry evidence record is missing id."];
  if (!ACCURACY_CLASSES.has(evidence.accuracyClass)) {
    errors.push(`${evidence.id} has invalid accuracyClass ${evidence.accuracyClass}.`);
  }
  if (!SOURCE_KINDS.has(evidence.sourceKind)) {
    errors.push(`${evidence.id} has invalid sourceKind ${evidence.sourceKind}.`);
  }
  if (!evidence.provenanceId) errors.push(`${evidence.id} is missing provenanceId.`);
  if (!evidence.sourceRevision) errors.push(`${evidence.id} is missing sourceRevision.`);
  if (!finiteNumber(evidence.registrationToleranceMm) || Number(evidence.registrationToleranceMm) <= 0) {
    errors.push(`${evidence.id} registrationToleranceMm must be positive.`);
  }
  return errors;
}

export function validatePhysicalDefinition(physical, componentDefinition = null) {
  const errors = [];
  if (!physical?.id) return ["Physical definition is missing id."];
  if (!finiteVector(physical.physicalSizeMm) || physical.physicalSizeMm.some((value) => Number(value) <= 0)) {
    errors.push(`${physical.id} physicalSizeMm must contain two positive finite values.`);
  }
  for (const [label, bounds] of [
    ["bodyBoundsMm", physical.bodyBoundsMm],
    ["visualBoundsMm", physical.visualBoundsMm],
    ["clampBoundsMm", physical.clampBoundsMm]
  ]) {
    if (!validBounds(bounds)) errors.push(`${physical.id}.${label} must be finite positive bounds.`);
  }

  const evidence = getGeometryEvidence(physical.geometryEvidenceId);
  if (!evidence) {
    errors.push(`${physical.id} references missing geometry evidence ${physical.geometryEvidenceId}.`);
  } else {
    errors.push(...validateGeometryEvidenceRecord(evidence));
    if (evidence.componentTypeId !== physical.id) {
      errors.push(`${physical.id} geometry evidence belongs to ${evidence.componentTypeId}.`);
    }
  }

  const terminalIds = Object.keys(physical.terminals ?? {});
  if (!terminalIds.length) errors.push(`${physical.id} has no physical terminals.`);
  const seenCoordinates = new Map();
  for (const terminalId of terminalIds) {
    const terminal = physical.terminals[terminalId];
    if (!finiteVector(terminal.positionMm)) {
      errors.push(`${physical.id}.${terminalId} missing finite positionMm.`);
      continue;
    }
    const coordinateKey = terminal.positionMm.map((value) => Number(value).toFixed(4)).join(",");
    const existing = seenCoordinates.get(coordinateKey);
    if (existing) errors.push(`${physical.id} duplicates physical anchor ${coordinateKey} for ${existing} and ${terminalId}.`);
    seenCoordinates.set(coordinateKey, terminalId);
    if (!validBounds(terminal.visibleBoundsMm)) errors.push(`${physical.id}.${terminalId} has invalid visibleBoundsMm.`);
    if (!terminal.connectorInterface) errors.push(`${physical.id}.${terminalId} missing connectorInterface.`);
    if (!ANCHOR_KINDS.has(terminal.anchorKind)) errors.push(`${physical.id}.${terminalId} has invalid anchorKind ${terminal.anchorKind}.`);
    if (!finiteNumber(terminal.attachmentCapacity) || Number(terminal.attachmentCapacity) < 1) {
      errors.push(`${physical.id}.${terminalId} must define attachmentCapacity >= 1.`);
    }
    const outsideBody = validBounds(physical.bodyBoundsMm) && !pointInBounds(terminal.positionMm, physical.bodyBoundsMm);
    const outsideVisual = validBounds(physical.visualBoundsMm) && !pointInBounds(terminal.positionMm, physical.visualBoundsMm);
    if ((outsideBody || outsideVisual) && !["external-lead", "external-port"].includes(terminal.anchorKind)) {
      errors.push(`${physical.id}.${terminalId} lies outside ${outsideBody && outsideVisual ? "body and visual" : outsideBody ? "body" : "visual"} bounds without external anchor tagging.`);
    }
  }

  const connectorById = new Map((componentDefinition?.engineering?.connectors ?? []).map((connector) => [connector.id, connector]));
  const portIds = new Set();
  const portMembership = new Map();
  for (const port of physical.physicalPorts ?? []) {
    if (!port?.id || portIds.has(port.id)) errors.push(`${physical.id} has a missing or duplicate physical port id ${port?.id}.`);
    portIds.add(port?.id);
    if (!port.engineeringConnectorId) errors.push(`${physical.id}.${port.id} missing engineeringConnectorId.`);
    const engineeringConnector = connectorById.get(port.engineeringConnectorId);
    if (componentDefinition && !engineeringConnector) {
      errors.push(`${physical.id}.${port.id} references missing engineering connector ${port.engineeringConnectorId}.`);
    }
    if (!Array.isArray(port.terminalIds) || port.terminalIds.length < 2) {
      errors.push(`${physical.id}.${port.id} must contain at least two ordered terminal IDs.`);
      continue;
    }
    const localTerminalIds = new Set();
    for (const terminalId of port.terminalIds) {
      if (!physical.terminals?.[terminalId]) errors.push(`${physical.id}.${port.id} references missing terminal ${terminalId}.`);
      if (localTerminalIds.has(terminalId)) errors.push(`${physical.id}.${port.id} duplicates terminal ${terminalId}.`);
      localTerminalIds.add(terminalId);
      const priorPort = portMembership.get(terminalId);
      if (priorPort) errors.push(`${physical.id}.${terminalId} belongs to both ${priorPort} and ${port.id}.`);
      portMembership.set(terminalId, port.id);
    }
    if (engineeringConnector && !orderIsSubsequence(port.terminalIds, engineeringConnector.terminalIds ?? [])) {
      errors.push(`${physical.id}.${port.id} contact order disagrees with engineering connector ${port.engineeringConnectorId}.`);
    }
    if (!validBounds(port.housingBoundsMm)) errors.push(`${physical.id}.${port.id} has invalid housingBoundsMm.`);
    if (validBounds(port.housingBoundsMm) && validBounds(physical.visualBoundsMm)) {
      const portCorners = [
        [port.housingBoundsMm.x, port.housingBoundsMm.y],
        [port.housingBoundsMm.x + port.housingBoundsMm.width, port.housingBoundsMm.y + port.housingBoundsMm.height]
      ];
      if (!portCorners.every((point) => pointInBounds(point, physical.visualBoundsMm))) {
        errors.push(`${physical.id}.${port.id} housing lies outside visualBoundsMm.`);
      }
    }
    for (const terminalId of port.terminalIds) {
      const point = physical.terminals?.[terminalId]?.positionMm;
      if (point && validBounds(port.housingBoundsMm) && !pointInBounds(point, port.housingBoundsMm)) {
        errors.push(`${physical.id}.${port.id} housing does not contain terminal ${terminalId}.`);
      }
    }
    if (!finiteNumber(port.contactPitchMm) || Number(port.contactPitchMm) <= 0) {
      errors.push(`${physical.id}.${port.id} contactPitchMm must be positive.`);
    }
    if (!finiteVector(port.contactAxisLocal) || Math.abs(vectorLength(port.contactAxisLocal) - 1) > 0.001) {
      errors.push(`${physical.id}.${port.id} contactAxisLocal must be a unit vector.`);
    }
    if (!finiteVector(port.outwardNormalLocal) || Math.abs(vectorLength(port.outwardNormalLocal) - 1) > 0.001) {
      errors.push(`${physical.id}.${port.id} outwardNormalLocal must be a unit vector.`);
    }
    if (finiteVector(port.contactAxisLocal) && finiteVector(port.outwardNormalLocal) && Math.abs(dot(port.contactAxisLocal, port.outwardNormalLocal)) > 0.001) {
      errors.push(`${physical.id}.${port.id} contact axis and outward normal must be perpendicular.`);
    }
    if (typeof port.keyed !== "boolean") errors.push(`${physical.id}.${port.id} keyed must be boolean.`);
    if (port.geometryEvidenceId !== physical.geometryEvidenceId) {
      errors.push(`${physical.id}.${port.id} must use the component geometry evidence record.`);
    }
    if (finiteNumber(port.contactPitchMm) && finiteVector(port.contactAxisLocal)) {
      for (let index = 1; index < port.terminalIds.length; index += 1) {
        const previous = physical.terminals?.[port.terminalIds[index - 1]]?.positionMm;
        const current = physical.terminals?.[port.terminalIds[index]]?.positionMm;
        if (!previous || !current) continue;
        const delta = [Number(current[0]) - Number(previous[0]), Number(current[1]) - Number(previous[1])];
        const alongAxis = dot(delta, port.contactAxisLocal);
        const perpendicular = Math.abs(delta[0] * Number(port.contactAxisLocal[1]) - delta[1] * Number(port.contactAxisLocal[0]));
        if (Math.abs(Math.abs(alongAxis) - Number(port.contactPitchMm)) > 0.01 || perpendicular > 0.01) {
          errors.push(`${physical.id}.${port.id} contact ${port.terminalIds[index - 1]} -> ${port.terminalIds[index]} does not match declared pitch/axis.`);
        }
      }
    }
  }

  const formedLeadGeometry = physical.formedLeadGeometry;
  if (formedLeadGeometry) {
    if (formedLeadGeometry.version !== 1) errors.push(`${physical.id} formedLeadGeometry must use version 1.`);
    const leadTerminalIds = Object.keys(formedLeadGeometry.leadPathsMm ?? {});
    if (!leadTerminalIds.length) errors.push(`${physical.id} formedLeadGeometry must define leadPathsMm.`);
    for (const terminalId of leadTerminalIds) {
      const terminal = physical.terminals?.[terminalId];
      const path = formedLeadGeometry.leadPathsMm[terminalId];
      if (!terminal) errors.push(`${physical.id} formed lead references missing terminal ${terminalId}.`);
      if (!Array.isArray(path) || path.length < 2 || !path.every((point) => finiteVector(point))) {
        errors.push(`${physical.id}.${terminalId} formed lead path must contain at least two finite points.`);
      } else if (terminal) {
        const endpoint = path[path.length - 1];
        if (Math.hypot(endpoint[0] - terminal.positionMm[0], endpoint[1] - terminal.positionMm[1]) > 0.001) {
          errors.push(`${physical.id}.${terminalId} formed lead path must end at the terminal anchor.`);
        }
      }
    }
  }

  return errors;
}

export function validateAssetRegistration(registration, physical, evidence, rasterInfo = null) {
  const errors = [];
  if (!registration?.id) return ["Asset registration is missing id."];
  if (registration.version !== 1) errors.push(`${registration.id} must use version 1.`);
  if (registration.assetId !== physical?.id) errors.push(`${registration.id} assetId does not match ${physical?.id}.`);
  if (registration.geometryEvidenceId !== physical?.geometryEvidenceId) {
    errors.push(`${registration.id} geometryEvidenceId does not match the physical definition.`);
  }
  const crop = registration.rasterCrop;
  if (crop?.units !== "normalized") errors.push(`${registration.id} rasterCrop.units must be normalized.`);
  if (![crop?.x, crop?.y, crop?.width, crop?.height].every(finiteNumber)
      || Number(crop.width) <= 0 || Number(crop.height) <= 0
      || Number(crop.x) < 0 || Number(crop.y) < 0
      || Number(crop.x) + Number(crop.width) > 1
      || Number(crop.y) + Number(crop.height) > 1) {
    errors.push(`${registration.id} rasterCrop must stay inside normalized raster bounds.`);
  }
  if (!finiteNumber(registration.uniformScale) || Number(registration.uniformScale) <= 0) {
    errors.push(`${registration.id} uniformScale must be positive.`);
  }
  if (!finiteVector(registration.translationMm)) errors.push(`${registration.id} translationMm must be a finite 2D vector.`);
  if (!RIGHT_ANGLE_ORIENTATIONS.has(Number(registration.orientationDeg))) {
    errors.push(`${registration.id} orientationDeg must be 0, 90, 180, or 270.`);
  }
  for (const landmark of registration.reviewLandmarks ?? []) {
    if (!physical?.terminals?.[landmark.terminalId]) {
      errors.push(`${registration.id} review landmark references missing terminal ${landmark.terminalId}.`);
    }
    if (landmark.artworkPointNormalized && (!finiteVector(landmark.artworkPointNormalized)
      || landmark.artworkPointNormalized.some((value) => Number(value) < 0 || Number(value) > 1))) {
      errors.push(`${registration.id}.${landmark.terminalId} artworkPointNormalized must stay inside the raster.`);
    }
  }

  if (rasterInfo && evidence && physical && !errors.length) {
    const frame = registeredRasterFrame(
      registration,
      rasterInfo.width,
      rasterInfo.height,
      physical.physicalSizeMm[0],
      physical.physicalSizeMm[1]
    );
    const resolutionSupportsResiduals = frame.mmPerPixel <= Number(evidence.registrationToleranceMm) / 2;
    const measuredLandmarks = (registration.reviewLandmarks ?? []).filter((landmark) => finiteVector(landmark.artworkPointNormalized));
    if (resolutionSupportsResiduals && measuredLandmarks.length) {
      const center = [physical.physicalSizeMm[0] / 2, physical.physicalSizeMm[1] / 2];
      for (const landmark of measuredLandmarks) {
        const rasterPoint = [
          frame.x + Number(landmark.artworkPointNormalized[0]) * frame.width,
          frame.y + Number(landmark.artworkPointNormalized[1]) * frame.height
        ];
        const rotated = rotatePoint(rasterPoint, frame.orientationDeg, center);
        const localPoint = [rotated[0] - center[0], rotated[1] - center[1]];
        const terminalPoint = physical.terminals[landmark.terminalId].positionMm;
        const residual = Math.hypot(localPoint[0] - terminalPoint[0], localPoint[1] - terminalPoint[1]);
        if (residual > Number(evidence.registrationToleranceMm)) {
          errors.push(`${registration.id}.${landmark.terminalId} registration residual ${residual.toFixed(3)} mm exceeds ${evidence.registrationToleranceMm} mm.`);
        }
      }
    }
  }
  return errors;
}
