import { expect, test, type Page } from "@playwright/test";
import { createStoneState, STORAGE_KEY, type StoneState } from "../../src/lib/stone-state";

interface ViewerOptions {
  rotations?: number;
  quality?: "auto" | "lite";
  disableWebGL?: boolean;
  lowPower?: boolean;
  saveData?: boolean;
  denyStorage?: boolean;
  denyClipboard?: boolean;
  nativeShare?: "success" | "cancel";
}

async function openViewer(page: Page, options: ViewerOptions = {}) {
  const savedState: StoneState = {
    ...createStoneState(481_923),
    rotations: options.rotations ?? 0,
    quality: options.quality ?? "auto",
  };
  await page.addInitScript(({ settings, state, key }) => {
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: settings.lowPower ? 2 : 8 });
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: settings.lowPower ? 2 : 8 });
    if (settings.saveData) {
      Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
    }

    if (settings.denyStorage) {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() { throw new DOMException("Storage is unavailable for this test", "SecurityError"); },
      });
    } else if (localStorage.getItem(key) === null) {
      // Seed a deterministic first visit only: reload tests retain actual writes.
      localStorage.setItem(key, JSON.stringify(state));
    }

    if (settings.disableWebGL) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (["webgl", "webgl2", "experimental-webgl"].includes(contextId)) return null;
        return Reflect.apply(original, this, [contextId, ...args]);
      } as typeof HTMLCanvasElement.prototype.getContext;
    }

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: settings.nativeShare
        ? async (payload: ShareData) => {
            if (settings.nativeShare === "cancel") throw new DOMException("Cancelled", "AbortError");
            document.documentElement.dataset.e2eNativeShare = JSON.stringify(payload);
          }
        : undefined,
    });
    if (settings.denyClipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new DOMException("Clipboard permission denied", "NotAllowedError"); } },
      });
    }
  }, { settings: options, state: savedState, key: STORAGE_KEY });
  await page.goto("/");
  await expect(page.locator(".viewer")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("rotate-button")).toBeEnabled();
  return page.getByTestId("stone-scene");
}

async function savedState(page: Page): Promise<StoneState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), STORAGE_KEY) as Promise<StoneState>;
}

async function setVisibility(page: Page, visible: boolean) {
  // Simulate the standard browser visibility signal; the app's actual timer and
  // wall clock continue to run. No application state or timer internals are used.
  await page.evaluate((isVisible) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !isVisible });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => isVisible ? "visible" : "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);
}

function secondsFromDisplay(value: string) {
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

test("real WebGL renders without errors and a press reaches exactly one degree", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const scene = await openViewer(page);
  await expect(scene).toHaveAttribute("data-renderer", "webgl");
  await expect(scene.locator("canvas")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("何もしないを、ひとつ。");
  await expect(scene).toHaveAttribute("data-rendered-angle", "0");
  await page.getByTestId("rotate-button").click();
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
  await expect(scene).toHaveAttribute("data-angle", "1");
  await expect(scene).toHaveAttribute("data-rendered-angle", "1");
  expect(Number(await scene.getAttribute("data-rendered-yaw"))).toBeCloseTo(Math.PI / 180, 12);
  expect(errors).toEqual([]);
});

test("dragging the exhibition does not change the stone's angle", async ({ page }) => {
  const scene = await openViewer(page);
  await expect(scene).toHaveAttribute("data-renderer", "webgl");
  const box = await scene.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.3, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("total-degrees")).toHaveText("0");
  await expect(scene).toHaveAttribute("data-rendered-angle", "0");
});

test("360 actual rapid mouse clicks retain every degree and open the first-circle celebration", async ({ page }) => {
  const scene = await openViewer(page);
  await expect(scene).toHaveAttribute("data-renderer", "webgl");
  const rotate = page.getByTestId("rotate-button");
  await rotate.scrollIntoViewIfNeeded();
  const box = await rotate.boundingBox();
  expect(box).not.toBeNull();
  for (let click = 0; click < 360; click += 1) {
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  }
  await expect(page.getByTestId("total-degrees")).toHaveText("360");
  const dialog = page.getByRole("dialog", { name: "一周して、 同じ石。" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("1周記念", { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute("data-rendered-angle", "360");
  expect(Number(await scene.getAttribute("data-rendered-yaw"))).toBeCloseTo(2 * Math.PI, 12);
  await dialog.getByRole("button", { name: "もう少し、眺める" }).click();
  await rotate.click();
  await expect(page.getByTestId("total-degrees")).toHaveText("361");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("saved rotation, stone identity, dark theme and today's time survive reload", async ({ page }) => {
  await openViewer(page);
  await page.getByTestId("rotate-button").click();
  await page.getByTestId("rotate-button").click();
  await page.getByRole("button", { name: "夜の展示室に切り替える" }).click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-theme", "dark");
  const name = await page.getByTestId("stone-name").innerText();
  await expect.poll(async () => secondsFromDisplay(await page.getByTestId("session-time").innerText())).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.locator(".viewer")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("total-degrees")).toHaveText("2");
  await expect(page.getByTestId("stone-name")).toHaveText(name);
  await expect(page.locator(".viewer")).toHaveAttribute("data-theme", "dark");
  expect(secondsFromDisplay(await page.getByTestId("today-time").innerText())).toBeGreaterThanOrEqual(2);
  expect(secondsFromDisplay(await page.getByTestId("session-time").innerText())).toBeLessThanOrEqual(1);
});

test("renaming preserves the same seed, description, canvas and rotation", async ({ page }) => {
  const scene = await openViewer(page);
  await expect(scene).toHaveAttribute("data-renderer", "webgl");
  await page.getByTestId("rotate-button").click();
  const before = await savedState(page);
  const canvas = await scene.locator("canvas").elementHandle();
  await page.getByRole("button", { name: "石の名前をつけなおす" }).click();
  await expect(page.getByTestId("stone-name")).not.toHaveText(before.stone.name);
  const after = await savedState(page);
  expect(after.stone.name).not.toBe(before.stone.name);
  expect({ ...after.stone, name: before.stone.name }).toEqual(before.stone);
  expect(after.rotations).toBe(1);
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(scene).toHaveAttribute("data-rendered-angle", "1");
});

test("closing the clearly-labelled ad-style performance early never earns a rotation", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "広告風モード" }).click();
  await expect(page.getByRole("button", { name: "広告風モード" })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("rotate-button").click();
  const dialog = page.getByRole("dialog", { name: "何も、売りません。" });
  await expect(dialog.getByText("これは広告風演出です", { exact: true })).toBeVisible();
  await expect(dialog.locator(".reward-button")).toBeDisabled();
  await expect(page.getByTestId("ad-countdown")).toHaveText("05");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("total-degrees")).toHaveText("0");
  await expect(page.getByTestId("rotate-button")).toBeFocused();
});

test("five real seconds unlock exactly one reward, including duplicate claim events", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "広告風モード" }).click();
  const started = Date.now();
  await page.getByTestId("rotate-button").click();
  const dialog = page.getByRole("dialog", { name: "何も、売りません。" });
  const reward = dialog.locator(".reward-button");
  await expect(reward).toBeDisabled();
  await expect(reward).toBeEnabled({ timeout: 8_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
  await expect(page.getByTestId("total-degrees")).toHaveText("0");
  // Two queued clicks on the same mounted element must not grant two rewards.
  await reward.evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
  expect((await savedState(page)).rotations).toBe(1);
});

test("ad and viewing clocks pause while hidden and resume without counting the gap", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "広告風モード" }).click();
  await page.getByTestId("rotate-button").click();
  const dialog = page.getByRole("dialog", { name: "何も、売りません。" });
  await expect(page.getByTestId("ad-countdown")).toHaveText("04");
  await setVisibility(page, false);
  await expect(dialog.getByText("画面に戻るまで、時計もひと休み。")).toBeVisible();
  const remaining = await page.getByTestId("ad-countdown").innerText();
  const sessionTime = await page.getByTestId("session-time").innerText();
  // Intentional real-time wait: confirm both clocks stay paused for two seconds.
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId("ad-countdown")).toHaveText(remaining);
  await expect(page.getByTestId("session-time")).toHaveText(sessionTime);
  await expect(dialog.locator(".reward-button")).toBeDisabled();
  await setVisibility(page, true);
  await expect(dialog.locator(".reward-button")).toBeEnabled({ timeout: 6_000 });
  await dialog.locator(".reward-button").click();
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
});

test("zen mode hides controls, restores keyboard focus and exits with Escape or its button", async ({ page }) => {
  const scene = await openViewer(page);
  const entry = page.getByRole("button", { name: "禅モードに入る" });
  await entry.click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-zen", "true");
  await expect(page.getByTestId("rotate-button")).toBeHidden();
  const exit = page.getByRole("button", { name: "禅モードを終了" });
  await expect(exit).toBeFocused();
  await expect(scene).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".viewer")).toHaveAttribute("data-zen", "false");
  await expect(entry).toBeFocused();
  await entry.click();
  await exit.click();
  await expect(entry).toBeFocused();
});

test("fullscreen requests enter and leave the browser fullscreen state", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "全画面で鑑賞する" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe("HTML");
  await page.getByRole("button", { name: "全画面を終了" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test("a denied fullscreen request has a useful non-blocking fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await openViewer(page);
  await page.getByRole("button", { name: "全画面で鑑賞する" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("全画面に切り替えられませんでした");
  await page.getByTestId("rotate-button").click();
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
});

test("sharing writes the actual clipboard and reports success", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openViewer(page);
  await page.getByTestId("rotate-button").click();
  const name = await page.getByTestId("stone-name").innerText();
  await page.getByRole("button", { name: "この静けさを共有", exact: true }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("クリップボードにコピーしました");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(name);
  expect(copied).toContain("1度だけ動かしました。");
  expect(copied).toContain(new URL(page.url()).origin);
});

test("denied clipboard access opens a selectable manual-sharing fallback", async ({ page }) => {
  await openViewer(page, { denyClipboard: true });
  await page.getByRole("button", { name: "この静けさを共有", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "静けさを、おすそわけ。" });
  await expect(dialog).toBeVisible();
  const text = dialog.getByRole("textbox", { name: "共有する文章とURL" });
  expect(await text.inputValue()).toContain(new URL(page.url()).origin);
  await dialog.getByRole("button", { name: "文章を選択する" }).click();
  expect(await text.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    return textarea.selectionStart === 0 && textarea.selectionEnd === textarea.value.length;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "この静けさを共有", exact: true })).toBeFocused();
});

test("native share receives the current name, cumulative degrees and public URL", async ({ page }) => {
  await openViewer(page, { rotations: 42, nativeShare: "success" });
  await page.getByRole("button", { name: "この静けさを共有", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(document.documentElement.dataset.e2eNativeShare ?? "null") as ShareData);
  expect(payload.title).toBe("石を見る");
  expect(payload.text).toContain("42度だけ動かしました。");
  expect(payload.url).toBe(`${new URL(page.url()).origin}/`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cancelling native share does not unexpectedly open a copy prompt", async ({ page }) => {
  await openViewer(page, { nativeShare: "cancel", denyClipboard: true });
  await page.getByRole("button", { name: "この静けさを共有", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("total-degrees")).toHaveText("0");
});

test("disabled WebGL displays the original SVG and still rotates it by one degree", async ({ page }) => {
  const scene = await openViewer(page, { disableWebGL: true });
  await expect(scene).toHaveAttribute("data-renderer", "svg");
  await expect(scene).toHaveAttribute("data-fallback-reason", "webgl-unavailable");
  await expect(scene.locator("svg")).toBeVisible();
  await page.getByTestId("rotate-button").click();
  await expect(scene).toHaveAttribute("data-rendered-angle", "1");
  await expect(scene.locator('g[transform^="rotate"]')).toHaveAttribute("transform", "rotate(1 340 183)");
});

test("low-power devices choose SVG automatically without losing interaction", async ({ page }) => {
  const scene = await openViewer(page, { lowPower: true });
  await expect(scene).toHaveAttribute("data-renderer", "svg");
  await expect(scene).toHaveAttribute("data-fallback-reason", "low-power");
  await page.getByTestId("rotate-button").click();
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
  await expect(scene).toHaveAttribute("data-rendered-angle", "1");
});

test("data-saver devices choose the lightweight original SVG", async ({ page }) => {
  const scene = await openViewer(page, { saveData: true });
  await expect(scene).toHaveAttribute("data-renderer", "svg");
  await expect(scene).toHaveAttribute("data-fallback-reason", "low-power");
});

test("manual lightweight preference persists and can return to WebGL at the same angle", async ({ page }) => {
  const scene = await openViewer(page);
  await expect(scene).toHaveAttribute("data-renderer", "webgl");
  await page.getByTestId("rotate-button").click();
  await page.locator(".quality-button").click();
  await expect(scene).toHaveAttribute("data-fallback-reason", "lite");
  await page.reload();
  await expect(scene).toHaveAttribute("data-fallback-reason", "lite");
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
  await page.locator(".quality-button").click();
  await expect(scene).toHaveAttribute("data-renderer", "webgl");
  await expect(scene).toHaveAttribute("data-rendered-angle", "1");
});

test("a WebGL context loss recovers to SVG and preserves the exact angle", async ({ page }) => {
  const scene = await openViewer(page);
  await expect(scene).toHaveAttribute("data-renderer", "webgl");
  await page.getByTestId("rotate-button").click();
  await scene.locator("canvas").evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("webgl2");
    if (!context) throw new Error("A real WebGL2 context is required for this test");
    const extension = context.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("The context-loss extension is unavailable");
    extension.loseContext();
  });
  await expect(scene).toHaveAttribute("data-renderer", "svg");
  await expect(scene).toHaveAttribute("data-fallback-reason", "context-lost");
  await expect(scene).toHaveAttribute("data-rendered-angle", "1");
  await page.getByTestId("rotate-button").click();
  await expect(page.getByTestId("total-degrees")).toHaveText("2");
});

test("blocked localStorage leaves rotation, names and visible-time accounting usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openViewer(page, { denyStorage: true });
  await expect(page.getByText("保存できないため、今回だけの記録です。")).toBeVisible();
  await page.getByTestId("rotate-button").click();
  await expect(page.getByTestId("total-degrees")).toHaveText("1");
  const originalName = await page.getByTestId("stone-name").innerText();
  await page.getByRole("button", { name: "石の名前をつけなおす" }).click();
  await expect(page.getByTestId("stone-name")).not.toHaveText(originalName);
  await expect.poll(async () => secondsFromDisplay(await page.getByTestId("session-time").innerText())).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("manifest, install icons and service worker are publicly reachable", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ short_name: "石を見る", start_url: "/", display: "standalone", lang: "ja" });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
  ]));
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get("/sw.js")).ok()).toBe(true);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("320–390px screens have no horizontal scrolling and usable rotation controls", async ({ page }) => {
    await openViewer(page);
    for (const width of [390, 375, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const rotate = page.getByTestId("rotate-button");
      await rotate.scrollIntoViewIfNeeded();
      const box = await rotate.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await rotate.tap();
    }
    await expect(page.getByTestId("total-degrees")).toHaveText("3");
  });

  test("mobile zen mode fills the screen and keeps its exit reachable", async ({ page }) => {
    await openViewer(page);
    await page.getByRole("button", { name: "禅モードに入る" }).tap();
    await expect(page.locator(".viewer")).toHaveAttribute("data-zen", "true");
    await expect(page.getByTestId("stone-scene")).toBeVisible();
    const exit = page.getByRole("button", { name: "禅モードを終了" });
    await expect(exit).toBeInViewport();
    await exit.tap();
    await expect(page.getByTestId("rotate-button")).toBeVisible();
    await expect(page.locator(".viewer")).toHaveAttribute("data-zen", "false");
  });
});
