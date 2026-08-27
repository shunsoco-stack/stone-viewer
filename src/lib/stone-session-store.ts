import {
  createStoneState,
  DEFAULT_SEED,
  incrementRotation,
  parseStoneState,
  randomStoneName,
  randomStoneSeed,
  serializeStoneState,
  STORAGE_KEY,
  type StoneIdentity,
  type StoneMode,
  type StoneQuality,
  type StoneState,
  type StoneTheme,
} from "./stone-state";
import {
  addViewingInterval,
  localDayKey,
  mergeViewingDays,
  ViewingClock,
  type TimeSample,
  type ViewingInterval,
} from "./viewing-time";

export interface StoneSessionSnapshot {
  ready: boolean;
  rotations: number;
  sessionSeconds: number;
  todaySeconds: number;
  stone: StoneIdentity;
  theme: StoneTheme;
  mode: StoneMode;
  quality: StoneQuality;
  storageAvailable: boolean;
}

const serverState = createStoneState(DEFAULT_SEED);
const SERVER_SNAPSHOT: StoneSessionSnapshot = {
  ready: false,
  rotations: 0,
  sessionSeconds: 0,
  todaySeconds: 0,
  stone: serverState.stone,
  theme: "light",
  mode: "free",
  quality: "auto",
  storageAvailable: true,
};

type Cleanup = () => void;

/** A small adapter keeps visibility, storage failures, and clocks testable in Node. */
export interface StoneSessionEnvironment {
  wallNow: () => number;
  monotonicNow: () => number;
  isVisible: () => boolean;
  prefersDark: () => boolean;
  random: () => number;
  readStorage: () => string | null;
  writeStorage: (value: string) => void;
  onVisibility: (listener: () => void) => Cleanup;
  onPageHide: (listener: () => void) => Cleanup;
  onPageShow: (listener: () => void) => Cleanup;
  onStorage: (listener: (value: string | null) => void) => Cleanup;
  everySecond: (listener: () => void) => Cleanup;
}

function browserEnvironment(): StoneSessionEnvironment | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const onWindow = (event: "pagehide" | "pageshow", listener: () => void): Cleanup => {
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  };
  return {
    wallNow: () => Date.now(),
    monotonicNow: () => performance.now(),
    isVisible: () => document.visibilityState === "visible",
    prefersDark: () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
    random: Math.random,
    readStorage: () => window.localStorage.getItem(STORAGE_KEY),
    writeStorage: (value) => window.localStorage.setItem(STORAGE_KEY, value),
    onVisibility: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    onPageHide: (listener) => onWindow("pagehide", listener),
    onPageShow: (listener) => onWindow("pageshow", listener),
    onStorage: (listener) => {
      const handle = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) listener(event.newValue);
      };
      window.addEventListener("storage", handle);
      return () => window.removeEventListener("storage", handle);
    },
    everySecond: (listener) => {
      const timer = window.setInterval(listener, 1_000);
      return () => window.clearInterval(timer);
    },
  };
}

export class StoneSessionStore {
  private state: StoneState = createStoneState(DEFAULT_SEED);
  private snapshot: StoneSessionSnapshot = SERVER_SNAPSHOT;
  private environment: StoneSessionEnvironment | null = null;
  private listeners = new Set<() => void>();
  private cleanups: Cleanup[] = [];
  private cancelTicker: Cleanup | null = null;
  private clock = new ViewingClock();
  private initialized = false;
  private started = false;
  private storageAvailable = true;
  private sessionMs = 0;
  private lastSavedAt = 0;

  constructor(private readonly suppliedEnvironment?: StoneSessionEnvironment) {}

  getSnapshot = (): StoneSessionSnapshot => this.snapshot;
  getServerSnapshot = (): StoneSessionSnapshot => SERVER_SNAPSHOT;

  subscribe = (listener: () => void): Cleanup => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  rotateOne = (): number => {
    if (!this.initialized) return this.state.rotations;
    this.collect();
    this.mergeLatest();
    this.state = { ...this.state, rotations: incrementRotation(this.state.rotations) };
    this.save();
    this.publish();
    return this.state.rotations;
  };

  renameStone = (): void => {
    if (!this.initialized || !this.environment) return;
    this.collect();
    this.state = {
      ...this.state,
      stone: {
        ...this.state.stone,
        name: randomStoneName(this.state.stone.name, this.environment.random),
      },
    };
    this.save();
    this.publish();
  };

  setTheme = (theme: StoneTheme): void => {
    if (theme === "light" || theme === "dark") this.setPreference("theme", theme);
  };

  setMode = (mode: StoneMode): void => {
    if (mode === "free" || mode === "ritual") this.setPreference("mode", mode);
  };

  setQuality = (quality: StoneQuality): void => {
    if (quality === "auto" || quality === "lite") this.setPreference("quality", quality);
  };

  private setPreference<Key extends "theme" | "mode" | "quality">(
    key: Key,
    value: StoneState[Key],
  ): void {
    if (!this.initialized) return;
    this.collect();
    this.state = { ...this.state, [key]: value };
    this.save();
    this.publish();
  }

  private start(): void {
    if (this.started) return;
    this.environment = this.suppliedEnvironment ?? browserEnvironment();
    const environment = this.environment;
    if (!environment) return;
    this.started = true;

    if (!this.initialized) {
      const fallback = createStoneState(
        randomStoneSeed(environment.random),
        environment.prefersDark() ? "dark" : "light",
      );
      try {
        this.state = parseStoneState(environment.readStorage(), fallback, environment.wallNow());
      } catch {
        this.storageAvailable = false;
        this.state = fallback;
      }
      this.initialized = true;
      this.save();
    }

    this.cleanups = [
      environment.onVisibility(this.handleVisibility),
      environment.onPageHide(this.pause),
      environment.onPageShow(this.handleVisibility),
      environment.onStorage(this.handleStorage),
    ];
    if (environment.isVisible()) this.resume();
    this.publish();
  }

  private stop(): void {
    if (!this.started) return;
    this.pause();
    this.started = false;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  private now(): TimeSample {
    const environment = this.environment!;
    return { wallMs: environment.wallNow(), monotonicMs: environment.monotonicNow() };
  }

  private applyInterval(interval: ViewingInterval | null): void {
    if (interval === null) return;
    this.sessionMs += interval.elapsedMs;
    this.state = {
      ...this.state,
      days: addViewingInterval(this.state.days, interval.fromMs, interval.toMs),
    };
  }

  private collect(): void {
    if (this.environment) this.applyInterval(this.clock.sample(this.now()));
  }

  private resume(): void {
    if (!this.environment || !this.started) return;
    this.clock.resume(this.now());
    if (this.cancelTicker === null) this.cancelTicker = this.environment.everySecond(this.tick);
  }

  private pause = (): void => {
    if (!this.environment) return;
    this.applyInterval(this.clock.pause(this.now()));
    this.cancelTicker?.();
    this.cancelTicker = null;
    this.save();
    this.publish();
  };

  private handleVisibility = (): void => {
    if (this.environment?.isVisible()) {
      this.mergeLatest();
      this.resume();
      this.publish();
    } else {
      this.pause();
    }
  };

  private tick = (): void => {
    const environment = this.environment;
    if (!environment) return;
    if (!environment.isVisible()) {
      this.pause();
      return;
    }
    this.collect();
    if (environment.monotonicNow() - this.lastSavedAt >= 5_000) this.save();
    this.publish();
  };

  private handleStorage = (raw: string | null): void => {
    if (!this.environment || raw === null) return;
    this.collect();
    const now = this.environment.wallNow();
    const remote = parseStoneState(raw, this.state, now);
    this.state = {
      ...remote,
      rotations: Math.max(this.state.rotations, remote.rotations),
      days: mergeViewingDays(this.state.days, remote.days, now),
    };
    this.publish();
  };

  private mergeLatest(): void {
    if (!this.environment) return;
    try {
      const now = this.environment.wallNow();
      const remote = parseStoneState(this.environment.readStorage(), this.state, now);
      this.state = {
        ...this.state,
        rotations: Math.max(this.state.rotations, remote.rotations),
        days: mergeViewingDays(this.state.days, remote.days, now),
      };
    } catch {
      this.storageAvailable = false;
    }
  }

  private save(): void {
    if (!this.environment || !this.initialized) return;
    this.mergeLatest();
    try {
      this.environment.writeStorage(serializeStoneState(this.state, this.environment.wallNow()));
      this.storageAvailable = true;
    } catch {
      // Quota errors, disabled cookies, and private contexts still work in memory.
      this.storageAvailable = false;
    }
    this.lastSavedAt = this.environment.monotonicNow();
  }

  private publish(): void {
    if (!this.environment) return;
    const next: StoneSessionSnapshot = {
      ready: this.initialized,
      rotations: this.state.rotations,
      sessionSeconds: Math.floor(this.sessionMs / 1_000),
      todaySeconds: Math.floor((this.state.days[localDayKey(this.environment.wallNow())] ?? 0) / 1_000),
      stone: this.state.stone,
      theme: this.state.theme,
      mode: this.state.mode,
      quality: this.state.quality,
      storageAvailable: this.storageAvailable,
    };
    if (Object.keys(next).every((key) => next[key as keyof StoneSessionSnapshot] === this.snapshot[key as keyof StoneSessionSnapshot])) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function createStoneSessionStore(environment?: StoneSessionEnvironment): StoneSessionStore {
  return new StoneSessionStore(environment);
}
