import { pruneViewingDays, type ViewingDays } from "./viewing-time";

export const STORAGE_KEY = "stone-viewer:v1";
export const MAX_ROTATIONS = Number.MAX_SAFE_INTEGER;
export const MAX_SEED = 0xffff_ffff;
export const DEFAULT_SEED = 0x0073_1941;

export type StoneTheme = "light" | "dark";
export type StoneMode = "free" | "ritual";
export type StoneQuality = "auto" | "lite";

export interface StoneIdentity {
  seed: number;
  name: string;
  id: string;
  description: string;
}

export interface StoneState {
  version: 1;
  rotations: number;
  stone: StoneIdentity;
  theme: StoneTheme;
  mode: StoneMode;
  quality: StoneQuality;
  days: ViewingDays;
}

const STONE_NAMES = [
  "まどろみの石",
  "しじまの石",
  "遠い午後の石",
  "木曜日の石",
  "余白の石",
  "昼下がりの石",
  "なにもしない石",
  "帰り道の石",
  "たぶん立派な石",
  "ひとやすみの石",
  "名前だけある石",
  "静かな決意の石",
  "明日でもいい石",
  "ほぼ無口な石",
  "小さな休日の石",
  "悠々自適の石",
  "風待ちの石",
  "まだ眠い石",
  "だいたい平穏な石",
  "ひそかな主役の石",
  "言いかけた石",
  "遠回りの石",
  "ちょうどいい石",
  "とくに急がない石",
] as const;

const STONE_DESCRIPTIONS = [
  "長い時間をかけて、現在の位置にいます。今後の予定は、ありません。",
  "黙っているように見えますが、実際に黙っています。",
  "表と裏があります。どちらが表かは、石も決めていません。",
  "とても落ち着いています。締め切りがないためかもしれません。",
  "角度によって、少し違って見えます。だいたいは、同じです。",
  "手のひらに収まりそうですが、画面から出る予定はありません。",
  "ここにいることに、特別な理由はありません。あなたもどうぞ。",
  "持ち味は、石であること。得意なことも、おおむね同じです。",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_SEED;
}

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function isRotationCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function unitRandom(random: () => number): number {
  const value = random();
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0.5;
}

/** Not a secret: this seed identifies a wholly procedural, reproducible mesh. */
export function randomStoneSeed(random: () => number = Math.random): number {
  return Math.floor(unitRandom(random) * MAX_SEED) + 1;
}

export function createStoneIdentity(seed: number): StoneIdentity {
  const safeSeed = validSeed(seed) ? seed : DEFAULT_SEED;
  return {
    seed: safeSeed,
    name: STONE_NAMES[safeSeed % STONE_NAMES.length],
    id: `ST-${safeSeed.toString(16).toUpperCase().padStart(8, "0")}`,
    description: STONE_DESCRIPTIONS[Math.floor(safeSeed / STONE_NAMES.length) % STONE_DESCRIPTIONS.length],
  };
}

/** The next name is always different; identity, geometry, and description stay put. */
export function randomStoneName(
  previousName?: string,
  random: () => number = Math.random,
): string {
  let index = Math.floor(unitRandom(random) * STONE_NAMES.length);
  if (STONE_NAMES[index] === previousName) index = (index + 1) % STONE_NAMES.length;
  return STONE_NAMES[index];
}

export function createStoneState(
  seed: number = randomStoneSeed(),
  theme: StoneTheme = "light",
): StoneState {
  return {
    version: 1,
    rotations: 0,
    stone: createStoneIdentity(seed),
    theme,
    mode: "free",
    quality: "auto",
    days: {},
  };
}

/** Keep an integer count; converting to radians belongs only in the renderer. */
export function incrementRotation(rotations: number): number {
  const current = isRotationCount(rotations) ? rotations : 0;
  return current === MAX_ROTATIONS ? current : current + 1;
}

/** Storage is untrusted input. Salvage valid fields without ever throwing. */
export function parseStoneState(
  raw: string | null,
  fallback: StoneState = createStoneState(DEFAULT_SEED),
  now: number = Date.now(),
): StoneState {
  const defaults: StoneState = {
    ...fallback,
    stone: { ...fallback.stone },
    days: pruneViewingDays(fallback.days, now),
  };
  if (raw === null || raw.length > 32_768) return defaults;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!record(parsed) || parsed.version !== 1) return defaults;

  let stone = defaults.stone;
  if (record(parsed.stone) && validSeed(parsed.stone.seed)) {
    const identity = createStoneIdentity(parsed.stone.seed);
    stone = {
      ...identity,
      name: validText(parsed.stone.name, 64) ? parsed.stone.name.trim() : identity.name,
      description: validText(parsed.stone.description, 240)
        ? parsed.stone.description.trim()
        : identity.description,
      // The display identifier always agrees with the actual procedural seed.
    };
  }

  return {
    version: 1,
    rotations: isRotationCount(parsed.rotations) ? parsed.rotations : defaults.rotations,
    stone,
    theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : defaults.theme,
    mode: parsed.mode === "free" || parsed.mode === "ritual" ? parsed.mode : defaults.mode,
    quality: parsed.quality === "auto" || parsed.quality === "lite" ? parsed.quality : defaults.quality,
    days: record(parsed.days) ? pruneViewingDays(parsed.days, now) : defaults.days,
  };
}

export function serializeStoneState(state: StoneState, now: number = Date.now()): string {
  return JSON.stringify({ ...state, days: pruneViewingDays(state.days, now) });
}
