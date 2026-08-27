"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let observer: PerformanceObserver | undefined;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (cancelled) return;
      // Initial scripts loaded before the first service worker took control.
      // Ask it to cache exactly those same-origin, content-hashed public assets.
      const warm = (entries: PerformanceEntry[]) => {
        const resources = entries.map((entry) => entry.name).filter((value) => {
          const url = new URL(value, location.origin);
          return url.origin === location.origin && url.pathname.startsWith("/_next/static/");
        });
        if (resources.length) registration.active?.postMessage({ type: "CACHE_INITIAL_ASSETS", resources });
      };
      warm(performance.getEntriesByType("resource"));
      // Buffered resource observation also covers a Three.js chunk that started
      // loading before activation but only finished after the initial scan.
      if ("PerformanceObserver" in window) {
        observer = new PerformanceObserver((list) => warm(list.getEntries()));
        observer.observe({ type: "resource", buffered: true });
      }
    }).catch(() => {
      // Installation is an enhancement: normal viewing still works without it.
    });
    return () => { cancelled = true; observer?.disconnect(); };
  }, []);
  return null;
}
