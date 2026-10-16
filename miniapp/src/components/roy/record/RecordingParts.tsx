"use client";
// Детали экрана записи: живая «дорожка» громкости, таймер, кнопки.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LEVEL_SAMPLES } from "@/lib/webRecorder";
import { cn } from "@/lib/utils";

/** 3725 → «1:02:05», 125 → «02:05». */
export function formatClock(totalSec: number): string {
  const sec = Math.floor(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec / 60) % 60;
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** «14 с», «2 мин 5 с» — для плашек о прерываниях. */
export function formatSpan(sec: number, dt: (ru: string, en: string) => string): string {
  const s = Math.max(1, Math.round(sec));
  if (s < 60) return dt(`${s} с`, `${s} s`);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? dt(`${m} мин ${rest} с`, `${m} min ${rest} s`) : dt(`${m} мин`, `${m} min`);
}

/**
 * Ряд тонких столбиков — последние ~6 секунд звука, новое справа. Это и есть главный
 * «прибор» экрана: по нему видно, что микрофон слышит комнату. Заглушённый трек — ровная
 * пунктирная линия вместо столбиков.
 */
export function LevelBars({ levels, muted, label }: { levels: number[]; muted: boolean; label: string }) {
  const padded = [...Array<number>(Math.max(0, LEVEL_SAMPLES - levels.length)).fill(0), ...levels];
  return (
    <div
      role="img"
      aria-label={label}
      className="relative flex h-28 w-full items-center gap-[3px]"
      style={{ maskImage: "linear-gradient(90deg, transparent 0%, #000 30%)", WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 30%)" }}
    >
      {muted ? (
        <div className="w-full border-t-2 border-dashed border-line-2" />
      ) : (
        padded.map((v, i) => {
          const recent = i >= padded.length - 4;
          return (
            <span
              key={i}
              className="min-w-0 flex-1 rounded-full transition-[height] duration-100 ease-linear"
              style={{
                height: `${Math.max(3, Math.round(v * 100))}%`,
                background: recent && v > 0.04 ? "var(--pri-high)" : "var(--ink-soft)",
                opacity: 0.3 + 0.7 * (i / padded.length),
              }}
            />
          );
        })
      )}
    </div>
  );
}

type BtnTone = "primary" | "danger" | "quiet";
const TONE: Record<BtnTone, string> = {
  primary: "bg-primary text-primary-foreground",
  danger: "text-white",
  quiet: "border border-line-2 bg-surface text-ink",
};

export function RecButton({ tone = "quiet", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; children: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 font-semibold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:opacity-80 disabled:opacity-50",
        TONE[tone],
        className,
      )}
      style={{ fontSize: 15, ...(tone === "danger" ? { background: "var(--pri-high)" } : null), ...rest.style }}
    >
      {children}
    </button>
  );
}
