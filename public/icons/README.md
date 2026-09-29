# App icons

Drop the generated PNG files straight into this folder. The names must match
exactly, because `public/manifest.webmanifest` and `index.html` already point at
these paths.

| File              | Size      | Used for                                  |
| ----------------- | --------- | ----------------------------------------- |
| `icon-48.png`     | 48 × 48   | Android launcher (mdpi)                   |
| `icon-72.png`     | 72 × 72   | Android launcher (hdpi)                   |
| `icon-96.png`     | 96 × 96   | Android launcher (xhdpi), favicon         |
| `icon-144.png`    | 144 × 144 | Android launcher (xxhdpi)                 |
| `icon-192.png`    | 192 × 192 | PWA install prompt, home-screen shortcut  |
| `icon-512.png`    | 512 × 512 | Play Store listing, splash screen         |
| `icon-maskable.png` | 512 × 512 | Adaptive icon (optional but recommended) |

## Notes

- **PNG only.** PWA Builder rejects JPEG for manifest icons, and PNG keeps the
  transparent corners Android needs.
- **Square source.** Export each size from the same square artwork so nothing
  is cropped or stretched.
- **`icon-maskable.png` needs padding.** Android crops adaptive icons to a
  circle or squircle, so keep the logo inside the centre ~80% and let the
  remaining edge be background colour. Without that padding the artwork gets
  clipped on many launchers.
- After adding the files, run `npm run build` once so they are copied into
  `dist/`.

The manifest entry for `icon-maskable.png` is commented out; uncomment it once
you add a properly padded version.
