"use client";
import { useEffect, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { fetchConfig, patchMe } from "@/lib/api";
import { countryFlag, countryName } from "@/lib/countries";

// Подборка «Мои страны» — часть настройки главной (решение владельца 07.10.2026: «настройки стран
// в настройки главной давай запихнем»). Это те же рынки, что в профиле и в охвате дайджеста
// (user_profiles.markets): сохраняются сразу по клику, отказ откатывает выбор.

export function CountryEditor({ markets, onMarkets }: { markets: string[]; onMarkets: (next: string[]) => void }) {
  const dt = useDt();
  const { toast } = useRoyNav();
  const [allowed, setAllowed] = useState<string[] | null>(null);

  useEffect(() => {
    fetchConfig().then((c) => setAllowed(c.allowed_markets)).catch((e) => { console.warn("[home] config", e); setAllowed([]); });
  }, []);

  const toggle = async (cc: string) => {
    const prev = markets;
    const next = markets.includes(cc) ? markets.filter((x) => x !== cc) : [...markets, cc];
    onMarkets(next);
    try {
      await patchMe({ markets: next });
    } catch (e) {
      onMarkets(prev);
      toast(dt("Не удалось сохранить подборку стран", "Couldn't save your countries"));
      console.warn("[home] markets", e);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-semibold text-ink" style={{ fontSize: 12.5 }}>{dt("Мои страны:", "My countries:")}</span>
      {allowed == null && <span className="roy-shim inline-block h-7 w-48 rounded-full" />}
      {(allowed ?? []).map((cc) => {
        const on = markets.includes(cc);
        return (
          <button key={cc} type="button" onClick={() => void toggle(cc)} aria-pressed={on}
            className={`rounded-full border px-2.5 py-1 transition-colors ${on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-line-2 text-ink-mute hover:border-accent-line hover:text-ink"}`}
            style={{ fontSize: 12 }}>
            {countryFlag(cc)} {dt(countryName(cc), cc)}
          </button>
        );
      })}
      <span className="ml-1 text-ink-mute" style={{ fontSize: 11.5 }}>{dt("метрики главной и дайджест считаются по ним", "home metrics and your digest use these")}</span>
    </div>
  );
}

/** Сужение до одной страны (клик в «Моих странах») — видно над сеткой, пока включено. */
export function NarrowChip({ cc, onClear }: { cc: string; onClear: () => void }) {
  const dt = useDt();
  return (
    <div className="px-6 pt-3">
      <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-background" style={{ fontSize: 12 }}>
        {countryFlag(cc)} {dt(`Только ${countryName(cc)}`, `Only ${cc}`)}
        <button type="button" onClick={onClear} aria-label={dt("Показать все мои страны", "Show all my countries")} className="ml-1 opacity-70 hover:opacity-100">×</button>
      </span>
    </div>
  );
}
