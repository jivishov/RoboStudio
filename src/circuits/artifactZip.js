import JSZip from "jszip";
import { buildCircuitArtifacts } from "./artifacts.js";

export async function createCircuitBuildGuideZip(input = {}, options = {}) {
  const artifacts = input.files ? input : buildCircuitArtifacts(input);
  const zip = new JSZip();
  for (const [path, content] of Object.entries(artifacts.files ?? {})) {
    zip.file(path, content);
  }
  zip.file(
    "README.txt",
    [
      "RoboStudio Circuit Lab build guide",
      "",
      "This archive contains source-state JSON plus derived pin map, BOM, harness, and checklist artifacts.",
      "It is not a .robostudio project package and should not be imported as one.",
      "RoboStudio did not compile, flash, execute, inspect, or hardware-test this circuit."
    ].join("\n")
  );
  return zip.generateAsync({
    type: options.type ?? "blob",
    compression: "DEFLATE"
  });
}
