import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Expenses",
  description: "Snap receipts. Track spending. Stay in sync.",
  applicationName: "My Expenses",
  // iPhone/iPad "Add to Home Screen": standalone app with a short icon label.
  appleWebApp: {
    capable: true,
    title: "Family Expenses",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/brand/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
  // Don't turn digit runs (invoice/ticket numbers) into phone-number links on iOS.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the app paint under the iPhone notch/home indicator; the shell then
  // pads with env(safe-area-inset-*) so nothing is clipped.
  viewportFit: "cover",
  themeColor: "#ffffff",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
