import { expect, test } from "@playwright/test";

test("Cycle 5 keeps Circuit Lab icons bounded when the external Material Symbols font is unavailable", async ({ page }) => {
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  await page.goto("/circuits.html");

  await expect(page.locator("html")).toHaveClass(/circuit-material-symbols-fallback/u);
  const result = await page.locator(".material-symbols-rounded").first().evaluate((element) => {
    const style = getComputedStyle(element);
    const before = getComputedStyle(element, "::before");
    const rect = element.getBoundingClientRect();
    return {
      fontSize: style.fontSize,
      beforeDisplay: before.display,
      beforeWidth: before.width,
      width: rect.width,
      text: element.textContent
    };
  });

  expect(result.text).toBe("cable");
  expect(result.fontSize).toBe("0px");
  expect(result.beforeDisplay).toBe("block");
  expect(Number.parseFloat(result.beforeWidth)).toBeGreaterThan(0);
  expect(result.width).toBeLessThanOrEqual(24);
  await expect(page.locator("body")).not.toContainText("smart_toyzoom_in");
});
