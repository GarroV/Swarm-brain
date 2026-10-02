"use client";
// Общие куски экрана «Анализ рынка»: рамка секции с подписью источника и свежести.
// Подпись обязательна у каждого блока (спека §«Источник у каждого блока»): цифра без
// источника и даты читается как факт, а она может быть ручной заливкой полугодовой давности.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { MarketBundle, MarketSource } from "@/types";
import { useDt, useLang } from "@/components/roy/nav";
import { fmtMoney } from "@/lib/marketView";

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

export function SourceCaption({ bundle, feeds }: { bundle: MarketBundle; feeds: MarketSource["feeds"] | Array<MarketSource["feeds"]> }) {
  const dt = useDt();
  const want = Array.isArray(feeds) ? feeds : [feeds];
  // Один и тот же источник (ручная заливка) кормит несколько тем — в подписи он один раз.
  const own = bundle.sources.filter((s, i, all) => want.includes(s.feeds) && all.findIndex((o) => want.includes(o.feeds) && o.adapter === s.adapter && o.chain_key === s.chain_key) === i);
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

/** Деньги на языке интерфейса — один форматтер на все блоки раздела. */
export function useMoney(): (v: number | null) => string {
  const ru = useLang() === "ru";
  return (v) => fmtMoney(v, ru);
}

/** Первая http(s)-ссылка в строке источника («ESTIMATE from https://…») — иначе null. */
export const firstUrl = (s: string | null): string | null => s?.match(/https?:\/\/[^\s;,)]+/)?.[0] ?? null;
/** Подпись источника для людей: домен, а не полный адрес. */
export const sourceLabel = (s: string | null): string | null => {
  const u = firstUrl(s);
  // Без ссылки — это пометка ресерча («ESTIMATE from … figures above»), а не источник.
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Карточка цифры факта — одна на «Рынок доставки» и «Выручки операторов». */
export function FactTile({ card }: { card: { head: string; more: string | null; text: string; date: string | null; source: string | null } }) {
  const url = firstUrl(card.source);
  const label = sourceLabel(card.source);
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="font-semibold text-ink" style={{ fontSize: 16, lineHeight: 1.25 }}>{card.head}</div>
      {card.more && <div className="mt-0.5 text-ink-soft" style={{ fontSize: 12 }}>{card.more}</div>}
      <div className="mt-1.5 line-clamp-3 text-ink-soft" style={{ fontSize: 12.5, lineHeight: 1.45 }} title={card.text}>{card.text}</div>
      <div className="mt-1.5 text-ink-mute" style={{ fontSize: 11.5 }}>
        {card.date && <span style={mono}>{card.date}</span>}
        {label && (
          <>
            {card.date && " · "}
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">{label}</a> : label}
          </>
        )}
      </div>
    </div>
  );
}

/** Таблица шире экрана: прокрутка по горизонтали с тенью у края, пока справа есть что
 *  смотреть, — иначе на телефоне обрезанная колонка выглядит как вся таблица. */
export function ScrollX({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);
  return (
    <div className="relative">
      <div ref={ref} className={`overflow-x-auto rounded-lg border border-line ${className}`}>{children}</div>
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-px right-px w-8 rounded-r-lg"
          style={{ background: "linear-gradient(to right, transparent, var(--surface))" }}
        />
      )}
    </div>
  );
}

/** Ширина элемента в пикселях (0 до первого замера) — для графиков, чей viewBox = ширине.
 *  Реф-колбэк: элемент может появиться позже первого рендера (сначала пустое состояние). */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.current.observe(el);
  }, []);
  return [ref, w];
}
