import { expect, test } from "@playwright/test";

test("calibration tool loads catalog geometry, evidence, immutable contacts, and constrained rotations", async ({ page }) => {
  await page.goto("/tools/circuit-visual-calibration/");
  await expect(page).toHaveTitle("Circuit Visual Calibration");
  await expect(page.locator("#component-id option")).toHaveCount(36);
  await expect(page.locator("#component-summary")).toContainText("exact-model-verified");
  await expect(page.locator("#preview")).toHaveAttribute("data-inspection-zoom", "8");
  await expect(page.locator("#preview [data-terminal-id]")).toHaveCount(32);
  await expect(page.locator("#preview [data-port-id]")).toHaveCount(4);

  await page.locator("#component-rotation").selectOption("90");
  await expect(page.locator("#preview")).toHaveAttribute("data-component-rotation", "90");
  await page.locator("#component-rotation").selectOption("270");
  await expect(page.locator("#preview")).toHaveAttribute("data-component-rotation", "270");

  await page.locator("#component-id").selectOption("driver-pca9685-servo");
  await expect(page.locator("#preview [data-terminal-id]")).toHaveCount(54);
  await expect(page.locator("#preview [data-port-id]")).toHaveCount(17);

  await page.locator("#component-id").selectOption("regulator-lm2596-buck");
  await expect(page.locator("#component-summary")).toContainText("approximate");
  await expect(page.locator("#component-summary .accuracy--approximate")).toBeVisible();
});

