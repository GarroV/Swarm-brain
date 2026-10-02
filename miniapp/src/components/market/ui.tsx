"use client";
// Общие куски экрана «Анализ рынка»: рамка секции с подписью источника и свежести.
// Подпись обязательна у каждого блока (спека §«Источник у каждого блока»): цифра без
// источника и даты читается как факт, а она может быть ручной заливкой полугодовой давности.
import type { ReactNode } from "react";
import type { MarketBundle, MarketSource } from "@/types";
import { useDt } from "@/components/roy/nav";

export type Dt = (ru: string, en: string) => string;

const ADAPTER_NAME: Record<string, [string, string]> = {
  "dodo-publicapi": ["публичный API Dodo", "Dodo public API"],
  "osm-overpass": ["OpenStreetMap", "OpenStreetMap"],
  "ee-ariregister": ["реестр Эстонии (ariregister)", "Estonian e-Business Register"],
  "ro-datagov": ["data.gov.ro (Минфин Румынии)", "data.gov.ro (Romanian MoF)"],
  manual: ["ручная заливка", "manual upload"],
};
export const adapterName = (dt: Dt, id: string): string => {
  const n = ADAPTER_NAME[id];
  return n ? dt(n[0], n[1]) : id;
};

export function daysAgo(dt: Dt, iso: string | null): string {
  if (!iso) return dt("ещё не обновлялось", "never updated");
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (d <= 0) return dt("сегодня", "today");
  return dt(`${d} дн. назад`, `${d}d ago`);
}

export function SourceCaption({ bundle, feeds }: { bundle: MarketBundle; feeds: MarketSource["feeds"] }) {
  const dt = useDt();
  const own = bundle.sources.filter((s) => s.feeds === feeds);
  if (!own.length) return null;
  return (
    <p className="mt-3 text-ink-mute" style={{ fontSize: 12 }}>
      {dt("Источник: ", "Source: ")}
      {own.map((s, i) => (
        <span key={`${s.adapter}:${s.chain_key}`}>
          {i > 0 && " · "}
          {adapterName(dt, s.adapter)}
          {s.mode === "blocked" || (s.mode === "manual" && s.reason)
            ? ` (${s.reason ?? dt("закрыт", "unavailable")})`
            : ` — ${daysAgo(dt, s.last_ok_at)}`}
        </span>
      ))}
    </p>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink" style={{ fontSize: 15, letterSpacing: "-0.01em" }}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="text-ink-mute" style={{ fontSize: 13 }}>{text}</p>;
}

export function Chip(
  { active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color?: string },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
        active ? "border-accent-line bg-accent-soft text-accent-ink" : "border-line text-ink-soft hover:bg-surface-2"
      }`}
      style={{ fontSize: 12 }}
    >
      {color && <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

export const mono = { fontFamily: "var(--font-geist-mono), ui-monospace, monospace" } as const;
