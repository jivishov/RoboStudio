export const VISUAL_PROVENANCE_VERSION = 1;

function record(entry) {
  return Object.freeze({
    version: VISUAL_PROVENANCE_VERSION,
    sourceAuthor: "",
    sourcePath: "",
    sourceRevision: "",
    licenseSpdx: "",
    noticePath: "",
    attributionText: "",
    modified: false,
    modifications: [],
    shareAlike: false,
    approvalStatus: "draft",
    generatedAssetPaths: [],
    ...entry
  });
}

const wokwiBase = {
  sourceProject: "wokwi/wokwi-elements",
  sourceRevision: "3c8178e",
  sourceAuthor: "Uri Shaked and contributors",
  licenseSpdx: "MIT",
  noticePath: "LICENSES/wokwi-elements-MIT.txt",
  shareAlike: false,
  approvalStatus: "approved",
  modified: false,
  modifications: ["Pinned source approved for future static extraction", "No production visual generated in the current catalog"],
  generatedAssetPaths: []
};

export const visualProvenanceRecords = Object.freeze([
  record({
    id: "wokwi-elements-arduino-uno-r3",
    ...wokwiBase,
    sourceAssetName: "Arduino Uno R3 element",
    sourcePath: "src/elements/wokwi-arduino-uno.ts",
    attributionText: "Arduino Uno visual source reference pinned to Wokwi Elements v1.9.2 under the MIT license."
  }),
  record({
    id: "wokwi-elements-esp32-devkit-v1",
    ...wokwiBase,
    sourceAssetName: "ESP32 DevKit V1 element",
    sourcePath: "src/elements/wokwi-esp32-devkit-v1.ts",
    attributionText: "ESP32 DevKit V1 visual source reference pinned to Wokwi Elements v1.9.2 under the MIT license."
  }),
  record({
    id: "wokwi-elements-led-red",
    ...wokwiBase,
    sourceAssetName: "LED element",
    sourcePath: "src/elements/wokwi-led.ts",
    attributionText: "LED visual source reference pinned to Wokwi Elements v1.9.2 under the MIT license."
  }),
  record({
    id: "wokwi-elements-resistor",
    ...wokwiBase,
    sourceAssetName: "Resistor element",
    sourcePath: "src/elements/wokwi-resistor.ts",
    attributionText: "Resistor visual source reference pinned to Wokwi Elements v1.9.2 under the MIT license."
  }),
  record({
    id: "wokwi-elements-pushbutton",
    ...wokwiBase,
    sourceAssetName: "Pushbutton element",
    sourcePath: "src/elements/wokwi-pushbutton.ts",
    attributionText: "Pushbutton visual source reference pinned to Wokwi Elements v1.9.2 under the MIT license."
  }),
  record({
    id: "wokwi-elements-hc-sr04",
    ...wokwiBase,
    sourceAssetName: "HC-SR04 ultrasonic element",
    sourcePath: "src/elements/wokwi-hc-sr04.ts",
    attributionText: "HC-SR04 visual source reference pinned to Wokwi Elements v1.9.2 under the MIT license."
  }),
  record({
    id: "wokwi-elements-slide-switch",
    ...wokwiBase,
    sourceAssetName: "Slide switch element",
    sourcePath: "src/elements/wokwi-slide-switch.ts",
    attributionText: "Slide switch visual source reference pinned to Wokwi Elements v1.9.2 under the MIT license."
  }),
  record({
    id: "robostudio-bb400-native-svg",
    sourceProject: "RoboStudio",
    sourceAssetName: "BB400-compatible 400-point breadboard vector",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio vector based on factual BB400 dimensions: 84 x 54.3 mm, 400 holes, 2.54 mm pitch.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/physicalCatalog.js", "src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-circuit-procedural-visuals",
    sourceProject: "RoboStudio",
    sourceAssetName: "Circuit Lab procedural component visuals",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio procedural visuals for controllers, LEDs, resistors, buttons, sensors, and switches while third-party SVG extraction remains review-gated.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits.js", "src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-standard-servo-original",
    sourceProject: "RoboStudio",
    sourceAssetName: "Standard hobby servo visual",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio educational servo visual with vector plug and horn overlays.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-6v-supply-original",
    sourceProject: "RoboStudio",
    sourceAssetName: "Switched 6 V educational supply visual",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio educational fixed 6 V supply visual.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-electrolytic-capacitor-original",
    sourceProject: "RoboStudio",
    sourceAssetName: "470 uF radial electrolytic visual",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio radial electrolytic visual with vector polarity overlays.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-130-dc-motor-original",
    sourceProject: "RoboStudio",
    sourceAssetName: "130-size brushed DC motor visual",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio 130-size DC motor visual with solder-tab anchors.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-potentiometer-native-svg",
    sourceProject: "RoboStudio",
    sourceAssetName: "10 kOhm panel potentiometer vector",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio potentiometer visual.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-l298n-simplified-procedural",
    sourceProject: "RoboStudio",
    sourceAssetName: "Simplified one-channel L298N abstraction",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio procedural fallback for the simplified six-terminal driver abstraction.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/visualCatalog.js"]
  }),
  record({
    id: "robostudio-photorealistic-component-wrappers",
    sourceProject: "RoboStudio",
    sourceAssetName: "Photorealistic Circuit Lab component wrappers",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio top-down educational bitmap renders extracted from a generated source sheet, converted into transparent PNG assets, and wrapped in SVG files sized from physical component dimensions and hand-authored terminal maps.",
    approvalStatus: "approved",
    generatedAssetPaths: [
      "scripts/circuits/photoreal-manifest.json",
      "scripts/circuits/extract-photoreal-raster-sources.py",
      "src/circuits/assets/photoreal/source/robostudio-photoreal-sheet.png",
      "src/circuits/assets/photoreal/raster/",
      "src/circuits/assets/photoreal/",
      "src/circuits/generated/photorealAssets.js",
      "src/circuits/visualCatalog.js"
    ]
  }),
  record({
    id: "robostudio-legacy-breadboard-procedural",
    sourceProject: "RoboStudio",
    sourceAssetName: "Legacy 420-terminal breadboard procedural fallback",
    sourceAuthor: "RoboStudio",
    licenseSpdx: "Project",
    noticePath: "public/assets/circuits/ATTRIBUTION.md",
    attributionText: "Original RoboStudio legacy compatibility breadboard visual.",
    approvalStatus: "approved",
    generatedAssetPaths: ["src/circuits/visualCatalog.js"]
  }),
  record({
    id: "fritzing-production-graphics",
    sourceProject: "Fritzing parts",
    sourceAssetName: "Fritzing breadboard-view graphics",
    sourceAuthor: "Fritzing contributors",
    licenseSpdx: "CC-BY-SA-3.0",
    noticePath: "",
    attributionText: "Blocked pending explicit repository-license compatibility and share-alike review.",
    modified: false,
    shareAlike: true,
    approvalStatus: "blocked",
    generatedAssetPaths: []
  })
]);

export function provenanceById(id) {
  return visualProvenanceRecords.find((item) => item.id === id) ?? null;
}
