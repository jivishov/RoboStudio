export function isPartsHandoffRequested(search = globalThis.location?.search ?? "") {
  return new URLSearchParams(search).get("fromParts") === "1";
}

export function generatedSnapshotParts(snapshot) {
  return (snapshot?.parts ?? []).filter(
    (part) => part?.source === "part-studio" || part?.type === "generated"
  );
}

export function isValidGeneratedAssemblySnapshot(snapshot) {
  return Boolean(snapshot?.glb && generatedSnapshotParts(snapshot).length);
}
