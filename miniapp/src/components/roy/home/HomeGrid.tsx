"use client";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useDt, useRoyNav } from "../nav";
import { HomeLabel } from "../dash/shared";
import type { DashboardData } from "../dash/useDashboardData";
import { MeetingsToday } from "../dash/MeetingsToday";
import { HomeNews, LatestInBase } from "../dash/HomeSide";
import { CountryEditor, NarrowChip } from "./CountryEditor";
import { HomeTasksWidget, TeamTasksWidget } from "./TaskWidgets";
import { SalesWidget, TopTasksWidget } from "./MiscWidgets";
import { InspectionsWidget } from "./InspectionsWidget";
import type { TaskDraft } from "@/lib/homeInspections";
import { BoardWidget } from "./StickerBoard";
import { SampleTag, ViolationsWidget } from "./QualityWidgets";
import { RatingsWidget } from "./RatingsWidget";
import { CountriesWidget, PizzeriasWidget } from "./TableWidgets";
import { useCountrySales } from "./useCountrySales";
import { useQuality, type QualityState } from "./useQuality";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { countryOf } from "@/lib/homeQuality";
import { FILL, FILL_CARD, FILL_NOTE } from "./blockFill";
import {
  addWidget, DEFAULT_LAYOUT, HEIGHT_KIND, HOME_FILL_MAX, HOME_FILL_MIN, HOME_FIXED_HEIGHT, HOME_LIST_MAX, hideWidget, layoutRows, rowSizing, loadLayout, moveBefore, moveBy, saveLayout, toggleWidth,
  WIDGET_IDS, DEFAULT_WIDTH, type CellSizing, type LayoutItem, type WidgetId,
} from "@/lib/homeLayout";

// Главная из виджетов (decisions/2026-10-07-home-dashboard-direction.md). Каждый собирает её сам:
// «Настроить главную» → перетащить, ↑↓, ширина ½ / вся строка, скрыть, добавить из каталога.

// scoped — метрика считается по «Моим странам» (без них — подсказка выбрать); quality — на баллах
// РС/РКО из GET /quality (загрузка, ошибка, «ещё не загружены»); sample — цифры для вида, плашка «образец».
type Meta = {
  title: [string, string]; hint: [string, string]; ownTitle?: boolean;
  scoped?: boolean; quality?: boolean; sample?: boolean; meta?: [string, string];
};
const META: Record<WidgetId, Meta> = {
  calls: { title: ["Созвоны сегодня", "Today's calls"], hint: ["Встречи дня из календаря и кнопка «подключиться».", "Today's meetings from your calendar with a join button."], ownTitle: true },
  top5: { title: ["Ближайшие задачи", "Next tasks"], hint: ["Пять моих задач с ближайшим сроком.", "My five tasks with the nearest due date."], meta: ["топ-5 по сроку", "top 5 by due date"] },
  board: { title: ["Доска", "Board"], hint: ["Стикеры-задания (OKR, дайджест, вычитка) и объявления админа.", "Task stickers (OKRs, digest, review) and admin notices."], meta: ["что от тебя ждут", "what's expected of you"] },
  ratings: { title: ["Рейтинги", "Ratings"], hint: ["Вкладки РС, РКО, Карты, Агрегаторы: выбранные страны против среднего по IMF.", "Tabs for Standards, CX, Maps and Delivery apps: your countries against the IMF average."], scoped: true },
  pz: { title: ["Пиццерии", "Pizzerias"], hint: ["Все пиццерии подборки: РС, РКО, худшие сверху.", "Every pizzeria in your selection, worst first."], scoped: true, quality: true, meta: ["худшие сверху", "worst first"] },
  countries: { title: ["Мои страны", "My countries"], hint: ["Страны подборки: РС, РКО, Google и Яндекс со стрелкой изменения, продажи; клик раскрывает пиццерии страны.", "Selected countries: standards, CX, Google and Yandex with change arrows, sales; click to expand pizzerias."], scoped: true, quality: true },
  viol: { title: ["Топ-5 нарушений", "Top 5 violations"], hint: ["Самые частые нарушения стандартов в волне.", "Most frequent standards violations this wave."], scoped: true, sample: true },
  sales: { title: ["Продажи Dodo", "Dodo sales"], hint: ["Выручка моих стран по месяцам — данные «Анализа рынка».", "Monthly revenue of my countries from Market analysis."], meta: ["публичный API Dodo", "Dodo public API"] },
  insp: { title: ["Проверки", "Inspections"], hint: ["Последние проверки стандартов по странам подборки: балл, класс, движение к прошлой; клик — зоны и нарушения.", "Latest standards inspections in your countries: score, grade, change vs the previous one; click for zones and violations."], scoped: true, meta: ["Децимус, за 90 дней", "Decimus, 90 days"] },
  myTasks: { title: ["Мои задачи", "My tasks"], hint: ["Полная таблица: просрочено, сегодня, дальше, без срока.", "Full table: overdue, today, later, no date."] },
  teamTasks: { title: ["Задачи команды", "Team tasks"], hint: ["Общие задачи без исполнителя.", "Shared tasks with no owner."] },
  news: { title: ["Новости", "News"], hint: ["Комментарии, чекпоинты, встречи на вычитке.", "Comments, checkpoints, meetings to review."], ownTitle: true },
  latest: { title: ["Последнее в базе", "Latest in the base"], hint: ["Свежие записи и встречи базы знаний.", "Fresh entries and meetings in the knowledge base."], ownTitle: true },
};

type Props = { data: DashboardData; onCreateTask: () => void; onCreateTaskFrom: (draft: TaskDraft) => void; editing: boolean; onEditing: (v: boolean) => void };

export function HomeGrid({ data, onCreateTask, onCreateTaskFrom, editing, onEditing: setEditing }: Props) {
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
  // Синхронизация с профилем прямо в рендере, а не в эффекте: эффект давал один кадр с пустыми странами
  // (и подсказкой «выберите страны») сразу после прихода me.
  const [seenMarkets, setSeenMarkets] = useState(me?.markets);
  if (seenMarkets !== me?.markets) { setSeenMarkets(me?.markets); setMarkets(me?.markets ?? []); }
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !gallery) setEditing(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, gallery]);

  // Макет из ?layout= (только DEV_MODE) в localStorage не пишем.
  const setLayout = (next: LayoutItem[]) => { setLayoutState(next); saveLayout(next); };
  const codes = narrow && markets.includes(narrow) ? [narrow] : markets;
  const quality = useQuality();
  const q = quality.data;
  const scope = useMemo(() => (q ? codes.map((cc) => countryOf(q, cc)) : []), [q, codes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => (q ? markets.map((cc) => countryOf(q, cc)) : []), [q, markets]);
  const sales = useCountrySales(markets);

  const body = (id: WidgetId): ReactNode => {
    // Пока профиль (me) не пришёл, страны неизвестны: подсказку «выберите страны» не показываем — она мигала
    // 0.3–1.5 с у людей с уже выбранными странами (issue #906). Тот же скелетон, что у загрузки баллов.
    if (!me && META[id].scoped) return <div className={`roy-shim ${FILL}`} style={{ height: id === "countries" ? 160 : 220, borderRadius: 12 }} />;
    if (!codes.length && META[id].scoped) {
      return <div className={note} style={{ fontSize: 13 }}>{dt("Выберите свои страны в «Настроить главную» — метрики считаются по ним", "Pick your countries in “Customize home” — metrics are scoped to them")}</div>;
    }
    const gate = META[id].quality ? qualityGate(quality, id) : null;
    if (gate) return gate;
    switch (id) {
      case "calls": return <MeetingsToday flat first className={FILL} flatBody={`rounded-[12px] border border-line bg-surface p-1.5 ${FILL_CARD}`} />;
      case "top5": return <TopTasksWidget data={data} onCreate={onCreateTask} />;
      case "board": return <BoardWidget data={data} />;
      case "ratings": return <RatingsWidget codes={codes} q={q} scope={scope} qualityGate={qualityGate(quality, id)} />;
      case "pz": return <PizzeriasWidget scope={scope} />;
      case "countries": return <CountriesWidget scope={mine} sales={sales} narrow={narrow} onNarrow={setNarrow} onMarket={() => setTab("market")} />;
      case "viol": return <ViolationsWidget scope={scope} />;
      case "sales": return <SalesWidget codes={codes} sales={sales} />;
      case "insp": return <InspectionsWidget codes={codes} onCreateTask={onCreateTaskFrom} />;
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

  const widget = (it: LayoutItem, i: number, sizing: CellSizing) => {
    const m = META[it.id];
    return (
      <section key={it.id} data-widget={it.id}
        className={`relative min-w-0 rounded-[14px] transition-opacity ${sizing === "auto" ? "" : `${BLOCK_COL} ${SIZING_CLASS[sizing]}`} ${editing ? "cursor-grab outline-2 outline-offset-4 outline-dashed outline-line-2 hover:outline-accent-line" : ""} ${dragId === it.id ? "opacity-40" : ""} ${overId === it.id && dragId !== it.id ? "outline-primary" : ""}`}
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
        <div className={`${editing ? "pointer-events-none select-none" : ""} ${sizing === "auto" ? "" : FILL_COL}`}>
          {!m.ownTitle && (
            <HomeLabel first action={undefined}>
              <span className="inline-flex items-center gap-2">{m.title[lang]}{m.meta && <span className="font-normal normal-case tracking-normal text-ink-mute">{m.meta[lang]}</span>}{m.sample && <SampleTag />}</span>
            </HomeLabel>
          )}
          {body(it.id)}
        </div>
      </section>
    );
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

      {/* Строки раскладки (layoutRows): «вся строка» — одна, половинки — парой одной высоты, одиночная
          половинка — на всю строку. От 1100 px высоту клетки раздаёт rowSizing по виду высоты виджета
          (HEIGHT_KIND): страница не двигается, пара ровная, пустоты под карточкой нет; уже — одна
          колонка в порядке раскладки. */}
      <div className="flex flex-col gap-y-2 px-6 pt-1" style={HEIGHT_VARS}>
        {layoutRows(layout).map((row) => {
          const { cells, minFill } = rowSizing(row.map((c) => HEIGHT_KIND[c.item.id]));
          return (
            <div key={row[0].item.id}
              className={`flex flex-col gap-y-2 ${row.length > 1 ? "min-[1100px]:grid min-[1100px]:grid-cols-2 min-[1100px]:gap-x-5" : ""} ${minFill ? "min-[1100px]:min-h-[var(--home-fill-min)]" : ""}`}>
              {row.map(({ item, index }, c) => (
                <div key={item.id} className={`min-w-0 ${cells[c] === "absolute" ? "min-[1100px]:relative" : ""}`}>{widget(item, index, cells[c])}</div>
              ))}
            </div>
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

// Высота блока (blockFill.ts, rowSizing): секция — колонка, заголовок и тело внутри неё. Ячейка сетки
// тянется на высоту пары, секция внутри — на всю ячейку (или лежит в ней absolute, если это таблица
// рядом с другим видом высоты и высоту строки она не задаёт).
const HEIGHT_VARS = {
  "--home-fixed": `${HOME_FIXED_HEIGHT}px`, "--home-list-max": `${HOME_LIST_MAX}px`,
  "--home-fill-min": `${HOME_FILL_MIN}px`, "--home-fill-max": `${HOME_FILL_MAX}px`,
} as CSSProperties;
const BLOCK_COL = "min-[1100px]:flex min-[1100px]:flex-col";
const SIZING_CLASS: Record<CellSizing, string> = {
  fixed: "min-[1100px]:h-[var(--home-fixed)]",
  capped: "min-[1100px]:h-full min-[1100px]:max-h-[var(--home-list-max)]",
  free: "min-[1100px]:h-full",
  absolute: "min-[1100px]:absolute min-[1100px]:inset-0",
  fillCapped: "min-[1100px]:h-full min-[1100px]:max-h-[var(--home-fill-max)]",
  auto: "",
};
const FILL_COL = "min-[1100px]:flex min-[1100px]:min-h-0 min-[1100px]:flex-auto min-[1100px]:flex-col";

const note = `rounded-[12px] border border-dashed border-line-2 px-4 py-6 text-center text-ink-mute ${FILL_NOTE}`;

/** Состояние баллов вместо виджета: загрузка, ошибка с повтором, баллов ещё нет. null — рисуем виджет. */
function qualityGate({ data, loading, failed, retry }: QualityState, id: WidgetId): ReactNode {
  if (loading) return <div className={`roy-shim ${FILL}`} style={{ height: id === "countries" ? 160 : 220, borderRadius: 12 }} />;
  if (failed || !data) return <QualityFailed onRetry={retry} />;
  // «Мои страны» без баллов всё равно полезны: в них продажи.
  if (!data.countries.length && id !== "countries") return <QualityEmpty />;
  return null;
}

function QualityFailed({ onRetry }: { onRetry: () => void }) {
  const dt = useDt();
  return (
    <div className={note} style={{ fontSize: 13 }}>
      {dt("Баллы РС и РКО не загрузились.", "Couldn't load standards and CX scores.")}{" "}
      <button type="button" onClick={onRetry} className="font-semibold text-primary hover:underline">{dt("Повторить", "Retry")}</button>
    </div>
  );
}

function QualityEmpty() {
  const dt = useDt();
  return <div className={note} style={{ fontSize: 13 }}>{dt("Баллы РС и РКО ещё не загружены", "Standards and CX scores haven't been loaded yet")}</div>;
}

function ToolBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="rounded-[7px] px-2 py-1 font-semibold text-ink-soft hover:bg-accent-soft hover:text-primary disabled:opacity-30">
      {children}
    </button>
  );
}
