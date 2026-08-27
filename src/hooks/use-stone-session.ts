"use client";

import { useSyncExternalStore } from "react";
import { createStoneSessionStore, type StoneSessionSnapshot } from "@/lib/stone-session-store";
import type { StoneMode, StoneQuality, StoneTheme } from "@/lib/stone-state";

const store = createStoneSessionStore();

export interface StoneSession extends StoneSessionSnapshot {
  rotateOne: () => number;
  renameStone: () => void;
  setTheme: (theme: StoneTheme) => void;
  setMode: (mode: StoneMode) => void;
  setQuality: (quality: StoneQuality) => void;
}

/**
 * The stable server snapshot renders identically during hydration. Subscription
 * initializes browser-only data; Strict Mode resubscription never resets time.
 */
export function useStoneSession(): StoneSession {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return {
    ...snapshot,
    rotateOne: store.rotateOne,
    renameStone: store.renameStone,
    setTheme: store.setTheme,
    setMode: store.setMode,
    setQuality: store.setQuality,
  };
}
