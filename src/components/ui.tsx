import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Section({
  icon,
  title,
  subtitle,
  right,
  children,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-ink-900 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {icon && <span className="mt-0.5 text-amber">{icon}</span>}
          <div>
            <h3 className="font-display text-[13px] font-bold uppercase tracking-[0.13em] text-paper">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-dim">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-dim">{label}</span>
        <span className="tnum font-mono text-sm font-medium text-paper">
          {format ? format(value) : `${value}${unit}`}
        </span>
      </div>
      <input
        type="range"
        className="rslider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        style={{ "--val": `${pct}%`, "--fill": "#24f57c" } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function ChipRow({
  items,
  activeId,
  onSelect,
}: {
  items: { id: string; label: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onSelect(it.id)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            activeId === it.id
              ? "border-amber bg-amber/10 text-amber"
              : "border-line bg-ink-850 text-dim hover:border-faint hover:text-paper",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function GhostButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-dim transition-colors hover:border-faint hover:text-paper active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
      <div
        className="h-full rounded-full bg-amber transition-[width] duration-200"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-line bg-ink-850 px-2.5 py-1 text-[11px] font-medium text-dim",
        className,
      )}
    >
      {children}
    </span>
  );
}
