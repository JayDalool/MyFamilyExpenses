import type { MetadataRoute } from "next";

// Web app manifest (served at /manifest.webmanifest). Drives Android/Chrome
// install behavior and the icon/label shown after "Add to Home Screen".
// Icon files live in public/brand/ — see public/brand/README.md for how to
// swap in the real logo.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Expenses",
    // Label under the installed icon (Android). iOS uses appleWebApp.title.
    short_name: "Family Expenses",
    description: "Snap receipts. Track spending. Stay in sync.",
    start_url: "/",
    display: "standalone",
    // Matches the white app header so the standalone status bar blends in.
    theme_color: "#ffffff",
    // Splash/background while the app boots (slate-100, the page background).
    background_color: "#f1f5f9",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
