"use client";
// Каркас эталона для блоков «Анализа рынка»: секция с надзаголовком и подзаголовком,
// всплывающая подсказка, цвета сетей по слотам и даты в формате эталона. Разметка и классы —
// из хорватского отчёта (стили в market.css, всё внутри корня .mkt).
import { createContext, type PointerEvent, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { MarketBundle } from "@/types";
import { chainSlots } from "@/lib/marketMap";
import { type Editorial, parseEditorial } from "@/lib/marketEditorial";

export function useEditorial(bundle: MarketBundle): Editorial {
  return useMemo(() => parseEditorial(bundle.editorial), [bundle.editorial]);
}

/** Цвет сети как в эталоне: var(--s<слот>). Международные сети — всегда своим слотом (Dodo
 *  оранжевый в любой стране), остальные — слотом из справочника, если он не занят, иначе по числу точек
 *  (раздача — chainSlots). */
export function useChainColor(bundle: MarketBundle): (key: string) => string {
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of bundle.locations) counts.set(l.chain_key, (counts.get(l.chain_key) ?? 0) + 1);
    const slot = chainSlots(bundle.chains, counts);
    return (key: string) => `var(--s${slot.get(key) ?? 0})`;
  }, [bundle.chains, bundle.locations]);
}

/** Сети в порядке эталона: сначала не пекарни, потом по слоту, потом по имени. */
export function useChainOrder(bundle: MarketBundle): MarketBundle["chains"] {
  return useMemo(
    () => bundle.chains.slice().sort((a, b) => Number(a.is_bakery) - Number(b.is_bakery) || (a.slot || 99) - (b.slot || 99) || a.name.localeCompare(b.name)),
    [bundle.chains],
  );
}

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthShort = (m: number, ru: boolean): string => (ru ? MONTHS_RU : MONTHS_EN)[m - 1] ?? "";

/** «12 мар 2024» / «мар 2024» / «2024» — как fmtDate эталона. */
export function fmtDate(s: string | null | undefined, ru: boolean): string {
  if (!s) return "—";
  const m = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return s;
  if (m[3]) return `${+m[3]} ${monthShort(+m[2], ru)} ${m[1]}`;
  if (m[2]) return `${monthShort(+m[2], ru)} ${m[1]}`;
  return m[1];
}

/** Число с запятой по-русски: 9,90. */
export const dec = (v: number, digits: number, ru: boolean): string => (ru ? v.toFixed(digits).replace(".", ",") : v.toFixed(digits));
export const intFmt = (v: number, ru: boolean): string => Math.round(v).toLocaleString(ru ? "ru" : "en");

export function RefSection(
  { id, eyebrow, title, lede, children }: { id: string; eyebrow: string; title: string; lede?: ReactNode; children: ReactNode },
) {
  return (
    <section id={id}>
      <div className="sec-head">
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

/** Подпись цветом сети — кружок из легенды эталона. */
export function Sw({ color, round = true, inline = false }: { color: string; round?: boolean; inline?: boolean }) {
  return (
    <i
      className="sw"
      style={{ background: color, borderColor: color, borderRadius: round ? undefined : 2, display: inline ? "inline-block" : undefined, marginRight: inline ? 6 : undefined }}
    />
  );
}

type Tip = { show: (content: ReactNode, e: PointerEvent | { clientX: number; clientY: number }) => void; hide: () => void };
const TipContext = createContext<Tip>({ show: () => {}, hide: () => {} });
export const useTip = (): Tip => useContext(TipContext);

const TIP_PAD = 14;

/** Одна подсказка на страницу, как #tip эталона: у курсора, не вылезает за край окна. */
export function TipProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const show = useCallback<Tip["show"]>((c, e) => {
    setContent(c);
    const r = box.current?.getBoundingClientRect();
    const w = r?.width ?? 220, h = r?.height ?? 80;
    let x = e.clientX + TIP_PAD, y = e.clientY + TIP_PAD;
    if (x + w > innerWidth - 8) x = e.clientX - w - TIP_PAD;
    if (y + h > innerHeight - 8) y = e.clientY - h - TIP_PAD;
    setPos({ x, y });
  }, []);
  const hide = useCallback(() => setContent(null), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <TipContext.Provider value={api}>
      {children}
      <div ref={box} className="tip" hidden={content === null} style={{ left: pos.x, top: pos.y }}>{content}</div>
    </TipContext.Provider>
  );
}
