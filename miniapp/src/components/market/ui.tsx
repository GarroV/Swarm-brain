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
/** CompanyWall везде один, а данные за ним — реестр своей страны. */
const COMPANYWALL: Record<string, [string, string]> = {
  RS: ["CompanyWall (данные APR Сербии)", "CompanyWall (Serbian APR data)"],
  SI: ["CompanyWall (данные AJPES Словении)", "CompanyWall (Slovenian AJPES data)"],
  ME: ["CompanyWall (данные налоговой Черногории)", "CompanyWall (Montenegrin tax office data)"],
};
export const adapterName = (dt: Dt, id: string, country?: string): string => {
  const n = id === "companywall"
    ? COMPANYWALL[country ?? ""] ?? ["CompanyWall", "CompanyWall"]
    : ADAPTER_NAME[id];
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
  const own = bundle.sources.filter((s) => want.includes(s.feeds));
  // Один и тот же источник кормит несколько тем (ручная заливка, API Dodo) — в подписи он один раз.
  const parts = [...new Set(own.map((s) =>
    adapterName(dt, s.adapter, bundle.country) +
    (s.mode === "blocked" || (s.mode === "manual" && s.reason) ? ` (${s.reason ?? dt("закрыт", "unavailable")})` : ` — ${daysAgo(dt, s.last_ok_at)}`)
  ))];
  if (!parts.length) return null;
  return (
    <p className="small">
      {dt("Источник: ", "Source: ")}
      {parts.join(" · ")}
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
