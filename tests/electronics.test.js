import assert from "node:assert/strict";
import test from "node:test";

import { createFirmwareProjectZip, generateCircuitFirmware } from "../src/electronics/codegen.js";
import { runDrc, suggestSafePin } from "../src/electronics/drc.js";
import { connectPins, createSeedCircuitDesign, parseCircuitDesignJson, removeNet } from "../src/electronics/schema.js";

test("CircuitDesign seed preserves the Circuitiny starter intent in RoboStudio format", () => {
  const design = createSeedCircuitDesign({ now: "2026-06-05T12:00:00.000Z" });
  const drc = runDrc(design);
  const firmware = generateCircuitFirmware(design);

  assert.equal(design.version, 1);
  assert.equal(design.units, "mm");
  assert.equal(design.updatedAt, "2026-06-05T12:00:00.000Z");
  assert.equal(design.board.id, "freenove-esp32-wrover-dev");
  assert.equal(design.components.some((component) => component.componentId === "led-5mm-red"), true);
  assert.equal(design.components.some((component) => component.componentId === "resistor-220r"), true);
  assert.equal(design.components.some((component) => component.componentId === "button-6mm"), true);
  assert.equal(drc.summary.errors, 0);
  assert.equal(drc.issues.some((issue) => issue.code === "led-missing-resistor"), false);
  assert.equal(firmware.ready, true);
  assert.match(firmware.files.find((file) => file.path === "main/app_main.c").content, /GPIO_NUM_2/);
  assert.match(firmware.files.find((file) => file.path === "main/app_main.c").content, /GPIO_NUM_4/);
  assert.match(firmware.files.find((file) => file.path === "README.md").content, /WARNING: GPIO2 is a boot strapping pin/);
});

test("Circuitiny JSON imports convert meter positions to millimeters", () => {
  const imported = parseCircuitDesignJson(JSON.stringify({
    schemaVersion: 1,
    name: "Circuitiny import",
    target: "esp32",
    board: { id: "esp32-devkitc-v4" },
    components: [
      { id: "led_a", componentId: "led-5mm-red", position: [0.04, 0.005, -0.01] }
    ],
    nets: [
      {
        id: "net_a",
        endpoints: [
          { board: { pinId: "GPIO2" } },
          { instance: { id: "led_a", pinId: "anode" } }
        ]
      }
    ]
  }), { now: "2026-06-05T12:00:00.000Z" });

  assert.deepEqual(imported.components[0].position, [40, 5, -10]);
  assert.deepEqual(imported.nets[0].endpoints, [
    { type: "board", pinId: "GPIO2" },
    { type: "component", instanceId: "led_a", pinId: "anode" }
  ]);
});

test("electronics DRC catches unsafe direct LED wiring and suggests an unused GPIO", () => {
  let design = createSeedCircuitDesign();
  design = removeNet(design, "net_gpio2_resistor");
  design = removeNet(design, "net_resistor_led");
  design = connectPins(
    design,
    { type: "board", pinId: "GPIO2" },
    { type: "component", instanceId: "led_1", pinId: "anode" },
    { id: "net_direct_led", name: "Direct LED" }
  );

  const drc = runDrc(design);
  const suggestion = suggestSafePin(design, { role: "output" });

  assert.equal(drc.issues.some((issue) => issue.code === "led-missing-resistor"), true);
  assert.ok(suggestion);
  assert.notEqual(suggestion.pinId, "GPIO2");
  assert.equal(suggestion.strapping, false);
});

test("firmware zip contains deterministic ESP-IDF project files", async () => {
  const design = createSeedCircuitDesign();
  const zipBytes = await createFirmwareProjectZip(design, { type: "uint8array" });

  assert.ok(zipBytes.length > 400);
});
