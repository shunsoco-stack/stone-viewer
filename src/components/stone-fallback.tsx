"use client";

import { memo, useId, useMemo } from "react";
import { createStoneOutline } from "@/lib/stone-geometry";

interface StoneFallbackProps {
  angle: number;
  seed: number;
  theme: "light" | "dark";
}

/** Static, original SVG: safe before hydration and when WebGL is unavailable. */
function StoneFallback({ angle, seed, theme }: StoneFallbackProps) {
  const instanceId = useId().replaceAll(":", "");
  const id = (name: string) => `${instanceId}-${name}`;
  const outline = useMemo(() => createStoneOutline(seed), [seed]);
  const dark = theme === "dark";

  return (
    <svg
      viewBox="0 0 680 420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby={id("title")}
      style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
    >
      <title id={id("title")}>コードで生成された石。軽量表示では平面上の回転で表現しています。</title>
      <defs>
        <linearGradient id={id("body")} x1="240" y1="92" x2="425" y2="300" gradientUnits="userSpaceOnUse">
          <stop stopColor={dark ? "#a6a79e" : "#9a9b92"} />
          <stop offset="0.38" stopColor={dark ? "#7c7e75" : "#787b72"} />
          <stop offset="0.78" stopColor="#50564f" />
          <stop offset="1" stopColor="#343c36" />
        </linearGradient>
        <radialGradient id={id("light")} cx="0" cy="0" r="1" gradientTransform="translate(265 114) rotate(34) scale(238 140)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e7e5d9" stopOpacity="0.34" />
          <stop offset="0.7" stopColor="#d6d5c9" stopOpacity="0" />
          <stop offset="1" stopColor="#19251e" stopOpacity="0.16" />
        </radialGradient>
        <radialGradient id={id("shadow")}>
          <stop stopColor={dark ? "#000" : "#4d5748"} stopOpacity={dark ? "0.55" : "0.24"} />
          <stop offset="0.54" stopColor={dark ? "#000" : "#4d5748"} stopOpacity={dark ? "0.18" : "0.085"} />
          <stop offset="1" stopColor="#4d5748" stopOpacity="0" />
        </radialGradient>
        <filter id={id("grain")} x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.52 0.62" numOctaves="3" seed={(seed >>> 0) % 1000} result="noise" />
          <feColorMatrix in="noise" type="saturate" values="0" result="grayNoise" />
          <feComponentTransfer in="grayNoise" result="softNoise">
            <feFuncR type="linear" slope="0.58" intercept="0.43" />
            <feFuncG type="linear" slope="0.58" intercept="0.43" />
            <feFuncB type="linear" slope="0.58" intercept="0.43" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="softNoise" mode="multiply" result="roughened" />
          <feComposite in="roughened" in2="SourceGraphic" operator="in" />
        </filter>
        <clipPath id={id("clip")}><path d={outline} /></clipPath>
      </defs>
      <ellipse cx="345" cy="327" rx="175" ry="28" fill={`url(#${id("shadow")})`} />
      <g transform={`rotate(${angle} 340 183)`}>
        <g filter={`url(#${id("grain")})`}>
          <path d={outline} fill={`url(#${id("body")})`} />
          <path d={outline} fill={`url(#${id("light")})`} />
          <g clipPath={`url(#${id("clip")})`}>
            <path d="M167 205C228 197 249 174 298 169C348 163 411 180 503 156" stroke="#d8d6c7" strokeOpacity="0.25" strokeWidth="2.3" />
            <path d="M173 208C222 203 246 181 293 177C342 171 405 185 506 165" stroke="#3c463e" strokeOpacity="0.15" strokeWidth="1.4" />
            <path d="M240 88C261 130 254 165 276 195C288 213 320 223 322 291" stroke="#bdc0b2" strokeOpacity="0.08" strokeWidth="1.1" />
          </g>
        </g>
      </g>
    </svg>
  );
}

export default memo(StoneFallback);
