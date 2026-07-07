"use client";
import { useState, useEffect, useCallback } from "react";
import { generateDigest, type AskSource } from "@/lib/api";
import { useRoyNav } from "../nav";
import { RoyCard, TezisyBlocks } from "../ui";
import { RoyIcon } from "../icons";

// Период дайджеста — персональная настройка (Настройки → Дайджест), localStorage. Дефолт 7д.
export function readDigestDays(): number {
  if (typeof window === "undefined") return 7;
  const v = Number(window.localStorage.getItem("roy_digest_days"));
  return v === 14 || v === 30 ? v : 7;
}
export const digestPeriodLabel = (d: number) => (d === 14 ? "за 2 недели" : d === 30 ? "за месяц" : "за неделю");

// Админ-опция «весь воркспейс» (чекбокс в Настройки → Дайджест, localStorage). Для не-админа
// сервер игнорирует флаг. Дефолт выкл — дайджест строго по своим рынкам, как у всех.
export function readDigestAllCountries(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("roy_digest_all_countries") === "1";
}

// Кэш последнего дайджеста, чтобы показывать сразу и авто-обновлять раз в день.
const CACHE_KEY = "roy_digest_cache_v4"; // bump → сброс старого кэша при смене структуры дайджеста (v4: + sources для кликабельных сносок)
type DigestCache = { text: string; at: string; days: number; all: boolean; sources: AskSource[] };
function loadCache(): DigestCache | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}
// Граница «свежести»: сегодняшние 8:00 локально (а до 8:00 — вчерашние). Дайджест старше неё = устарел.
function freshnessBoundary(): number {
  const now = new Date();
  const today8 = new Date(now);
  today8.setHours(8, 0, 0, 0);
  return now.getTime() >= today8.getTime() ? today8.getTime() : today8.getTime() - 86_400_000;
}
function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Секция персонального дайджеста на главной (под поиском). Авто-обновляется раз в день
// (при первом открытии после 8:00) — инфа всегда свежая без ручной кнопки. Строго по странам
// пользователя (фильтрует /digest на сервере).
export function PersonalDigest({ className }: { className?: string }) {
  const { openAnswer, push } = useRoyNav();
  const [days, setDays] = useState(7);
  const [text, setText] = useState<string | null>(null);
  const [sources, setSources] = useState<AskSource[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const run = useCallback(async (d: number) => {
    setGenerating(true);
    try {
      const all = readDigestAllCountries();
      const r = await generateDigest(d, all);
      const now = new Date().toISOString();
      setText(r.text);
      setSources(r.sources);
      setAt(now);
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ text: r.text, at: now, days: d, all, sources: r.sources })); } catch { /* приватный режим */ }
    } catch {
      if (!text) setText("Не удалось обновить дайджест. Попробуйте «Обновить».");
    } finally {
      setGenerating(false);
    }
  }, [text]);

  // Клик по сноске [n] в пункте → открыть исходную запись этого пункта (не новый поиск).
  const openSource = useCallback((n: number) => {
    const s = sources.find((x) => x.n === n);
    if (s) push({ view: "record", params: { id: s.id } });
  }, [sources, push]);

  useEffect(() => {
    const d = readDigestDays();
    setDays(d);
    const cache = loadCache();
    if (cache) { setText(cache.text); setAt(cache.at); setSources(cache.sources ?? []); }
    // Устарел, если кэша нет, сменился период/охват, или последний прогон был до сегодняшних 8:00.
    const stale = !cache || cache.days !== d || cache.all !== readDigestAllCountries() || new Date(cache.at).getTime() < freshnessBoundary();
    if (stale) run(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 py-3">
        {text ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <TezisyBlocks text={text} onSource={openSource} onDeepen={(topic) => openAnswer(`Расскажи подробнее: ${topic}`)} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={() => run(days)} disabled={generating} className="font-semibold text-primary transition-opacity hover:opacity-80 disabled:opacity-60" style={{ fontSize: 12.5 }}>
                {generating ? "Обновляю…" : "↻ Обновить"}
              </button>
              {at && !generating && <span className="font-mono text-ink-mute" style={{ fontSize: 10.5 }}>обновлено {fmtUpdated(at)}</span>}
            </div>
          </>
        ) : generating ? (
          <p className="py-3 text-center text-sm text-ink-soft">Готовлю дайджест {digestPeriodLabel(days)}…</p>
        ) : (
          <button
            onClick={() => run(days)}
            className="w-full rounded-[12px] bg-primary py-2.5 font-semibold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            style={{ fontSize: 14 }}
          >
            Сгенерировать дайджест {digestPeriodLabel(days)}
          </button>
        )}
      </div>
    </RoyCard>
  );
}
