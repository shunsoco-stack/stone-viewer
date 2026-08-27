"use client";

import { Analytics } from "@vercel/analytics/next";

export function AnalyticsProvider() {
  return <Analytics debug={false} beforeSend={(event) => {
    if (navigator.doNotTrack === "1") return null;
    const url = new URL(event.url);
    url.search = "";
    url.hash = "";
    return { ...event, url: url.toString() };
  }} />;
}
