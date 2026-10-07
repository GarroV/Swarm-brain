"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useDt, useRoyNav } from "../nav";
import { HomeLabel } from "../dash/shared";
import type { DashboardData } from "../dash/useDashboardData";
import { MeetingsToday } from "../dash/MeetingsToday";
import { HomeNews, LatestInBase } from "../dash/HomeSide";
import { CountryEditor, NarrowChip } from "./CountryEditor";
import { HomeTasksWidget, TeamTasksWidget } from "./TaskWidgets";
import { BoardWidget, MapsSoonWidget, SalesWidget, TopTasksWidget } from "./MiscWidgets";
import { RkoWidget, RsWidget, SampleTag, ViolationsWidget } from "./QualityWidgets";
import { AttentionWidget, CountriesWidget, PizzeriasWidget } from "./TableWidgets";
import { useCountrySales } from "./useCountrySales";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { COUNTRY_NAMES } from "@/lib/countries";
import { countrySample } from "@/lib/homeQualitySample";
import {
  addWidget, DEFAULT_LAYOUT, hideWidget, loadLayout, moveBefore, moveBy, saveLayout, toggleWidth,
  WIDGET_IDS, DEFAULT_WIDTH, type LayoutItem, type WidgetId,
} from "@/lib/homeLayout";

// Главная из виджетов (decisions/2026-10-07-home-dashboard-direction.md). Каждый собирает её сам:
// «Настроить главную» → перетащить, ↑↓, ширина ½ / вся строка, скрыть, добавить из каталога.

type Meta = { title: [string, string]; hint: [string, string]; ownTitle?: boolean; sample?: boolean; meta?: [string, string] };
const META: Record<WidgetId, Meta> = {
  calls: { title: ["Созвоны сегодня", "Today's calls"], hint: ["Встречи дня из календаря и кнопка «подключиться».", "Today's meetings from your calendar with a join button."], ownTitle: true },
  top5: { title: ["Ближайшие задачи", "Next tasks"], hint: ["Пять моих задач с ближайшим сроком.", "My five tasks with the nearest due date."], meta: ["топ-5 по сроку", "top 5 by due date"] },
  board: { title: ["Доска", "Board"], hint: ["Стикеры-задания (OKR, дайджест, вычитка) и объявления админа.", "Task stickers (OKRs, digest, review) and admin notices."], meta: ["что от тебя ждут", "what's expected of you"] },
  rs: { title: ["Стандарты · РС", "Standards"], hint: ["Балл по волнам, критическая зона, собираемость инспектором.", "Score by wave, critical zone, inspector coverage."], sample: true },
  rko: { title: ["Клиентский опыт · РКО", "Customer experience"], hint: ["Балл по неделям и отчёты гостей.", "Weekly score and guest reports."], sample: true },
  pz: { title: ["Пиццерии", "Pizzerias"], hint: ["Все пиццерии подборки: РС, РКО, отчёты, худшие сверху.", "Every pizzeria in your selection, worst first."], sample: true, meta: ["худшие сверху", "worst first"] },
  att: { title: ["Куда смотреть", "Needs attention"], hint: ["Сигналы по порогам в моих странах.", "Threshold alerts in my countries."], sample: true },
  countries: { title: ["Мои страны", "My countries"], hint: ["Сводка по странам подборки; клик сужает главную.", "Per-country summary; click to focus."], sample: true },
  viol: { title: ["Топ-5 нарушений", "Top 5 violations"], hint: ["Самые частые нарушения стандартов в волне.", "Most frequent standards violations this wave."], sample: true },
  sales: { title: ["Продажи Dodo", "Dodo sales"], hint: ["Выручка моих стран по месяцам — данные «Анализа рынка».", "Monthly revenue of my countries from Market analysis."], meta: ["публичный API Dodo", "Dodo public API"] },
  maps: { title: ["Карты и отзывы", "Maps & reviews"], hint: ["Рейтинги Google и Яндекса, отзывы. Заработает с Pointer.", "Google and Yandex ratings, reviews. Arrives with Pointer."], meta: ["Pointer · ждём ключ", "Pointer · awaiting key"] },
  myTasks: { title: ["Мои задачи", "My tasks"], hint: ["Полная таблица: просрочено, сегодня, дальше, без срока.", "Full table: overdue, today, later, no date."] },
  teamTasks: { title: ["Задачи команды", "Team tasks"], hint: ["Общие задачи без исполнителя.", "Shared tasks with no owner."] },
  news: { title: ["Новости", "News"], hint: ["Комментарии, чекпоинты, встречи на вычитке.", "Comments, checkpoints, meetings to review."], ownTitle: true },
  latest: { title: ["Последнее в базе", "Latest in the base"], hint: ["Свежие записи и встречи базы знаний.", "Fresh entries and meetings in the knowledge base."], ownTitle: true },
};

type Props = { data: DashboardData; onCreateTask: () => void; editing: boolean; onEditing: (v: boolean) => void };

export function HomeGrid({ data, onCreateTask, editing, onEditing: setEditing }: Props) {
  const dt = useDt();
  const lang = dt("ru", "en") === "en" ? 1 : 0;
  const { me, setTab } = useRoyNav();
  const [layout, setLayoutState] = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const [gallery, setGallery] = useState(false);
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const [overId, setOverId] = useState<WidgetId | null>(null);
  const [markets, setMarkets] = useState<string[]>(me?.markets ?? []);
  const [narrow, setNarrow] = useState<string | null>(null);

  // Раскладка читается после монтирования: экспорт статический, на сборке localStorage нет.
  useEffect(() => { setLayoutState(loadLayout()); }, []);
  useEffect(() => { setMarkets(me?.markets ?? []); }, [me?.markets]);
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !gallery) setEditing(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, gallery]);

  const setLayout = (next: LayoutItem[]) => { setLayoutState(next); saveLayout(next); };
  const codes = narrow && markets.includes(narrow) ? [narrow] : markets;
  const scope = useMemo(() => codes.map(countrySample), [codes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const imf = useMemo(() => Object.keys(COUNTRY_NAMES).map(countrySample), []);
  const sales = useCountrySales(markets);

  const body = (id: WidgetId): ReactNode => {
    if (!codes.length && META[id].sample) {
      return <div className="rounded-[12px] border border-dashed border-line-2 px-4 py-6 text-center text-ink-mute" style={{ fontSize: 13 }}>{dt("Выберите свои страны в «Настроить главную» — метрики считаются по ним", "Pick your countries in “Customize home” — metrics are scoped to them")}</div>;
    }
    switch (id) {
      case "calls": return <MeetingsToday flat first flatBody="overflow-hidden rounded-[12px] border border-line bg-surface p-1.5" />;
      case "top5": return <TopTasksWidget data={data} onCreate={onCreateTask} />;
      case "board": return <BoardWidget data={data} />;
      case "rs": return <RsWidget scope={scope} imf={imf} />;
      case "rko": return <RkoWidget scope={scope} imf={imf} />;
      case "pz": return <PizzeriasWidget scope={scope} />;
      case "att": return <AttentionWidget scope={scope} />;
      case "countries": return <CountriesWidget scope={markets.map(countrySample)} sales={sales} narrow={narrow} onNarrow={setNarrow} onMarket={() => setTab("market")} />;
      case "viol": return <ViolationsWidget scope={scope} />;
      case "sales": return <SalesWidget codes={codes} sales={sales} />;
      case "maps": return <MapsSoonWidget />;
      case "myTasks": return <HomeTasksWidget data={data} />;
      case "teamTasks": return <TeamTasksWidget data={data} />;
      case "news": return <HomeNews data={data} now={new Date()} />;
      case "latest": return <LatestInBase data={data} />;
    }
  };

  const drop = (target: WidgetId) => {
    if (dragId) setLayout(moveBefore(layout, dragId, target));
    setDragId(null); setOverId(null);
  };

  return (
    <div className="min-w-0 pb-8">
      {narrow && !editing && <NarrowChip cc={narrow} onClear={() => setNarrow(null)} />}

      {editing && (
        <div className="sticky top-0 z-20 mx-6 mt-3 flex flex-col gap-2.5 rounded-[12px] border border-accent-line bg-accent-soft px-4 py-3 shadow-sm" style={{ fontSize: 13 }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-ink"><b>{dt("Настройка главной.", "Customizing home.")}</b> {dt("Перетащите виджеты за ⠿, меняйте ширину, скрывайте лишнее. Раскладка — только ваша.", "Drag widgets by ⠿, change width, hide what you don't need. The layout is yours only.")}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setGallery(true)} className="rounded-[8px] border border-line-2 bg-surface px-3 py-1.5 font-semibold">{dt("+ Добавить виджет", "+ Add widget")}</button>
            <button type="button" onClick={() => setLayout(DEFAULT_LAYOUT)} className="rounded-[8px] border border-line-2 bg-surface px-3 py-1.5 font-semibold">{dt("Как было по умолчанию", "Reset to default")}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-[8px] bg-primary px-3 py-1.5 font-semibold text-primary-foreground">{dt("Готово", "Done")}</button>
          </div>
          </div>
          <div className="border-t border-accent-line pt-2.5">
            <CountryEditor markets={markets} onMarkets={(m) => { setMarkets(m); if (narrow && !m.includes(narrow)) setNarrow(null); }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-5 gap-y-2 px-6 pt-1 min-[1100px]:grid-cols-2">
        {layout.map((it, i) => {
          const m = META[it.id];
          return (
            <section key={it.id} data-widget={it.id}
              className={`relative min-w-0 rounded-[14px] transition-opacity ${it.w === "full" ? "min-[1100px]:col-span-2" : ""} ${editing ? "cursor-grab outline-2 outline-offset-4 outline-dashed outline-line-2 hover:outline-accent-line" : ""} ${dragId === it.id ? "opacity-40" : ""} ${overId === it.id && dragId !== it.id ? "outline-primary" : ""}`}
              draggable={editing}
              onDragStart={(e) => { setDragId(it.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", it.id); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => { if (!editing || !dragId) return; e.preventDefault(); setOverId(it.id); }}
              onDrop={(e) => { e.preventDefault(); drop(it.id); }}>
              {editing && (
                <div className="absolute right-0 top-2 z-10 flex gap-0.5 rounded-[10px] border border-line-2 bg-surface p-0.5 shadow-md" style={{ fontSize: 12 }}>
                  <span className="cursor-grab px-2 py-1 text-ink-mute" aria-hidden="true">⠿</span>
                  <ToolBtn label={dt("Выше", "Up")} disabled={i === 0} onClick={() => setLayout(moveBy(layout, it.id, -1))}>↑</ToolBtn>
                  <ToolBtn label={dt("Ниже", "Down")} disabled={i === layout.length - 1} onClick={() => setLayout(moveBy(layout, it.id, 1))}>↓</ToolBtn>
                  <span className="max-[1099px]:hidden"><ToolBtn label={dt("Ширина", "Width")} onClick={() => setLayout(toggleWidth(layout, it.id))}>{it.w === "full" ? dt("½ ширины", "½ width") : dt("Вся строка", "Full row")}</ToolBtn></span>
                  <ToolBtn label={dt(`Скрыть «${m.title[0]}»`, `Hide “${m.title[1]}”`)} onClick={() => setLayout(hideWidget(layout, it.id))}>{dt("Скрыть ×", "Hide ×")}</ToolBtn>
                </div>
              )}
              <div className={editing ? "pointer-events-none select-none" : ""}>
                {!m.ownTitle && (
                  <HomeLabel first action={undefined}>
                    <span className="inline-flex items-center gap-2">{m.title[lang]}{m.meta && <span className="font-normal normal-case tracking-normal text-ink-mute">{m.meta[lang]}</span>}{m.sample && <SampleTag />}</span>
                  </HomeLabel>
                )}
                {body(it.id)}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={gallery} onOpenChange={setGallery}>
        <DialogContent className="max-w-[640px]">
          <DialogTitle>{dt("Добавить виджет", "Add widget")}</DialogTitle>
          <div className="grid max-h-[60vh] grid-cols-1 gap-2.5 overflow-auto sm:grid-cols-2">
            {WIDGET_IDS.map((id) => {
              const on = layout.some((x) => x.id === id);
              return (
                <div key={id} className={`flex flex-col gap-1.5 rounded-[10px] border border-line-2 p-3 ${on ? "opacity-55" : ""}`}>
                  <b className="text-ink" style={{ fontSize: 14 }}>{META[id].title[lang]}</b>
                  <p className="flex-1 text-ink-soft" style={{ fontSize: 12, lineHeight: 1.4 }}>{META[id].hint[lang]}</p>
                  <div className="flex items-center justify-between gap-2 text-ink-mute" style={{ fontSize: 11 }}>
                    <span>{DEFAULT_WIDTH[id] === "full" ? dt("на всю строку", "full row") : dt("½ строки", "½ row")}</span>
                    {on ? <span>{dt("уже на главной", "already on home")}</span> : (
                      <button type="button" onClick={() => setLayout(addWidget(layout, id))} className="rounded-[7px] bg-primary px-2.5 py-1 font-semibold text-primary-foreground">{dt("Добавить", "Add")}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToolBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="rounded-[7px] px-2 py-1 font-semibold text-ink-soft hover:bg-accent-soft hover:text-primary disabled:opacity-30">
      {children}
    </button>
  );
}
