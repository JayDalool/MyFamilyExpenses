# Brand assets — how to swap in the real logo

Everything brand-related lives here. The current files are **placeholders**
(receipt glyph on sea-green) so the app looks finished until the real logo is
ready.

## When the real logo is ready

1. Replace these two source files (keep the same names):
   - `logo-mark.svg` — the **square** mark/icon (any square viewBox). This drives
     the app header, home-screen icons, favicon — everything.
   - `logo.svg` — the horizontal lockup (mark + wordmark), used on
     marketing/docs surfaces.
2. Regenerate the raster derivatives:

   ```bash
   npm run brand:icons
   ```

3. Commit and deploy. Done — no code changes needed.

## What gets generated (never edit these by hand)

| File | Used for |
|---|---|
| `apple-touch-icon.png` | iPhone/iPad "Add to Home Screen" icon (180×180, opaque) |
| `icon-192.png`, `icon-512.png` | Android/Chrome + PWA manifest icons |
| `maskable-512.png` | Android adaptive icons (mark inset 80% so circles/squircles never clip it) |
| `../favicon.ico` | Browser tab icon (16/32/48 multi-size) |

## Where the brand is wired

- In-app header (top-left): `components/app-shell.tsx` renders
  `/brand/logo-mark.svg` directly — an SVG swap updates it instantly.
- Login/signup pages: same `/brand/logo-mark.svg`.
- Home-screen/PWA metadata: `app/layout.tsx` (icons + Apple settings) and
  `app/manifest.ts` (Android/Chrome manifest).
- Display name: **"My Expenses"** in-app; the label under the home-screen icon
  is **"Family Expenses"** (`appleWebApp.title` + manifest `short_name`).

## Tips for the real logo

- `logo-mark.svg` should look good as a tiny square (16 px favicon) — avoid thin
  strokes and fine detail.
- If the mark has its own background color, keep `BRAND_BG` in
  `scripts/generate-brand-icons.mjs` in sync so the flattened/maskable canvases
  blend seamlessly.
- iOS ignores transparency on home-screen icons (fills black), which is why the
  generator flattens the Apple icon onto the brand color.
