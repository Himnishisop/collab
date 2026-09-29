import { useState } from "react";
import { IconWave } from "./Icons";

/**
 * Served from public/icons/ so the app has its mark offline. Until that file is
 * added, both splash screens fall back to the wave mark rather than showing a
 * broken image.
 */
export const APP_ICON_URL = "/icons/icon-512.png";

/**
 * Uses its own `.startup-screen` class rather than `.app-shell`: that shared
 * class declares `position: relative`, which overrides Tailwind's `fixed` and
 * collapses the splash to content height at the top of the page.
 */
export default function StartupScreen() {
  // the icon is fetched remotely, so keep the mark meaningful if it fails
  const [iconFailed, setIconFailed] = useState(false);

  return (
    <main className="startup-screen">
      <section className="startup-mark flex w-full max-w-sm flex-col items-center text-center">
        <div className="startup-orbit startup-icon">
          {iconFailed ? (
            <IconWave width={42} height={42} strokeWidth={1.4} className="text-signal" />
          ) : (
            <img
              src={APP_ICON_URL}
              alt="Echo Voice Camera"
              width={96}
              height={96}
              decoding="async"
              onError={() => setIconFailed(true)}
            />
          )}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <span className="startup-dot h-1.5 w-1.5 rounded-full bg-signal" />
          <span className="startup-dot startup-dot-delay h-1.5 w-1.5 rounded-full bg-signal" />
          <span className="startup-dot startup-dot-delay-2 h-1.5 w-1.5 rounded-full bg-signal" />
        </div>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-faint">Preparing studio</p>
      </section>
    </main>
  );
}
