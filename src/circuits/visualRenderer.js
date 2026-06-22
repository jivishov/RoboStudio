import { getVisualDefinition } from "./visualCatalog.js";
import { provenanceById } from "./generated/visualProvenance.js";

export function componentVisualStatus(componentDef) {
  if (componentDef?.custom?.missing) {
    return {
      ok: false,
      assetKind: "missing-custom-component",
      message: "Custom component library entry is missing; placeholder rendered."
    };
  }
  if (componentDef?.view?.customSvg) {
    return {
      ok: true,
      assetKind: "local-sanitized-svg",
      message: "Local sanitized custom SVG visual."
    };
  }
  const visual = getVisualDefinition(componentDef?.id);
  if (!visual) {
    return {
      ok: false,
      assetKind: "procedural-fallback",
      message: "Missing visual definition; procedural fallback rendered."
    };
  }
  const provenance = provenanceById(visual.provenanceId);
  if (!provenance || provenance.approvalStatus !== "approved") {
    return {
      ok: false,
      assetKind: "procedural-fallback",
      message: "Visual provenance is not approved; procedural fallback rendered."
    };
  }
  return {
    ok: true,
    assetKind: visual.assetKind,
    message: `${visual.assetKind} visual approved.`
  };
}
