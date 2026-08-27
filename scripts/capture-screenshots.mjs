import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.argv[2] || process.env.SCREENSHOT_BASE_URL;
if (!baseURL) throw new Error("公開URLを指定してください: npm run screenshots -- https://your-production.vercel.app");
const url = new URL(baseURL);
if (url.protocol !== "https:") throw new Error("公開後のHTTPS URLを指定してください。ローカル検証にはscripts/visual-check.mjsを使います。");

const output = path.resolve("public/screenshots");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const screenshots = [];
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, colorScheme: "light", deviceScaleFactor: 1, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  // A fresh, isolated visitor profile chooses a reproducible original stone.
  // No app code, angle shortcut, query-only demo, or DOM replacement is used.
  await context.addInitScript(() => {
    if (!localStorage.getItem("stone-viewer:v1")) {
      localStorage.setItem("stone-viewer:v1", JSON.stringify({ version: 1, rotations: 0, stone: { seed: 1729, name: "まどろみの石", description: "長い時間をかけて、現在の位置にいます。今後の予定は、ありません。" }, theme: "light", mode: "free", quality: "auto", days: {} }));
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(url.origin, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`Production response: ${response?.status()}`);
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("stone-scene")).toHaveAttribute("data-renderer", "webgl", { timeout: 20_000 });

  async function capture(file, label) {
    await page.screenshot({ path: path.join(output, file), fullPage: true });
    screenshots.push({ file, label, capturedAt: new Date().toISOString(), renderer: await page.getByTestId("stone-scene").getAttribute("data-renderer"), degrees: await page.getByTestId("total-degrees").textContent() });
    console.log(`Captured ${file}: ${label}`);
  }

  await capture("01-initial.png", "石の初期画面");
  await page.getByTestId("rotate-button").click();
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
  await expect(page.getByTestId("stone-scene")).toHaveAttribute("data-rendered-angle", "1");
  await capture("02-one-degree.png", "1度回転した画面");

  await page.getByRole("button", { name: "広告風モード 5s" }).click();
  await page.getByTestId("rotate-button").click();
  await expect(page.getByText("これは広告風演出です", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await capture("03-ad-performance.png", "5秒間の広告風演出");
  const reward = page.getByRole("dialog").getByRole("button", { name: "石を1度動かす 1°" });
  await expect(reward).toBeEnabled({ timeout: 8_000 });
  await reward.click();
  await expect(page.getByTestId("total-degrees")).toHaveText("2");
  await page.getByRole("button", { name: "そのまま、1度", exact: true }).click();
  // 358 real button clicks, plus the 2 above, earn the actual first circle.
  for (let count = 3; count <= 360; count++) {
    await page.getByTestId("rotate-button").click();
    if (count % 90 === 0) console.log(`Actual rotation buttons: ${count}/360`);
  }
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("total-degrees")).toHaveText("360");
  await expect(page.getByTestId("stone-scene")).toHaveAttribute("data-rendered-angle", "360", { timeout: 5_000 });
  await capture("04-full-circle.png", "実際に360回動かした一周記念");

  await page.getByRole("button", { name: "もう少し、眺める", exact: true }).click();
  await page.getByRole("button", { name: "夜の展示室に切り替える", exact: true }).click();
  await page.getByRole("button", { name: "禅モードに入る", exact: true }).click();
  await expect(page.locator('[data-zen="true"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /禅モードを終了/ })).toBeVisible();
  await expect(page.locator(".viewer")).toHaveCSS("background-color", "rgb(21, 24, 21)");
  await expect(page.getByTestId("stone-scene")).toHaveAttribute("data-renderer", "webgl");
  await capture("05-zen.png", "夜の展示室の禅モード");
  await context.close();
} finally {
  await browser.close();
}

if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
await mkdir(path.resolve("docs"), { recursive: true });
await writeFile(path.resolve("docs/screenshots.json"), JSON.stringify({ sourceURL: url.origin, viewport: { width: 1440, height: 1200 }, browser: "Playwright Chromium", screenshots, browserErrors: errors }, null, 2) + "\n");
console.log(`Saved ${screenshots.length} production screenshots to public/screenshots/`);
