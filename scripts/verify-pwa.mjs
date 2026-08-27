import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

// Usage: node scripts/verify-pwa.mjs https://your-app.vercel.app [report.json]
// A production `next start` server on loopback is also supported. Never use next dev.
const target = process.argv[2] || process.env.PWA_BASE_URL;
if (!target) throw new Error("URLを指定してください: node scripts/verify-pwa.mjs https://your-app.vercel.app");
const base = new URL(target);
const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
if (base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))) {
  throw new Error("HTTPSの公開URL、またはHTTPのローカル本番サーバーを指定してください。");
}
const origin = base.origin;
const reportPath = path.resolve(process.argv[3] || ".local/pwa-verification.json");
const storageKey = "stone-viewer:v1";
const report = {
  sourceURL: origin,
  startedAt: new Date().toISOString(),
  browser: "Playwright Chromium",
  result: "running",
  checks: [],
  diagnostics: { appErrors: [], analytics: [], expectedOffline: [], unexpectedRequests: [] },
  limitations: [
    "実端末へのインストールとOSのstandaloneウィンドウ起動は未検証。manifestとChromiumのinstallability判定を検証します。",
    "ServiceWorkerRegistration.update()による更新確認は検証しますが、異なるリリース間の更新は再現していません。",
  ],
};
let phase = "initial";
const expectedMissingAssets = new Set();
const analyticsRoutes = new Set();
const analyticsScriptRoutes = new Set();
const analyticsViewRoutes = new Set();
const observedResponses = [];
const scriptResponses = new Map();
const routeOf = (value) => {
  const url = new URL(value, origin);
  return `${url.origin}${url.pathname}`;
};
const isAnalytics = (value) => {
  try {
    const url = new URL(value, origin);
    return url.pathname.startsWith("/_vercel/") || url.hostname === "va.vercel-scripts.com" ||
      analyticsRoutes.has(`${url.origin}${url.pathname}`);
  } catch { return false; }
};
const isExpectedOffline = (value) => {
  if (!phase.includes("offline")) return false;
  const url = new URL(value, origin);
  // Next's opportunistic RSC prefetch and telemetry intentionally remain uncached;
  // their offline failures do not mean that the cached app failed to hydrate.
  return value.includes("/__stone_pwa_offline_probe__") || expectedMissingAssets.has(value) ||
    (url.origin === origin && url.searchParams.has("_rsc"));
};
function pass(name, details = {}) {
  report.checks.push({ name, result: "passed", ...details });
  console.log(`PASS ${name}`);
}
async function discoverAnalyticsRoutes(page) {
  // Vercel can replace /_vercel/insights with deployment-specific route aliases.
  // Identify those by the actual SDK attribute, never by guessing a hashed URL.
  const scripts = await page.locator('script[data-sdkn^="@vercel/analytics"]').evaluateAll((elements) => elements.map((element) => ({
    src: element.src,
    sdk: element.dataset.sdkn,
    version: element.dataset.sdkv,
    viewEndpoint: element.dataset.viewEndpoint,
    endpoints: [element.dataset.viewEndpoint, element.dataset.eventEndpoint, element.dataset.sessionEndpoint].filter(Boolean),
  })));
  for (const script of scripts) {
    analyticsScriptRoutes.add(routeOf(script.src));
    if (script.viewEndpoint) analyticsViewRoutes.add(routeOf(script.viewEndpoint));
    for (const value of [script.src, ...script.endpoints]) {
      analyticsRoutes.add(routeOf(value));
    }
  }
  report.analyticsScripts = scripts;
  report.analyticsRoutes = [...analyticsRoutes];
}
function observe(page) {
  page.on("pageerror", (error) => report.diagnostics.appErrors.push({ phase, message: error.message }));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const value = { phase, message: message.text(), url: message.location().url };
    if (isAnalytics(value.url) || (loopback && value.message.includes("/_vercel/insights/"))) report.diagnostics.analytics.push(value);
    else if (isExpectedOffline(value.url)) report.diagnostics.expectedOffline.push(value);
    else report.diagnostics.appErrors.push(value);
  });
  page.on("requestfailed", (request) => {
    const value = { phase, url: request.url(), error: request.failure()?.errorText };
    if (isAnalytics(value.url)) report.diagnostics.analytics.push(value);
    else if (isExpectedOffline(value.url)) report.diagnostics.expectedOffline.push(value);
    else if (value.error !== "net::ERR_ABORTED") report.diagnostics.unexpectedRequests.push(value);
  });
  page.on("response", (response) => {
    // Keep only network metadata, never payloads. Classification happens after
    // reading SDK attributes so responses arriving before hydration are retained.
    observedResponses.push({
      phase,
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      fromServiceWorker: response.fromServiceWorker(),
    });
    if (new URL(response.url()).pathname.endsWith(".js")) scriptResponses.set(routeOf(response.url()), response);
    if (response.status() >= 400 && isAnalytics(response.url())) {
      report.diagnostics.analytics.push({ phase, url: response.url(), status: response.status() });
    }
  });
}
async function recordAnalyticsDelivery(page) {
  if (loopback) {
    report.analyticsDelivery = { status: "not applicable", reason: "Vercel collection endpoints are unavailable in next start." };
    return;
  }
  const onlineScript = observedResponses.find((response) =>
    !response.phase.includes("offline") && response.method === "GET" &&
    response.status === 200 && analyticsScriptRoutes.has(routeOf(response.url)));
  const onlinePageview = observedResponses.find((response) =>
    !response.phase.includes("offline") && response.method === "POST" &&
    response.status >= 200 && response.status < 300 && analyticsViewRoutes.has(routeOf(response.url)));
  const automation = await page.evaluate(() => ({ webdriver: navigator.webdriver, userAgent: navigator.userAgent }));
  let headlessExclusion = { confirmed: false };
  if (onlineScript) {
    try {
      const source = await scriptResponses.get(routeOf(onlineScript.url))?.text();
      const guard = source?.match(/function ([A-Za-z_$][\w$]*)\(\)\{return!!\(navigator\.webdriver\|\|navigator\.userAgent\.includes\("Headless"\)\)\}/);
      if (guard && source.includes(`if(${guard[1]}())return;`)) {
        headlessExclusion = { confirmed: true, guard: guard[0], earlyReturn: `if(${guard[1]}())return;` };
      }
    } catch {
      // Script-body access is diagnostic only, not part of PWA correctness.
    }
  }
  // Never spoof automation signals or issue synthetic analytics requests just to
  // obtain a 2xx. The production SDK intentionally excludes automated browsers.
  report.analyticsDelivery = {
    script: { observed: Boolean(onlineScript), response: onlineScript ?? null },
    pageview: { observed: Boolean(onlinePageview), response: onlinePageview ?? null },
    automation,
    headlessExclusion,
    dashboardAggregation: "not checked",
    routeEvidence: "Exact script URL and viewEndpoint from script[data-sdkn^='@vercel/analytics']",
  };
  console.log(`INFO Analytics: script ${onlineScript?.status ?? "not observed"}; pageview ${onlinePageview?.status ?? "not observed"}; SDK headless exclusion ${headlessExclusion.confirmed ? "confirmed" : "unconfirmed"}`);
}
async function browserContext(browser, lite = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    locale: "ja-JP", timezoneId: "Asia/Tokyo", colorScheme: "light",
    reducedMotion: "reduce", serviceWorkers: "allow",
  });
  await context.addInitScript(({ key, initialLite }) => {
    // Only a fresh, isolated test visitor is modified. Actual app code is unmodified.
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    window.__stoneInstallPromptObserved = false;
    window.addEventListener("beforeinstallprompt", () => { window.__stoneInstallPromptObserved = true; });
    if (initialLite && !localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({
        version: 1, rotations: 0, stone: { seed: 1729 },
        theme: "light", mode: "free", quality: "lite", days: {},
      }));
    }
  }, { key: storageKey, initialLite: lite });
  return context;
}
async function waitForApp(page, renderer) {
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("rotate-button")).toBeEnabled();
  if (renderer) await expect(page.getByTestId("stone-scene")).toHaveAttribute("data-renderer", renderer, { timeout: 25_000 });
}
async function warmCache(page) {
  await page.waitForFunction(async () => {
    if (!navigator.serviceWorker?.controller) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.active?.state !== "activated") return false;
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name)
      .filter((value) => { const url = new URL(value); return url.origin === location.origin && url.pathname.startsWith("/_next/static/"); });
    if (!resources.some((value) => value.endsWith(".js"))) return false;
    const stored = await Promise.all(resources.map((value) => caches.match(value)));
    return stored.every(Boolean) && Boolean(await caches.match("/"));
  }, null, { timeout: 30_000, polling: 200 });
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const names = await caches.keys();
    const entries = (await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name);
      return (await cache.keys()).map((request) => request.url);
    }))).flat();
    return {
      secureContext: window.isSecureContext,
      controller: navigator.serviceWorker.controller?.scriptURL,
      workerState: registration?.active?.state,
      scope: registration?.scope,
      cacheNames: names,
      cachedURLs: [...new Set(entries)],
      loadedStaticURLs: [...new Set(performance.getEntriesByType("resource").map((entry) => entry.name).filter((value) => new URL(value).pathname.startsWith("/_next/static/")))],
    };
  });
}
function assertPrivateRequestsUncached(cache) {
  for (const value of cache.cachedURLs) {
    const url = new URL(value);
    assert.equal(url.origin, origin, "Only same-origin public resources may be cached.");
    assert.ok(!isAnalytics(value), "Analytics must not be cached.");
    assert.ok(!url.pathname.startsWith("/api/") && !url.searchParams.has("_rsc"), "API and RSC requests must not be cached.");
  }
}
async function savedState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
}
async function turnOnce(page, degrees) {
  await page.getByTestId("rotate-button").click();
  await page.getByTestId("stone-scene").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("total-degrees")).toHaveText(String(degrees));
  await expect(page.getByTestId("stone-scene")).toHaveAttribute("data-rendered-angle", String(degrees));
  assert.equal((await savedState(page)).rotations, degrees);
}
async function goOffline(context, page, cdp) {
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await context.setOffline(true);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.equal(await page.evaluate(async () => {
    try { await fetch("/__stone_pwa_offline_probe__", { cache: "no-store" }); return false; }
    catch { return true; }
  }), true, "An uncached request must genuinely fail offline.");
}
async function offlineReload(page, renderer) {
  const response = await page.reload({ waitUntil: "load", timeout: 30_000 });
  assert.ok(response?.ok(), "The service worker must return a usable offline HTML response.");
  assert.equal(response.fromServiceWorker(), true, "Offline navigation must be served by the service worker.");
  await waitForApp(page, renderer);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const context = await browserContext(browser);
  const page = await context.newPage();
  observe(page);
  phase = "online-warm";
  const firstResponse = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  assert.ok(firstResponse?.ok());
  await waitForApp(page, "webgl");
  await discoverAnalyticsRoutes(page);
  const initialCache = await warmCache(page);
  assert.equal(initialCache.secureContext, true);
  assert.equal(initialCache.scope, `${origin}/`);
  assertPrivateRequestsUncached(initialCache);
  pass("Service worker active, controlling, and initial Next assets cached", initialCache);

  const manifestURL = await page.locator('link[rel="manifest"]').getAttribute("href");
  assert.ok(manifestURL);
  const manifestResponse = await context.request.get(new URL(manifestURL, origin).href);
  assert.ok(manifestResponse.ok());
  const manifest = await manifestResponse.json();
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.display, "standalone");
  assert.equal(new URL(manifest.start_url, origin).href, `${origin}/`);
  assert.equal(new URL(manifest.scope, origin).href, `${origin}/`);
  const icons = [];
  for (const icon of manifest.icons) {
    const iconURL = new URL(icon.src, origin);
    assert.equal(iconURL.origin, origin);
    const response = await context.request.get(iconURL.href);
    assert.ok(response.ok(), `Icon ${icon.src} must load.`);
    const dimensions = await sharp(await response.body()).metadata();
    assert.equal(icon.sizes, `${dimensions.width}x${dimensions.height}`);
    assert.equal(dimensions.format, "png");
    icons.push({ src: icon.src, purpose: icon.purpose, width: dimensions.width, height: dimensions.height });
  }
  assert.ok(icons.some((icon) => icon.width === 192 && icon.purpose === "any"));
  assert.ok(icons.some((icon) => icon.width === 512 && icon.purpose === "any"));
  assert.ok(icons.some((icon) => icon.width === 512 && icon.purpose === "maskable"));
  pass("Manifest and exact PNG icon dimensions", { manifest, icons });

  const swResponse = await context.request.get(`${origin}/sw.js`);
  assert.ok(swResponse.ok());
  const headers = swResponse.headers();
  assert.match(headers["content-type"], /javascript/);
  assert.match(headers["cache-control"], /no-store/);
  assert.match(headers["cache-control"], /no-cache/);
  assert.equal(headers["service-worker-allowed"], "/");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.match(headers["content-security-policy"], /default-src 'self'/);
  assert.match(headers["content-security-policy"], /script-src 'self'/);
  pass("Service worker security and revalidation headers", { headers });

  const cdp = await context.newCDPSession(page);
  const parsedManifest = await cdp.send("Page.getAppManifest");
  assert.deepEqual(parsedManifest.errors.filter((error) => error.critical), []);
  const installability = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors, []);
  pass("Chromium installability", {
    installabilityErrors: installability.installabilityErrors,
    manifestErrors: parsedManifest.errors,
    installPromptObserved: await page.evaluate(() => window.__stoneInstallPromptObserved),
    actualStandaloneLaunch: "not tested",
  });
  await recordAnalyticsDelivery(page);

  await expect(page.getByTestId("session-time")).not.toHaveText("00:00", { timeout: 6000 });
  await turnOnce(page, 1);
  const beforeOffline = await savedState(page);
  assert.ok(Object.values(beforeOffline.days).some((milliseconds) => milliseconds >= 1000));
  phase = "offline-cached-webgl";
  await goOffline(context, page, cdp);
  await offlineReload(page, "webgl");
  const reloaded = await savedState(page);
  assert.equal(reloaded.rotations, 1);
  assert.equal(reloaded.stone.seed, beforeOffline.stone.seed);
  for (const [day, duration] of Object.entries(beforeOffline.days)) assert.ok(reloaded.days[day] >= duration);
  await turnOnce(page, 2);
  await offlineReload(page, "webgl");
  await expect(page.getByTestId("total-degrees")).toHaveText("2");
  pass("Offline reload hydrates, renders cached WebGL, turns exactly 1 degree and preserves records", {
    rotationsBefore: 1, rotationsAfter: 2,
    preservedSeed: reloaded.stone.seed,
    cachedAssetCount: initialCache.cachedURLs.length,
    httpCacheDisabled: true,
  });

  phase = "online-restored";
  await context.setOffline(false);
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
  await page.reload({ waitUntil: "networkidle" });
  await waitForApp(page, "webgl");
  assert.equal((await savedState(page)).rotations, 2);
  const restoredCache = await warmCache(page);
  assertPrivateRequestsUncached(restoredCache);
  pass("Online recovery, worker update check, and analytics cache exclusion", { cacheNames: restoredCache.cacheNames });
  await context.close();

  // A second fresh visitor has chosen lite mode before Three.js is ever loaded.
  const coldContext = await browserContext(browser, true);
  const coldPage = await coldContext.newPage();
  observe(coldPage);
  phase = "online-lite-first-visit";
  await coldPage.goto(`${origin}/`, { waitUntil: "networkidle" });
  await waitForApp(coldPage, "svg");
  await discoverAnalyticsRoutes(coldPage);
  const coldCache = await warmCache(coldPage);
  assertPrivateRequestsUncached(coldCache);
  const coldAssets = new Set(coldCache.cachedURLs);
  const uncachedThreeAssets = initialCache.loadedStaticURLs.filter((value) => !coldAssets.has(value));
  assert.ok(uncachedThreeAssets.length > 0, "Lite mode should not load/cache the lazy WebGL library chunks.");
  for (const value of uncachedThreeAssets) expectedMissingAssets.add(value);
  const coldCdp = await coldContext.newCDPSession(coldPage);
  phase = "offline-without-three";
  await goOffline(coldContext, coldPage, coldCdp);
  await offlineReload(coldPage, "svg");
  await coldPage.locator(".quality-button").evaluate((button) => button.click());
  await expect(coldPage.getByTestId("stone-scene")).toHaveAttribute("data-fallback-reason", "render-error", { timeout: 15_000 });
  await expect(coldPage.getByTestId("stone-scene")).toHaveAttribute("data-renderer", "svg");
  await turnOnce(coldPage, 1);
  await offlineReload(coldPage, "svg");
  await expect(coldPage.getByTestId("total-degrees")).toHaveText("1");
  pass("Missing offline Three chunks fall back to SVG without losing controls or records", { uncachedThreeAssets });

  phase = "online-restored-after-svg";
  await coldContext.setOffline(false);
  await coldPage.reload({ waitUntil: "networkidle" });
  await waitForApp(coldPage, "webgl");
  assert.equal((await savedState(coldPage)).rotations, 1);
  assertPrivateRequestsUncached(await warmCache(coldPage));
  pass("WebGL returns after reconnect/reload without resetting the offline rotation");
  await coldContext.close();

  assert.deepEqual(report.diagnostics.appErrors, [], "Unexpected UI/browser errors were recorded.");
  assert.deepEqual(report.diagnostics.unexpectedRequests, [], "Unexpected requests failed.");
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.failure = { phase, message: error instanceof Error ? error.message : String(error) };
  process.exitCode = 1;
  console.error(`FAIL ${phase}: ${report.failure.message}`);
} finally {
  await browser.close();
  report.analyticsResponses = observedResponses.filter((response) => isAnalytics(response.url));
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PWA verification ${report.result}: ${reportPath}`);
}
