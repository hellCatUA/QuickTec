import type { Metadata, Viewport } from "next";
import { themeInitScript } from "@/components/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "QuickTec",
    template: "%s · QuickTec",
  },
  description: "Field service time tracking and reporting.",
  manifest: "/manifest.webmanifest",
  applicationName: "QuickTec",
  appleWebApp: {
    capable: true,
    title: "QuickTec",
    // Lets the app draw under the status bar once saved to the iPhone home
    // screen, matching the dark background.
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Field techs need to pinch into photos and serial numbers, so zoom stays on.
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a1d24" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
