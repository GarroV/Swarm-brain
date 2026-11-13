"use client";
// Рынки задачи одним тегом: коды через « · », больше трёх — «HU · RS +2» (#1262). Тот же вид,
// что у `Market` (одна страна у встреч), чтобы строка не пестрела разными чипами.
import { countriesLabel, countriesTitle, taskCountryCodes, type CountriesCarrier } from "@/lib/countries";

export function TaskMarkets({ task }: { task: CountriesCarrier }) {
  const codes = taskCountryCodes(task);
  if (codes.length === 0) return null;
  return (
    <span
      title={countriesTitle(codes)}
      className="inline-flex items-center font-semibold whitespace-nowrap uppercase tracking-wide text-ink-soft bg-surface-2 border border-line-2"
      style={{ fontSize: 10.5, borderRadius: 6, padding: "1px 6px" }}
    >
      {countriesLabel(codes)}
    </span>
  );
}
