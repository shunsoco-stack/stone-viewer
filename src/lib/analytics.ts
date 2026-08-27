import { track } from "@vercel/analytics";

type StoneEvent = "stone_rotate" | "stone_viewing_time" | "stone_share";

/** Custom Events require a compatible Vercel plan. Never simulate them as page views. */
export function trackStoneEvent(event: StoneEvent, properties: Record<string, string | number>) {
  if (process.env.NEXT_PUBLIC_ENABLE_CUSTOM_EVENTS !== "true") return;
  if (typeof navigator === "undefined" || navigator.doNotTrack === "1") return;
  try {
    track(event, properties);
  } catch {
    // Telemetry must never prevent a stone from being a stone.
  }
}
