import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("読みやすさとキーボード操作", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme}表示のWCAG AAチェック`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await expect(page.locator('[data-ready="true"]')).toBeVisible();
      await expect(page.locator(".viewer")).toHaveAttribute("data-theme", theme);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(result.violations).toEqual([]);
    });
  }

  test("モバイル390pxのWCAG AAチェック", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator('[data-ready="true"]')).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  });

  test("説明ダイアログのフォーカスを閉じ込めEscapeで戻る", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "この場所について", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("広告風ダイアログのWCAG AAチェック", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "広告風モード 5s", exact: true }).click();
    await page.getByTestId("rotate-button").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  });

  test("禅モードの終了操作だけにフォーカスできる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "禅モードに入る", exact: true }).click();
    const exit = page.getByRole("button", { name: /禅モードを終了/ });
    await expect(exit).toBeFocused();
    await expect(page.getByTestId("rotate-button")).not.toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  });
});
