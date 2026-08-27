import type { Metadata, Viewport } from "next";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { PwaRegistration } from "@/components/pwa-registration";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://stone-viewer-iota.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "石を見る — 何もしないを、ひとつ。",
  description: "ただ、石を眺める。ボタンを押すと、たった1度だけ動く。忙しい世界の片隅にある、小さなデジタル美術館です。",
  applicationName: "石を見る",
  keywords: ["石を見る", "石", "WebGL", "デジタル美術館", "禅", "個人開発"],
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "32x32" }, { url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "石を見る" },
  openGraph: {
    title: "石を見る — 何もしないを、ひとつ。",
    description: "360回押すと、一周します。それだけのことを、少しだけ大切に。",
    url: "/",
    siteName: "石を見る",
    locale: "ja_JP",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "石を見る — 何もしないを、ひとつ。" }],
  },
  twitter: { card: "summary_large_image", title: "石を見る", description: "何もしないを、ひとつ。", images: ["/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#151815" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        {children}
        <PwaRegistration />
        <AnalyticsProvider />
      </body>
    </html>
  );
}
