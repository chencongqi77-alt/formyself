import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./archive.css";

const SITE_TITLE = "诗行漫记｜古诗词知识地图";
const SITE_DESCRIPTION =
  "从诗人的行迹、诗句里的山河与交游网络阅读古诗词；每一层内容均保留来源与审核状态。";

function requestOrigin(host: string | null, protocol: string | null): string {
  const normalizedHost = host?.split(",")[0]?.trim() ?? "";
  const forwardedProtocol = protocol?.split(",")[0]?.trim();
  const isLocalHost = /^(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?$/i.test(
    normalizedHost,
  );
  const normalizedProtocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : isLocalHost
        ? "http"
        : "https";
  return /^[a-z0-9.-]+(?::\d+)?$/i.test(normalizedHost)
    ? `${normalizedProtocol}://${normalizedHost}`
    : "https://poetry.local";
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = requestOrigin(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );
  const imageUrl = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [
        {
          url: imageUrl,
          width: 1733,
          height: 908,
          alt: "诗行漫记：古诗词知识地图",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
