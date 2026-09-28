/**
 * Studio bumper: the wordmark resolves, then a peacock feather flies in along
 * a curve and its trail settles into an underline.
 *
 * The feather is drawn as inline SVG rather than a bitmap so it stays crisp at
 * any density and survives the single-file build (an external image would be
 * emitted as a separate asset).
 */
import { useState } from "react";
import { APP_ICON_URL } from "./StartupScreen";
import { IconWave } from "./Icons";

const TRAIL = "M 22 116 C 96 150, 236 150, 318 112";

export default function RamyaSplash() {
  // the icon loads remotely, so keep a mark on screen if it cannot be fetched
  const [iconFailed, setIconFailed] = useState(false);

  return (
    <main className="ramya-screen">
      <div className="ramya-stage">
        <div className="ramya-logo">
          {iconFailed ? (
            <IconWave width={34} height={34} strokeWidth={1.4} className="text-signal" />
          ) : (
            <img
              src={APP_ICON_URL}
              alt="Echo Voice Camera"
              width={76}
              height={76}
              decoding="async"
              onError={() => setIconFailed(true)}
            />
          )}
        </div>

        <p className="ramya-kicker">Powered by</p>

        <h1 className="ramya-word" aria-label="Ramya Studios">
          <span className="ramya-word-fill">Ramya</span>
          <span className="ramya-word-fill ramya-word-accent">Studios</span>
        </h1>

        <svg className="ramya-underline" viewBox="0 0 340 170" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="ramyaTrail" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#24f57c" stopOpacity="0" />
              <stop offset="28%" stopColor="#24f57c" />
              <stop offset="70%" stopColor="#57e6ff" />
              <stop offset="100%" stopColor="#8affc4" stopOpacity="0.85" />
            </linearGradient>
            <filter id="ramyaGlow" x="-25%" y="-90%" width="150%" height="280%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* soft halo left behind the feather */}
          <path className="ramya-trail-glow" d={TRAIL} stroke="url(#ramyaTrail)" strokeWidth="7" filter="url(#ramyaGlow)" />
          {/* the crisp underline itself */}
          <path className="ramya-trail" d={TRAIL} stroke="url(#ramyaTrail)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>

        <div className="ramya-feather-orbit">
          <div className="ramya-feather-tilt">
            <PeacockFeather />
          </div>
        </div>
      </div>
    </main>
  );
}

function PeacockFeather() {
  // barbs fan out from the quill; generated so the plume reads as soft filaments
  const barbs = Array.from({ length: 26 }, (_, i) => {
    const t = i / 25;
    const y = 30 + t * 52;
    const spread = Math.sin(t * Math.PI) * 15 + 3;
    const droop = 5 + t * 5;
    return { y, spread, droop, key: i };
  });

  return (
    <svg className="ramya-feather" viewBox="0 0 72 128" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="eyeCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0b1f3d" />
          <stop offset="55%" stopColor="#123a6b" />
          <stop offset="100%" stopColor="#0a2246" />
        </radialGradient>
        <radialGradient id="eyeRing" cx="50%" cy="46%" r="52%">
          <stop offset="55%" stopColor="#1b6fd6" stopOpacity="0" />
          <stop offset="72%" stopColor="#12b6c9" stopOpacity="0.95" />
          <stop offset="88%" stopColor="#24f57c" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#c9a227" stopOpacity="0.75" />
        </radialGradient>
        <linearGradient id="quill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8affc4" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#1b6fd6" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="barb" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#24f57c" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#57e6ff" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* filament plume */}
      <g className="ramya-feather-barbs">
        {barbs.map((b) => (
          <g key={b.key}>
            <path d={`M 36 ${b.y} Q ${36 - b.spread * 0.6} ${b.y + b.droop * 0.5} ${36 - b.spread} ${b.y + b.droop}`} stroke="url(#barb)" strokeWidth="0.9" strokeLinecap="round" />
            <path d={`M 36 ${b.y} Q ${36 + b.spread * 0.6} ${b.y + b.droop * 0.5} ${36 + b.spread} ${b.y + b.droop}`} stroke="url(#barb)" strokeWidth="0.9" strokeLinecap="round" />
          </g>
        ))}
      </g>

      {/* shaft */}
      <path d="M 36 26 L 36 122" stroke="url(#quill)" strokeWidth="1.5" strokeLinecap="round" />

      {/* the eye */}
      <ellipse cx="36" cy="26" rx="19" ry="23" fill="url(#eyeRing)" />
      <ellipse cx="36" cy="27" rx="11.5" ry="14.5" fill="url(#eyeCore)" />
      <ellipse cx="36" cy="26" rx="6" ry="8.5" fill="#05101f" />
      <ellipse cx="33.4" cy="21.5" rx="2.1" ry="3" fill="#8affc4" opacity="0.8" />
    </svg>
  );
}
