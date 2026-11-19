import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

// Opens the real gallery page through the canned-RPC fixture: the grid, the
// preview dialog and the selection bar, in a real browser.
test.use({ viewport: { width: 1280, height: 900 } });

test("gallery page grid, preview and selection bar", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/e2e/fixtures/gallery-page.html?theme=light");
  const firstTile = page.getByRole("button", { name: "预览 generated-sunset.png" });
  await expect(firstTile).toBeVisible();
  await expect(page.getByText("今天", { exact: false }).first()).toBeVisible();
  await captureScreenshot(page, testInfo, "gallery-grid-light");

  await firstTile.click();
  await expect(page.getByRole("button", { name: "重命名 generated-sunset.png" })).toBeVisible();
  await captureScreenshot(page, testInfo, "gallery-preview-light");
  await page.keyboard.press("Escape");

  // Long-press the first tile to enter selection mode.
  const box = await firstTile.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByText("已选 1 项")).toBeVisible();
  await captureScreenshot(page, testInfo, "gallery-selection-light");

  expect(errors).toEqual([]);
});
