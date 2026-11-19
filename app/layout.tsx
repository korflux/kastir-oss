import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/ThemeProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Kastir",
  description: "A lightweight, self-hosted micro-CMS.",
  icons: {
    icon: { url: "/icon.webp", type: "image/webp", sizes: "513x512" },
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Only /admin sets x-nonce (see proxy.ts); other routes get undefined and
  // next-themes just skips the nonce attribute, which is fine since their
  // CSP (if any) doesn't restrict script-src.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          nonce={nonce}
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
