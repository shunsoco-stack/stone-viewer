import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.argv[2] || "http://127.0.0.1:3107";
const output = path.resolve(".local");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const report = { url: baseURL, checks: [], errors: [] };

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: "light", deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    if (!localStorage.getItem("stone-viewer:v1")) localStorage.setItem("stone-viewer:v1", JSON.stringify({ version: 1, rotations: 0, stone: { seed: 1729, name: "まどろみの石", description: "長い時間をかけて、現在の位置にいます。今後の予定は、ありません。" }, theme: "light", mode: "free", quality: "auto", days: {} }));
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(baseURL);
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("stone-scene")).toHaveAttribute("data-renderer", "webgl", { timeout: 20_000 });

  async function capture(name) {
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    report.checks.push({ name, overflow, violations: accessibility.violations.map((v) => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) })) });
    console.log(`${name}: ${accessibility.violations.length} accessibility violations; viewport ${overflow.width}, content ${overflow.scrollWidth}`);
  }

  await capture("light-desktop");
  await page.getByRole("button", { name: "夜の展示室に切り替える" }).click();
  await capture("dark-desktop");
  await page.getByRole("button", { name: "昼の展示室に切り替える" }).click();
  await page.getByRole("button", { name: "広告風モード 5s" }).click();
  await page.getByTestId("rotate-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture("ad-dialog");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("light-mobile");
  await page.setViewportSize({ width: 320, height: 740 });
  await capture("narrow-mobile");
  await page.getByRole("button", { name: "禅モードに入る" }).click();
  await capture("zen-mobile");
  await context.close();
} finally {
  await writeFile(path.join(output, "visual-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}

if (report.errors.length) throw new Error(`Browser errors: ${report.errors.join("; ")}`);
