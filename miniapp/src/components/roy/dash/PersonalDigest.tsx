"use client";
import { useState, useEffect } from "react";
import { generateDigest } from "@/lib/api";
import { RoyCard, TezisyBlocks } from "../ui";
import { RoyIcon } from "../icons";

// Период дайджеста — персональная настройка (выбирается в Настройки → Дайджест),
// хранится в localStorage. Дефолт 7д = «за неделю». Дашборд читает её здесь.
export function readDigestDays(): number {
  if (typeof window === "undefined") return 7;
  const v = Number(window.localStorage.getItem("roy_digest_days"));
  return v === 14 || v === 30 ? v : 7;
}
export const digestPeriodLabel = (d: number) => (d === 14 ? "за 2 недели" : d === 30 ? "за месяц" : "за неделю");

// Секция персонального дайджеста на главной (под поиском). Генерируется по кнопке
// (≈10 сек, дёргает /digest), результат — тезисами.
export function PersonalDigest({ className }: { className?: string }) {
  const [days, setDays] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => { setDays(readDigestDays()); }, []);

  const generate = async () => {
    setGenerating(true);
    setResult(null);
    try {
      const { text } = await generateDigest(days);
      setResult(text);
    } catch {
      setResult("Не удалось сгенерировать дайджест. Попробуйте ещё раз.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <RoyCard className={`flex flex-col overflow-hidden ${className ?? ""}`}>
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2.5">
          <span className="inline-flex shrink-0 items-center justify-center rounded-[9px]" style={{ width: 28, height: 28, color: "var(--accent-ink)", background: "color-mix(in srgb, var(--accent-ink) 14%, transparent)" }}>
            <RoyIcon name="note" size={16} strokeWidth={2} />
          </span>
          <span className="font-bold text-ink" style={{ fontSize: 15.5, letterSpacing: "-0.01em" }}>Персональный дайджест</span>
        </span>
        <span className="font-mono uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>{digestPeriodLabel(days)}</span>
      </div>

      <div className="space-y-2.5 px-4 py-3">
        {result ? (
          <>
            <div className="max-h-[340px] overflow-y-auto pr-1"><TezisyBlocks text={result} /></div>
            <button onClick={generate} disabled={generating} className="font-semibold text-primary transition-opacity hover:opacity-80 disabled:opacity-60" style={{ fontSize: 12.5 }}>
              {generating ? "Обновляю…" : "↻ Обновить"}
            </button>
          </>
        ) : (
          <button
            onClick={generate}
            disabled={generating}
            className="w-full rounded-[12px] bg-primary py-2.5 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            style={{ fontSize: 14 }}
          >
            {generating ? "Генерирую (~10 сек)…" : `Сгенерировать дайджест ${digestPeriodLabel(days)}`}
          </button>
        )}
      </div>
    </RoyCard>
  );
}
