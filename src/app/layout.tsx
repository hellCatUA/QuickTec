import type { Metadata, Viewport } from "next";
import { themeInitScript } from "@/components/theme";
import { APP_NAME, getCompanySettings } from "@/lib/company";
import "./globals.css";

/**
 * Built rather than declared, so the App icon setting reaches the browser tab.
 *
 * A configured icon is listed ahead of the bundled one rather than replacing
 * it: browsers walk the list and take the first they can render, so an SVG
 * that a given one will not touch falls through to what we ship instead of
 * leaving the tab blank.
 */
export async function generateMetadata(): Promise<Metadata> {
  const company = await getCompanySettings();
  const icons = [
    ...(company.appIconUrl ? [{ url: company.appIconUrl }] : []),
    { url: "/icons/icon.svg" },
  ];

  return {
    title: {
      default: APP_NAME,
      template: `%s · ${APP_NAME}`,
    },
    description: "Field service time tracking and reporting.",
    manifest: "/manifest.webmanifest",
    applicationName: APP_NAME,
    appleWebApp: {
      capable: true,
      title: company.name,
      // Lets the app draw under the status bar once saved to the iPhone home
      // screen, matching the dark background.
      statusBarStyle: "black-translucent",
    },
    formatDetection: { telephone: false },
    icons: {
      icon: icons,
      apple: company.appIconUrl ?? "/icons/apple-touch-icon.png",
    },
  };
}

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
