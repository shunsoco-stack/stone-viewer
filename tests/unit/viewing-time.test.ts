import { describe, expect, it, vi } from "vitest";
import {
  addViewingInterval,
  formatViewingTime,
  isDayKey,
  localDayKey,
  MAX_DAILY_VIEWING_MS,
  MAX_SAMPLE_GAP_MS,
  mergeViewingDays,
  pruneViewingDays,
  ViewingClock,
} from "../../src/lib/viewing-time";
import { createStoneState, parseStoneState, serializeStoneState } from "../../src/lib/stone-state";
import { createStoneSessionStore, type StoneSessionEnvironment } from "../../src/lib/stone-session-store";

const NOW = new Date(2026, 7, 27, 12, 0, 0).getTime();

describe("local calendar accounting", () => {
  it("uses the user's local date, not a UTC ISO date", () => {
    const localMidnight = new Date(2026, 7, 27, 0, 0, 0);
    expect(localDayKey(localMidnight)).toBe("2026-08-27");
    expect(localDayKey(new Date(2026, 0, 2, 23, 59, 59))).toBe("2026-01-02");
  });

  it("splits time exactly on both sides of midnight", () => {
    const before = new Date(2026, 7, 27, 23, 59, 58, 750).getTime();
    const after = new Date(2026, 7, 28, 0, 0, 1, 250).getTime();
    expect(addViewingInterval({}, before, after)).toEqual({
      "2026-08-27": 1_250,
      "2026-08-28": 1_250,
    });
  });

  it("splits at the year boundary and adds to existing days", () => {
    const before = new Date(2026, 11, 31, 23, 59, 59).getTime();
    const after = new Date(2027, 0, 1, 0, 0, 2).getTime();
    expect(addViewingInterval({ "2026-12-31": 5_000 }, before, after)).toEqual({
      "2026-12-31": 6_000,
      "2027-01-01": 2_000,
    });
  });

  it("validates calendar keys instead of accepting normalized invalid dates", () => {
    expect(isDayKey("2024-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-8-27", "__proto__"]) {
      expect(isDayKey(date)).toBe(false);
    }
  });

  it("retains at most the latest 30 local calendar days", () => {
    const days: Record<string, number> = {};
    for (let offset = 0; offset < 45; offset += 1) {
      const date = new Date(NOW);
      date.setDate(date.getDate() - offset);
      days[localDayKey(date)] = 1_000;
    }
    const retained = pruneViewingDays(days, NOW);
    expect(Object.keys(retained)).toHaveLength(30);
    expect(retained).toHaveProperty("2026-07-29");
    expect(retained).not.toHaveProperty("2026-07-28");
    expect(retained).toHaveProperty("2026-08-27");
  });

  it("rejects future, noninteger, negative, and oversized values", () => {
    expect(pruneViewingDays({
      "2026-08-28": 1_000,
      "2026-08-27": 1_234,
      "2026-08-26": -1,
      "2026-08-25": 1.5,
      "2026-08-24": MAX_DAILY_VIEWING_MS + 1,
      "2026-08-23": "1000",
      "2026-08-22": Infinity,
    }, NOW)).toEqual({ "2026-08-27": 1_234 });
    expect(pruneViewingDays(null, NOW)).toEqual({});
    expect(pruneViewingDays([], NOW)).toEqual({});
  });

  it("does not mutate inputs and ignores invalid or reversed intervals", () => {
    const original = { "2026-08-27": 1_000 };
    expect(addViewingInterval(original, NOW + 1_000, NOW)).toEqual(original);
    expect(addViewingInterval(original, NaN, NOW)).toEqual(original);
    expect(addViewingInterval(original, NOW, Infinity)).toEqual(original);
    addViewingInterval(original, NOW, NOW + 1_000);
    expect(original).toEqual({ "2026-08-27": 1_000 });
  });

  it("merges another tab's records without regressing totals or doubling overlap", () => {
    expect(mergeViewingDays(
      { "2026-08-27": 4_000, "2026-08-26": 1_000 },
      { "2026-08-27": 3_000, "2026-08-25": 2_000 },
      NOW,
    )).toEqual({ "2026-08-27": 4_000, "2026-08-26": 1_000, "2026-08-25": 2_000 });
  });

  it("formats a stable hour-minute-second display", () => {
    expect(formatViewingTime(0)).toBe("00:00:00");
    expect(formatViewingTime(61.9)).toBe("00:01:01");
    expect(formatViewingTime(3_661)).toBe("01:01:01");
    expect(formatViewingTime(-1)).toBe("00:00:00");
    expect(formatViewingTime(NaN)).toBe("00:00:00");
  });
});

describe("visibility-aware clock", () => {
  it("needs an explicit resume and never counts a hidden interval", () => {
    const clock = new ViewingClock();
    expect(clock.sample({ wallMs: NOW, monotonicMs: 0 })).toBeNull();
    clock.resume({ wallMs: NOW, monotonicMs: 0 });
    expect(clock.sample({ wallMs: NOW + 1_000, monotonicMs: 1_000 })?.elapsedMs).toBe(1_000);
    expect(clock.pause({ wallMs: NOW + 1_250, monotonicMs: 1_250 })?.elapsedMs).toBe(250);
    expect(clock.running).toBe(false);
    expect(clock.sample({ wallMs: NOW + 60_000, monotonicMs: 60_000 })).toBeNull();
    clock.resume({ wallMs: NOW + 60_000, monotonicMs: 60_000 });
    expect(clock.sample({ wallMs: NOW + 61_000, monotonicMs: 61_000 })?.elapsedMs).toBe(1_000);
  });

  it("does not turn a sleeping device or a long event-loop gap into watch time", () => {
    const clock = new ViewingClock();
    clock.resume({ wallMs: NOW, monotonicMs: 0 });
    const gap = MAX_SAMPLE_GAP_MS + 1;
    expect(clock.sample({ wallMs: NOW + gap, monotonicMs: gap })).toBeNull();
    expect(clock.sample({ wallMs: NOW + gap + 1_000, monotonicMs: gap + 1_000 })?.elapsedMs).toBe(1_000);
  });

  it("rejects a wall-clock jump or backward monotonic time", () => {
    const clock = new ViewingClock();
    clock.resume({ wallMs: NOW, monotonicMs: 0 });
    expect(clock.sample({ wallMs: NOW + 3_000, monotonicMs: 1_000 })).toBeNull();
    expect(clock.sample({ wallMs: NOW + 4_000, monotonicMs: 500 })).toBeNull();
    expect(clock.sample({ wallMs: NOW + 5_000, monotonicMs: 1_500 })?.elapsedMs).toBe(1_000);
  });

  it("keeps sub-millisecond remainders across samples", () => {
    const clock = new ViewingClock();
    clock.resume({ wallMs: NOW, monotonicMs: 0 });
    expect(clock.sample({ wallMs: NOW, monotonicMs: 0.75 })).toBeNull();
    expect(clock.sample({ wallMs: NOW + 1, monotonicMs: 1.5 })?.elapsedMs).toBe(1);
    expect(clock.sample({ wallMs: NOW + 2, monotonicMs: 2.25 })?.elapsedMs).toBe(1);
  });

  it("duplicate resume and pause events do not duplicate time", () => {
    const clock = new ViewingClock();
    clock.resume({ wallMs: NOW, monotonicMs: 0 });
    clock.resume({ wallMs: NOW + 500, monotonicMs: 500 });
    expect(clock.pause({ wallMs: NOW + 1_000, monotonicMs: 1_000 })?.elapsedMs).toBe(1_000);
    expect(clock.pause({ wallMs: NOW + 2_000, monotonicMs: 2_000 })).toBeNull();
  });
});

class FakeBrowser implements StoneSessionEnvironment {
  wall = NOW;
  monotonic = 0;
  visible = true;
  dark = false;
  raw: string | null = null;
  storageThrows = false;
  writes = 0;
  visibility = new Set<() => void>();
  pageHide = new Set<() => void>();
  pageShow = new Set<() => void>();
  storage = new Set<(raw: string | null) => void>();
  tickers = new Set<() => void>();

  wallNow = () => this.wall;
  monotonicNow = () => this.monotonic;
  isVisible = () => this.visible;
  prefersDark = () => this.dark;
  random = () => 0.2;
  readStorage = () => {
    if (this.storageThrows) throw new Error("Storage access denied");
    return this.raw;
  };
  writeStorage = (raw: string) => {
    if (this.storageThrows) throw new Error("Storage quota unavailable");
    this.raw = raw;
    this.writes += 1;
  };
  onVisibility = (listener: () => void) => {
    this.visibility.add(listener);
    return () => { this.visibility.delete(listener); };
  };
  onPageHide = (listener: () => void) => {
    this.pageHide.add(listener);
    return () => { this.pageHide.delete(listener); };
  };
  onPageShow = (listener: () => void) => {
    this.pageShow.add(listener);
    return () => { this.pageShow.delete(listener); };
  };
  onStorage = (listener: (raw: string | null) => void) => {
    this.storage.add(listener);
    return () => { this.storage.delete(listener); };
  };
  everySecond = (listener: () => void) => {
    this.tickers.add(listener);
    return () => { this.tickers.delete(listener); };
  };

  advance(milliseconds: number, tick = true): void {
    this.wall += milliseconds;
    this.monotonic += milliseconds;
    if (tick) for (const listener of this.tickers) listener();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const listener of this.visibility) listener();
  }

  dispatchStorage(raw: string): void {
    this.raw = raw;
    for (const listener of this.storage) listener(raw);
  }
}

describe("session external store", () => {
  it("has a deterministic, referentially stable server and initial snapshot", () => {
    const store = createStoneSessionStore(new FakeBrowser());
    expect(store.getSnapshot()).toBe(store.getServerSnapshot());
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    expect(store.getSnapshot().ready).toBe(false);
    const anotherStore = createStoneSessionStore(new FakeBrowser());
    expect(anotherStore.getServerSnapshot()).toBe(store.getServerSnapshot());
  });

  it("hydrates persisted data only on subscription, then resumes it on reload", () => {
    const browser = new FakeBrowser();
    browser.raw = serializeStoneState({ ...createStoneState(381, "dark"), rotations: 359 }, NOW);
    const store = createStoneSessionStore(browser);
    expect(store.getSnapshot().rotations).toBe(0);
    const unsubscribe = store.subscribe(vi.fn());
    expect(store.getSnapshot()).toMatchObject({ ready: true, rotations: 359, theme: "dark" });
    expect(store.rotateOne()).toBe(360);
    expect(store.rotateOne()).toBe(361);
    browser.advance(1_500);
    unsubscribe();
    const reloaded = createStoneSessionStore(browser);
    const cleanup = reloaded.subscribe(vi.fn());
    expect(reloaded.getSnapshot()).toMatchObject({ rotations: 361, todaySeconds: 1, sessionSeconds: 0 });
    expect(reloaded.getSnapshot().stone.seed).toBe(381);
    cleanup();
  });

  it("advances synchronously once per press, including all 360 presses", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    for (let press = 1; press <= 360; press += 1) expect(store.rotateOne()).toBe(press);
    expect(store.getSnapshot().rotations).toBe(360);
    expect(parseStoneState(browser.raw, createStoneState(1), NOW).rotations).toBe(360);
    cleanup();
  });

  it("renames only the stone's name and persists settings", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    const original = store.getSnapshot().stone;
    store.rotateOne();
    store.renameStone();
    const renamed = store.getSnapshot().stone;
    expect(renamed.name).not.toBe(original.name);
    expect({ ...renamed, name: original.name }).toEqual(original);
    expect(store.getSnapshot().rotations).toBe(1);
    store.setTheme("dark");
    store.setMode("ritual");
    store.setQuality("lite");
    expect(parseStoneState(browser.raw, createStoneState(1), NOW)).toMatchObject({
      theme: "dark", mode: "ritual", quality: "lite", stone: renamed,
    });
    cleanup();
  });

  it("uses the system dark preference on the first visit", () => {
    const browser = new FakeBrowser();
    browser.dark = true;
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    expect(store.getSnapshot().theme).toBe("dark");
    cleanup();
  });

  it("flushes on hide and does not count a hidden minute on return", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    browser.advance(1_000);
    browser.advance(500, false);
    browser.setVisible(false);
    expect(browser.tickers.size).toBe(0);
    expect(parseStoneState(browser.raw, createStoneState(1), browser.wall).days[localDayKey(browser.wall)]).toBe(1_500);
    browser.advance(60_000);
    expect(store.getSnapshot().sessionSeconds).toBe(1);
    browser.setVisible(true);
    browser.advance(1_500);
    expect(store.getSnapshot()).toMatchObject({ sessionSeconds: 3, todaySeconds: 3 });
    cleanup();
  });

  it("starts hidden without counting anything and arms its timer only when shown", () => {
    const browser = new FakeBrowser();
    browser.visible = false;
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    expect(browser.tickers.size).toBe(0);
    browser.advance(120_000);
    browser.setVisible(true);
    browser.advance(1_000);
    expect(store.getSnapshot().sessionSeconds).toBe(1);
    cleanup();
  });

  it("excludes sleep gaps while continuing subsequent observed seconds", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    browser.advance(1_000);
    browser.advance(60_000);
    expect(store.getSnapshot().sessionSeconds).toBe(1);
    browser.advance(1_000);
    expect(store.getSnapshot().sessionSeconds).toBe(2);
    cleanup();
  });

  it("updates today's display at midnight and saves both dates exactly", () => {
    const browser = new FakeBrowser();
    browser.wall = new Date(2026, 7, 27, 23, 59, 59).getTime();
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    browser.advance(2_500);
    browser.setVisible(false);
    expect(store.getSnapshot()).toMatchObject({ sessionSeconds: 2, todaySeconds: 1 });
    expect(parseStoneState(browser.raw, createStoneState(1), browser.wall).days).toEqual({
      "2026-08-27": 1_000,
      "2026-08-28": 1_500,
    });
    cleanup();
  });

  it("supports a pagehide/pageshow back-forward-cache cycle", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    browser.advance(1_500, false);
    for (const listener of browser.pageHide) listener();
    expect(browser.tickers.size).toBe(0);
    browser.advance(60_000);
    for (const listener of browser.pageShow) listener();
    browser.advance(500);
    expect(store.getSnapshot()).toMatchObject({ sessionSeconds: 2, todaySeconds: 2 });
    cleanup();
  });

  it("survives Strict Mode subscribe-cleanup-subscribe without duplicate timers or resets", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const firstCleanup = store.subscribe(vi.fn());
    const identity = store.getSnapshot().stone;
    browser.advance(500, false);
    firstCleanup();
    expect(browser.tickers.size).toBe(0);
    expect(browser.visibility.size).toBe(0);
    browser.advance(60_000);
    const secondCleanup = store.subscribe(vi.fn());
    expect(browser.tickers.size).toBe(1);
    expect(browser.visibility.size).toBe(1);
    browser.advance(500);
    expect(store.getSnapshot()).toMatchObject({ sessionSeconds: 1, todaySeconds: 1, stone: identity });
    secondCleanup();
  });

  it("counts once when multiple hook consumers subscribe", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const firstCleanup = store.subscribe(vi.fn());
    const secondCleanup = store.subscribe(vi.fn());
    expect(browser.tickers.size).toBe(1);
    browser.advance(1_000);
    expect(store.getSnapshot().sessionSeconds).toBe(1);
    firstCleanup();
    expect(browser.tickers.size).toBe(1);
    secondCleanup();
    expect(browser.tickers.size).toBe(0);
  });

  it("continues every in-memory feature when localStorage throws", () => {
    const browser = new FakeBrowser();
    browser.storageThrows = true;
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    expect(store.getSnapshot()).toMatchObject({ ready: true, storageAvailable: false });
    expect(store.rotateOne()).toBe(1);
    store.renameStone();
    store.setMode("ritual");
    store.setQuality("lite");
    browser.advance(1_000);
    expect(store.getSnapshot()).toMatchObject({ rotations: 1, sessionSeconds: 1, todaySeconds: 1, mode: "ritual", quality: "lite" });
    expect(() => cleanup()).not.toThrow();
  });

  it("recovers persistence after temporary storage denial without resetting progress", () => {
    const browser = new FakeBrowser();
    browser.storageThrows = true;
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    store.rotateOne();
    browser.advance(2_000);
    browser.storageThrows = false;
    store.rotateOne();
    expect(store.getSnapshot()).toMatchObject({ rotations: 2, todaySeconds: 2, storageAvailable: true });
    expect(parseStoneState(browser.raw, createStoneState(1), browser.wall).rotations).toBe(2);
    cleanup();
  });

  it("merges another tab's counter before a new press without regressing local time", () => {
    const browser = new FakeBrowser();
    const store = createStoneSessionStore(browser);
    const cleanup = store.subscribe(vi.fn());
    browser.advance(2_000);
    browser.dispatchStorage(serializeStoneState({
      ...createStoneState(12, "dark"),
      rotations: 30,
      days: { [localDayKey(NOW)]: 1_000 },
    }, NOW));
    expect(store.getSnapshot()).toMatchObject({ rotations: 30, todaySeconds: 2, theme: "dark" });
    expect(store.rotateOne()).toBe(31);
    browser.dispatchStorage(serializeStoneState({ ...createStoneState(12), rotations: 2 }, NOW));
    expect(store.getSnapshot()).toMatchObject({ rotations: 31, todaySeconds: 2 });
    cleanup();
  });
});
