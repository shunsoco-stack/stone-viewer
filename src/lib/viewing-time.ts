/** Local-calendar viewing records, stored as whole milliseconds. */
export type ViewingDays = Record<string, number>;

export const RETAINED_VIEWING_DAYS = 30;
// A local calendar day can be 25 hours when daylight-saving time ends.
export const MAX_DAILY_VIEWING_MS = 25 * 60 * 60 * 1_000;
export const MAX_SAMPLE_GAP_MS = 5_000;
const MAX_CLOCK_SKEW_MS = 1_000;

export function localDayKey(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    year >= 1970 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Discard corrupt, future, and older-than-30-calendar-day records. */
export function pruneViewingDays(value: unknown, now: number): ViewingDays {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - (RETAINED_VIEWING_DAYS - 1));
  const earliestKey = localDayKey(earliest);
  const todayKey = localDayKey(now);

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, milliseconds]) =>
          isDayKey(key) &&
          key >= earliestKey &&
          key <= todayKey &&
          typeof milliseconds === "number" &&
          Number.isSafeInteger(milliseconds) &&
          milliseconds >= 0 &&
          milliseconds <= MAX_DAILY_VIEWING_MS,
      )
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, RETAINED_VIEWING_DAYS),
  );
}

/** Split an observed interval at each LOCAL midnight, including DST changes. */
export function addViewingInterval(
  days: ViewingDays,
  fromMs: number,
  toMs: number,
): ViewingDays {
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    !Number.isFinite(new Date(fromMs).getTime()) ||
    !Number.isFinite(new Date(toMs).getTime()) ||
    toMs <= fromMs
  ) {
    return { ...days };
  }

  const result = pruneViewingDays(days, toMs);
  const earliest = new Date(toMs);
  earliest.setDate(earliest.getDate() - (RETAINED_VIEWING_DAYS - 1));
  earliest.setHours(0, 0, 0, 0);
  let cursor = Math.max(Math.trunc(fromMs), earliest.getTime());
  const end = Math.trunc(toMs);

  // Retention bounds this loop even if a caller supplies a very long interval.
  while (cursor < end) {
    const day = new Date(cursor);
    const nextMidnight = new Date(cursor);
    nextMidnight.setDate(day.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);
    const boundary = Math.min(end, nextMidnight.getTime());
    if (boundary <= cursor) break;
    const key = localDayKey(day);
    result[key] = Math.min(
      MAX_DAILY_VIEWING_MS,
      (result[key] ?? 0) + boundary - cursor,
    );
    cursor = boundary;
  }

  return result;
}

/** Avoid regressing a saved total when another open tab publishes its state. */
export function mergeViewingDays(
  local: ViewingDays,
  remote: ViewingDays,
  now: number,
): ViewingDays {
  const result = pruneViewingDays(local, now);
  for (const [key, milliseconds] of Object.entries(pruneViewingDays(remote, now))) {
    result[key] = Math.max(result[key] ?? 0, milliseconds);
  }
  return result;
}

export interface TimeSample {
  wallMs: number;
  monotonicMs: number;
}

export interface ViewingInterval {
  fromMs: number;
  toMs: number;
  elapsedMs: number;
}

function validSample(sample: TimeSample): boolean {
  return (
    Number.isFinite(sample.wallMs) &&
    Number.isFinite(new Date(sample.wallMs).getTime()) &&
    Number.isFinite(sample.monotonicMs)
  );
}

/**
 * Counts only explicitly resumed, short, observed intervals. A suspended device,
 * a large event-loop gap, or a system-clock adjustment never becomes viewing time.
 */
export class ViewingClock {
  private previous: TimeSample | null = null;
  private fractionalMs = 0;

  get running(): boolean {
    return this.previous !== null;
  }

  resume(now: TimeSample): void {
    if (this.previous === null && validSample(now)) this.previous = { ...now };
  }

  sample(now: TimeSample): ViewingInterval | null {
    const previous = this.previous;
    if (previous === null) return null;
    if (!validSample(now)) {
      this.previous = null;
      this.fractionalMs = 0;
      return null;
    }
    this.previous = { ...now };
    const elapsed = now.monotonicMs - previous.monotonicMs;
    const wallElapsed = now.wallMs - previous.wallMs;

    if (
      elapsed < 0 ||
      wallElapsed < 0 ||
      elapsed > MAX_SAMPLE_GAP_MS ||
      wallElapsed > MAX_SAMPLE_GAP_MS ||
      Math.abs(elapsed - wallElapsed) > MAX_CLOCK_SKEW_MS
    ) {
      this.fractionalMs = 0;
      return null;
    }

    const withFraction = elapsed + this.fractionalMs;
    const elapsedMs = Math.floor(withFraction);
    this.fractionalMs = withFraction - elapsedMs;
    if (elapsedMs === 0) return null;
    const toMs = Math.trunc(now.wallMs);
    return { fromMs: toMs - elapsedMs, toMs, elapsedMs };
  }

  pause(now: TimeSample): ViewingInterval | null {
    const interval = this.sample(now);
    this.previous = null;
    return interval;
  }
}

export function formatViewingTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
