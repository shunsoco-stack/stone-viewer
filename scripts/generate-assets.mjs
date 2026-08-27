import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

// Original vector artwork. No stock images, external fonts, or model downloads.
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(projectRoot, "public");
const stonePath =
  "M 102 276 C 110 228 139 188 181 160 C 211 138 240 121 272 127 C 315 127 356 161 380 200 C 406 235 421 263 414 295 C 407 328 380 353 336 365 C 299 380 256 384 212 376 C 167 368 122 348 109 318 C 102 304 99 288 102 276 Z";

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function grain(count, seed) {
  const random = randomGenerator(seed);
  return Array.from({ length: count }, () => {
    const x = (96 + random() * 332).toFixed(2);
    const y = (119 + random() * 271).toFixed(2);
    const radius = (0.22 + random() * 1.12).toFixed(2);
    const tone = random() > 0.55 ? "#f5f2e8" : "#292b28";
    const opacity = (0.03 + random() * 0.19).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${tone}" opacity="${opacity}"/>`;
  }).join("");
}

function definitions(id) {
  return `<defs>
    <linearGradient id="${id}-rock" x1="0.17" y1="0.03" x2="0.76" y2="0.97" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#b9b8ad"/><stop offset=".31" stop-color="#8c8c80"/>
      <stop offset=".65" stop-color="#61655d"/><stop offset="1" stop-color="#3b403b"/>
    </linearGradient>
    <linearGradient id="${id}-light" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#fffdf1" stop-opacity=".42"/><stop offset="1" stop-color="#c5c1b3" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${id}-shadow"><stop stop-color="#42473d" stop-opacity=".2"/><stop offset="1" stop-color="#42473d" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}-clip"><path d="${stonePath}"/></clipPath>
  </defs>`;
}

function stone(id, detailed = false) {
  return `<path d="${stonePath}" fill="url(#${id}-rock)"/>
    <g clip-path="url(#${id}-clip)">
      <path d="M 93 276 L 182 161 L 272 127 L 251 230 L 172 284 Z" fill="url(#${id}-light)"/>
      <path d="M 251 230 L 272 127 L 365 176 L 388 231 L 311 260 Z" fill="#d1cdbd" opacity=".08"/>
      <path d="M 251 230 L 311 260 L 350 356 L 290 395 L 219 329 Z" fill="#333c35" opacity=".12"/>
      <path d="M 108 315 L 172 284 L 219 329 L 213 383 L 134 368 Z" fill="#343c32" opacity=".13"/>
      <path d="M 128 253 C 189 207 186 233 249 209 S 330 206 374 229" fill="none" stroke="#d9d6c8" stroke-width="1.1" opacity=".11"/>
      <path d="M 125 266 C 188 224 201 249 254 225 S 328 222 384 244" fill="none" stroke="#2c382c" stroke-width="1.3" opacity=".08"/>
      ${grain(detailed ? 2600 : 450, 18431)}
    </g>`;
}

function iconSvg({ maskable = false } = {}) {
  const transform = maskable ? "translate(38.4 38.4) scale(.85)" : "translate(-9 -4) scale(1.04)";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="石を見るのアイコン">
    ${definitions("icon")}
    <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="#f4f3ed"/>
    <g transform="${transform}">
      <ellipse cx="258" cy="404" rx="159" ry="28" fill="url(#icon-shadow)"/>
      ${stone("icon")}
      <circle cx="391" cy="122" r="13" fill="none" stroke="#5c6954" stroke-width="7"/>
    </g>
  </svg>`;
}

function ogSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    ${definitions("og")}
    <defs><radialGradient id="ambient"><stop stop-color="#fffef9"/><stop offset="1" stop-color="#f4f3ed"/></radialGradient></defs>
    <rect width="1200" height="630" fill="#f4f3ed"/>
    <ellipse cx="868" cy="255" rx="346" ry="260" fill="url(#ambient)"/>
    <path d="M 80 91 L 80 68 L 94 59 L 110 66 L 117 82 L 109 93 L 89 95 Z" fill="#5c6954"/>
    <text x="133" y="86" fill="#454c40" font-family="Segoe UI, Arial, sans-serif" font-size="14" letter-spacing="3.4">A QUIET LITTLE MUSEUM</text>
    <text x="73" y="278" fill="#242b24" font-family="Yu Mincho, BIZ UDMincho, Noto Serif CJK JP, serif" font-size="94" letter-spacing="8">石を見る</text>
    <text x="80" y="340" fill="#686b62" font-family="Yu Gothic, Meiryo, Noto Sans CJK JP, sans-serif" font-size="25" letter-spacing="2.4">何もしないを、ひとつ。</text>
    <rect x="80" y="398" width="218" height="48" rx="24" fill="#5c6954"/>
    <path d="M 105 422 A 8 8 0 1 1 112 430 M 102 418 L 105 422 L 110 419" fill="none" stroke="#f9faf4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="129" y="428" fill="#fffef9" font-family="Yu Gothic, Meiryo, sans-serif" font-size="14">石を1度動かす</text>
    <text x="273" y="428" fill="#e4e8df" font-family="Segoe UI, Arial, sans-serif" font-size="13" text-anchor="end">+1°</text>
    <ellipse cx="858" cy="462" rx="228" ry="66" fill="url(#og-shadow)"/>
    <ellipse cx="858" cy="463" rx="221" ry="62" fill="none" stroke="#d9ddd0" stroke-width="1"/>
    <ellipse cx="858" cy="463" rx="183" ry="48" fill="none" stroke="#e5e7dc" stroke-width="1"/>
    <g transform="translate(532 -48) scale(1.24)">${stone("og", true)}</g>
    <path d="M 858 517 L 858 528" stroke="#5c6954" stroke-width="2"/>
    <text x="858" y="555" text-anchor="middle" fill="#72796b" font-family="Segoe UI, Arial, sans-serif" font-size="12" letter-spacing="2.4">EXHIBIT № 001</text>
    <path d="M 80 529 H 552" stroke="#daddd2" stroke-width="1"/>
    <text x="80" y="563" fill="#747a6e" font-family="Segoe UI, Arial, sans-serif" font-size="12" letter-spacing="2.4">ONE STONE. ONE DEGREE.</text>
    <text x="550" y="563" text-anchor="end" fill="#868a7e" font-family="Yu Gothic, Meiryo, sans-serif" font-size="11">ただ、そこにある。</text>
  </svg>`;
}

async function png(source, width, outputPath) {
  await sharp(Buffer.from(source), { density: 144 })
    .resize(width, width, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicRoot, outputPath));
}

async function createFavicon(source) {
  const sizes = [16, 32, 48, 256];
  const frames = await Promise.all(
    sizes.map((size) => sharp(Buffer.from(source)).resize(size).png().toBuffer()),
  );
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const cursor = 6 + index * 16;
    header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], cursor);
    header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], cursor + 1);
    header.writeUInt16LE(1, cursor + 4);
    header.writeUInt16LE(32, cursor + 6);
    header.writeUInt32LE(frame.length, cursor + 8);
    header.writeUInt32LE(offset, cursor + 12);
    offset += frame.length;
  });
  await writeFile(path.join(publicRoot, "favicon.ico"), Buffer.concat([header, ...frames]));
}

await mkdir(path.join(publicRoot, "icons"), { recursive: true });
const icon = iconSvg();
await writeFile(path.join(publicRoot, "icon.svg"), icon, "utf8");
await Promise.all([
  png(icon, 192, "icons/icon-192.png"),
  png(icon, 512, "icons/icon-512.png"),
  png(iconSvg({ maskable: true }), 512, "icons/maskable-512.png"),
  png(iconSvg({ maskable: true }), 180, "apple-touch-icon.png"),
  createFavicon(icon),
  sharp(Buffer.from(ogSvg())).png({ compressionLevel: 9 }).toFile(path.join(publicRoot, "og.png")),
]);
console.log("Original assets generated: SVG, PWA icons (192/512/maskable), Apple touch icon, favicon, OG (1200×630).");
