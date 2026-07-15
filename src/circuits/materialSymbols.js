export const MATERIAL_SYMBOLS_FALLBACK_CLASS = "circuit-material-symbols-fallback";

function measuredTextWidth(documentRef, fontFamily) {
  const sample = documentRef.createElement("span");
  sample.textContent = "smart_toy";
  sample.setAttribute("aria-hidden", "true");
  sample.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:-10000px",
    "visibility:hidden",
    "white-space:nowrap",
    "font-size:20px",
    "font-weight:500",
    `font-family:${fontFamily}`
  ].join(";");
  documentRef.body.append(sample);
  const width = sample.getBoundingClientRect().width;
  sample.remove();
  return width;
}

export function materialSymbolsFontLoaded(documentRef = globalThis.document) {
  if (!documentRef?.body) return false;
  const fallbackWidth = measuredTextWidth(documentRef, "monospace");
  const candidateWidth = measuredTextWidth(documentRef, '"Material Symbols Rounded", monospace');
  return Math.abs(candidateWidth - fallbackWidth) > 0.5;
}

export function installMaterialSymbolsFallback(documentRef = globalThis.document) {
  if (!documentRef?.documentElement) return () => {};
  const root = documentRef.documentElement;
  const refresh = () => root.classList.toggle(
    MATERIAL_SYMBOLS_FALLBACK_CLASS,
    !materialSymbolsFontLoaded(documentRef)
  );

  refresh();
  const fontSet = documentRef.fonts;
  const timeoutId = globalThis.setTimeout(refresh, 3000);
  Promise.resolve(fontSet?.ready).then(() => {
    globalThis.clearTimeout(timeoutId);
    refresh();
  });
  fontSet?.addEventListener?.("loadingdone", refresh);
  fontSet?.addEventListener?.("loadingerror", refresh);

  return () => {
    globalThis.clearTimeout(timeoutId);
    fontSet?.removeEventListener?.("loadingdone", refresh);
    fontSet?.removeEventListener?.("loadingerror", refresh);
  };
}
