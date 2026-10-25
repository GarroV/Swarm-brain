"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDt } from "../nav";
import { RkoWidget, RsWidget } from "./QualityWidgets";
import { MapsTab } from "./MapsTab";
import { AggregatorsTab } from "./AggregatorsTab";
import { FILL } from "./blockFill";
import type { CountryQuality, QualityModel } from "@/lib/homeQuality";

// Единый блок «Рейтинги» (владелец 19.10.2026, docs/decisions/2026-10-19-home-ratings-tabs.md): вкладки
// РС · РКО · Карты · Агрегаторы, при переключении перестраивается всё тело. Выбранная вкладка помнится
// на устройстве. «Мои страны» применяются к каждой вкладке.

export const RATINGS_TABS = ["rs", "rko", "maps", "aggregators"] as const;
export type RatingsTab = (typeof RATINGS_TABS)[number];
const LABELS: Record<RatingsTab, [string, string]> = {
  rs: ["РС", "Standards"], rko: ["РКО", "CX"], maps: ["Карты", "Maps"], aggregators: ["Агрегаторы", "Delivery apps"],
};
const LS_KEY = "roy_home_ratings_tab";

function loadTab(): RatingsTab {
  try {
    const v = localStorage.getItem(LS_KEY);
    if ((RATINGS_TABS as readonly string[]).includes(v ?? "")) return v as RatingsTab;
  } catch { /* приватное окно — вкладка по умолчанию */ }
  return "rs";
}

type Props = {
  codes: string[];
  q: QualityModel | null;
  scope: CountryQuality[];
  /** Заглушка баллов РС/РКО (загрузка, ошибка, «ещё нет») — вместо тела этих двух вкладок. */
  qualityGate: ReactNode;
};

export function RatingsWidget({ codes, q, scope, qualityGate }: Props) {
  const dt = useDt();
  const lang = dt("ru", "en") === "en" ? 1 : 0;
  const [tab, setTab] = useState<RatingsTab>("rs");
  const refs = useRef<Partial<Record<RatingsTab, HTMLButtonElement | null>>>({});
  // Читается после монтирования: экспорт статический, на сборке localStorage нет.
  useEffect(() => { setTab(loadTab()); }, []);

  const select = (next: RatingsTab, focus = false) => {
    setTab(next);
    try { localStorage.setItem(LS_KEY, next); } catch { /* не запомнили — вкладка уже переключена */ }
    if (focus) refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = RATINGS_TABS.indexOf(tab);
    const last = RATINGS_TABS.length - 1;
    const to = e.key === "ArrowRight" ? (i + 1) % RATINGS_TABS.length : e.key === "ArrowLeft" ? (i + last) % RATINGS_TABS.length
      : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    select(RATINGS_TABS[to], true);
  };

  const body = ((): ReactNode => {
    if (tab === "rs") return qualityGate ?? (q && <RsWidget q={q} scope={scope} />);
    if (tab === "rko") return qualityGate ?? (q && <RkoWidget q={q} scope={scope} />);
    if (tab === "maps") return <MapsTab codes={codes} />;
    return <AggregatorsTab codes={codes} />;
  })();

  // Одна карточка (владелец 25.10.2026: «сделай вот эту часть полноценным блоком»): вкладки — шапка
  // карточки, тело — под ними. Свою рамку и подложку тела вкладок здесь гасим, чтобы не было рамки в рамке.
  return (
    <div className={`flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface ${FILL}`}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <div role="tablist" aria-label={dt("Рейтинги", "Ratings")} onKeyDown={onKey}
          className="flex min-w-0 gap-1 overflow-x-auto rounded-[10px] border border-line bg-surface-2 p-0.5">
          {RATINGS_TABS.map((t) => (
            <button key={t} type="button" role="tab" id={`ratings-tab-${t}`} aria-selected={tab === t} aria-controls="ratings-panel"
              tabIndex={tab === t ? 0 : -1} ref={(el) => { refs.current[t] = el; }} onClick={() => select(t)}
              className={`whitespace-nowrap rounded-[8px] px-3 py-1.5 font-semibold transition-colors ${tab === t ? "bg-surface text-primary shadow-sm" : "text-ink-soft hover:text-ink"}`}
              style={{ fontSize: 12.5 }}>
              {LABELS[t][lang]}
            </button>
          ))}
        </div>
        {(tab === "maps" || tab === "aggregators") && (
          <p className="text-ink-mute" style={{ fontSize: 11.5 }}>{dt("на сегодня, сравнение с 30 днями назад", "as of today, compared with 30 days ago")}</p>
        )}
      </div>
      <div role="tabpanel" id="ratings-panel" aria-labelledby={`ratings-tab-${tab}`} tabIndex={0}
        className="flex min-h-0 flex-auto flex-col [&>*]:rounded-none [&>*]:border-0 [&>*]:bg-transparent">{body}</div>
    </div>
  );
}
