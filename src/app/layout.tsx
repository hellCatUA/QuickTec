import type { Metadata, Viewport } from "next";
import { themeInitScript } from "@/components/theme";
import { APP_NAME } from "@/lib/company";
import "./globals.css";

/**
 * Static on purpose. This runs for every prerendered page, and a production
 * build has no database — reading the company row here is what broke
 * `next build` on /_not-found. The configurable icon sits behind /icon, which
 * is a request-time route, so the tab follows the setting without the build
 * ever needing to connect.
 */
export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: "Field service time tracking and reporting.",
  manifest: "/manifest.webmanifest",
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    // Lets the app draw under the status bar once saved to the iPhone home
    // screen, matching the dark background.
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icon",
    apple: "/icon",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Field techs need to pinch into photos and serial numbers, so zoom stays on.
  maximumScale: 5,
  viewportFit: "cover",
  // The keyboard takes room off the page rather than off the view. Without it
  // the layout viewport keeps its full height behind the keyboard, and the
  // fixed tab bar — anchored to that viewport's bottom — is left floating
  // across the middle of the screen. iOS ignores this, which is what the
  // visual-viewport check in the tab bar itself is for.
  interactiveWidget: "resizes-content",
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
