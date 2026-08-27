import type { SVGProps } from "react";

export type IconName = "stone" | "rotate" | "sun" | "moon" | "expand" | "shrink" | "zen" | "share" | "shuffle" | "close" | "arrow" | "leaf" | "clock" | "check" | "info";

const paths: Record<IconName, React.ReactNode> = {
  stone: <><path d="m3.2 14.5 2.5-6.2L12 4.5l6 2.2 3.1 7.2-3.9 4.3H6.4z" /><path d="m5.7 8.3 7.1 2.9 5.2-4.5M12.8 11.2l4.4 7M12.8 11.2l-6.4 7" /></>,
  rotate: <><path d="M20 7v5h-5M4.7 8a8 8 0 1 1-.6 6M20 12a8 8 0 0 0-14-5" /></>,
  sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  moon: <path d="M20 14.1A8.6 8.6 0 0 1 9.9 4a8.6 8.6 0 1 0 10.2 10.1Z" />,
  expand: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />,
  shrink: <path d="M4 9h5V4m6 0v5h5M9 20v-5H4m11 5v-5h5" />,
  zen: <><path d="M17.8 5.3a8.5 8.5 0 1 1-5.7-2" /><path d="M14.8 3.5c1.1.4 2 1 2.8 1.8" strokeWidth="2.8" /></>,
  share: <><path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3" /></>,
  shuffle: <><path d="M3 7h3c4 0 6 10 10 10h5m-4-4 4 4-4 4M3 17h3c1.3 0 2.3-1.1 3.3-2.7M14.7 9.7C15.7 8.1 16.7 7 18 7h3m-4-4 4 4-4 4" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
  leaf: <><path d="M20 3c0 12-3 16-9 16a7 7 0 0 1-7-7C4 6 12 3 20 3Z" /><path d="M3 21 15 9" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
