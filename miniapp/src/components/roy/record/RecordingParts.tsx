"use client";
// Детали экрана записи: живая «дорожка» громкости, таймер, кнопки.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { RoyIcon } from "../icons";
import { useDt } from "../nav";
import { LEVEL_SAMPLES, type RecorderErrorCode } from "@/lib/webRecorder";
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
export function LevelBars({ levels, muted, label, heightClass = "h-28" }: { levels: number[]; muted: boolean; label: string; heightClass?: string }) {
  const padded = [...Array<number>(Math.max(0, LEVEL_SAMPLES - levels.length)).fill(0), ...levels];
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative flex w-full items-center gap-[3px]", heightClass)}
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

type Dt = (ru: string, en: string) => string;

export function errorText(code: RecorderErrorCode, dt: Dt): string {
  switch (code) {
    case "unsupported":
      return dt(
        "Этот браузер не умеет записывать звук (или страница открыта не по защищённому адресу). Откройте Swarm в Safari или Chrome.",
        "This browser can't record audio (or the page isn't served securely). Open Swarm in Safari or Chrome.",
      );
    case "permission-denied":
      return dt(
        "Нет доступа к микрофону. Разрешите его для этого сайта:",
        "Microphone access is blocked. Allow it for this site:",
      );
    case "mic-blocked-site":
      return dt(
        "Доступ к микрофону для этого сайта заблокирован в браузере. Разрешите его:",
        "Microphone access is blocked for this site in your browser. Allow it:",
      );
    case "mic-blocked-os":
      return dt(
        "Браузеру закрыт доступ к микрофону на уровне системы. Откройте его:",
        "Your system is blocking the microphone for this browser. Turn it on:",
      );
    case "no-mic":
      return dt("Микрофон не найден. Подключите его и попробуйте снова.", "No microphone found. Plug one in and try again.");
    case "mic-failed":
      return dt("Не удалось включить микрофон. Закройте другие приложения, которые его используют, и попробуйте снова.", "Couldn't start the microphone. Close other apps that use it and try again.");
    case "not-found":
      return dt("Сервер не нашёл эту запись или она не ваша — досылать некуда. Звук остался на телефоне: его можно закрыть до лучших времён или удалить.", "The server doesn't know this recording or it isn't yours, so there's nowhere to send it. The audio is still on the phone: keep it for later or delete it.");
    case "finished":
      return dt("Эта запись уже завершена на сервере, новые части не принимаются. Звук остался на телефоне.", "This recording was already finished on the server and no longer accepts parts. The audio is still on the phone.");
    case "too-many-open":
      return dt(
        "У вас уже три незавершённые записи. Эта запись сохраняется на телефоне и не потеряется: закончите её, затем откройте «Записать встречу» и выберите «Загрузить и завершить» у старых записей.",
        "You already have three unfinished recordings. This one is kept on the phone and won't be lost: end it, then open Record meeting and choose Upload and finish for the old ones.",
      );
    case "demo":
      return dt("В демо запись встречи недоступна.", "Meeting recording isn't available in the demo.");
    case "rejected":
      return dt("Сервер не принял одну из частей записи.", "The server rejected one of the recording parts.");
    case "too-large":
      return dt("Одна из частей записи слишком большая, сервер её не принял.", "One of the parts was too large for the server.");
    default:
      return dt("Что-то пошло не так.", "Something went wrong.");
  }
}

export function Banner({ tone, children, onClose }: { tone: "warn" | "bad"; children: ReactNode; onClose?: () => void }) {
  const dt = useDt();
  const color = tone === "bad" ? "var(--pri-high)" : "var(--pri-med)";
  return (
    <div role={tone === "bad" ? "alert" : "status"} className="flex w-full items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-ink"
      style={{ fontSize: 13.5, lineHeight: 1.4, borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, background: `color-mix(in srgb, ${color} 12%, var(--background))` }}>
      <RoyIcon name="warn" size={16} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" aria-label={dt("Скрыть", "Dismiss")} onClick={onClose} className="shrink-0 text-ink-mute hover:text-ink">
          <RoyIcon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

