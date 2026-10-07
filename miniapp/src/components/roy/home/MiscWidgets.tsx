"use client";
import { useMemo } from "react";
import { useDt, useRoyNav } from "../nav";
import { DashTaskRow } from "../dash/shared";
import type { DashboardData } from "../dash/useDashboardData";
import { AreaSpark } from "./LineChart";
import { Delta } from "./QualityWidgets";
import { fmtEur, type SalesState } from "./useCountrySales";
import { isDone, isOverdue } from "@/lib/smartLists";
import { countryFlag } from "@/lib/countries";

// Ближайшие задачи, доска стикеров, продажи и заглушка карт.

export const TOP_TASKS = 5;

export function TopTasksWidget({ data, onCreate }: { data: DashboardData; onCreate: () => void }) {
  const dt = useDt();
  const { openTasks } = useRoyNav();
  const open = useMemo(() => data.mine.filter((t) => !isDone(t)), [data.mine]);
  const top = useMemo(() => [...open].filter((t) => t.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, TOP_TASKS), [open]);
  const overdue = open.filter((t) => isOverdue(t)).length;
  const { loading, failed, retry } = data.tasksState;
  return (
    <div className="rounded-[12px] border border-line bg-surface p-2">
      {loading && [0, 1, 2].map((i) => <div key={i} className="roy-shim m-1" style={{ height: 34, borderRadius: 8 }} />)}
      {failed && (
        <div className="px-3 py-3 text-ink-soft" style={{ fontSize: 13 }}>
          {dt("Не загрузилось", "Failed to load")} <button type="button" onClick={retry} className="font-medium text-primary hover:underline">{dt("Повторить", "Retry")}</button>
        </div>
      )}
      {!loading && !failed && top.map((t) => <DashTaskRow key={t.id} task={t} />)}
      {!loading && !failed && !top.length && (
        <div className="px-3 py-5 text-center text-ink-mute" style={{ fontSize: 13 }}>{dt("Задач со сроком на вас нет", "No tasks with a due date on you")}</div>
      )}
      <div className="mt-1 flex items-center justify-between border-t border-line px-2 pt-2" style={{ fontSize: 12 }}>
        <span className="text-ink-mute">
          {overdue > 0 && <b className="text-[var(--pri-high)]">{dt(`${overdue} просрочено`, `${overdue} overdue`)} · </b>}
          {dt(`всего открытых ${open.length}`, `${open.length} open`)}
        </span>
        <span className="flex gap-3">
          <button type="button" onClick={onCreate} className="font-medium text-primary hover:underline">{dt("+ задача", "+ task")}</button>
          <button type="button" onClick={() => openTasks("mine", "all")} className="font-medium text-primary hover:underline">{dt("Все →", "All →")}</button>
        </span>
      </div>
    </div>
  );
}

type Sticker = { key: string; tone: string; kind: string; title: string; body: string; due: string; hot?: boolean; action: string; onClick?: () => void; sample?: boolean; pin?: boolean };

const PAPER: Record<string, string> = {
  yellow: "bg-[#FFE97A] text-[#3A3000]", pink: "bg-[#FFC9DA] text-[#4A1426]", blue: "bg-[#C7E0FF] text-[#0E2A4D]",
  green: "bg-[#C9F0C4] text-[#173D14]", paper: "bg-[#FFFDF6] text-[#2A2A2A]",
};

export function BoardWidget({ data }: { data: DashboardData }) {
  const dt = useDt();
  const { setTab, openTasks } = useRoyNav();
  const review = data.reviewCount + data.pendingMeetings;
  const overdue = data.mine.filter((t) => isOverdue(t)).length;
  const stickers: Sticker[] = [
    { key: "okr", tone: "yellow", kind: dt("Задание · каждый месяц", "Task · monthly"), title: dt("Заполни OKR", "Fill in OKRs"), body: dt("Сентябрьские факты по ключевым результатам ещё не внесены.", "September key-result facts aren't in yet."), due: dt("до 10 окт", "by Oct 10"), hot: true, action: dt("Заполнить", "Fill in"), sample: true },
    { key: "digest", tone: "pink", kind: dt("Задание · каждую неделю", "Task · weekly"), title: dt("Заполни дайджест", "Fill in the digest"), body: dt("Неделя 41 по твоим странам.", "Week 41 for your countries."), due: dt("пт 18:00", "Fri 18:00"), action: dt("Открыть", "Open"), sample: true },
    ...(review > 0 ? [{ key: "review", tone: "blue", kind: dt("Задание · сейчас", "Task · now"), title: dt("Вычитай встречи", "Review meetings"), body: dt(`${review} в очереди на вычитку.`, `${review} waiting for review.`), due: dt(`${review} в очереди`, `${review} queued`), action: dt("Вычитать", "Review"), onClick: () => setTab("cal") }] : []),
    ...(overdue > 0 ? [{ key: "overdue", tone: "green", kind: dt("Задание · задачи", "Task · tasks"), title: dt("Разбери просрочку", "Clear overdue"), body: dt(`${overdue} задач со сроком в прошлом.`, `${overdue} tasks are past due.`), due: dt("сегодня", "today"), hot: true, action: dt("Открыть", "Open"), onClick: () => openTasks("mine", "all") }] : []),
    { key: "ann", tone: "paper", kind: dt("Объявление · Админ", "Notice · Admin"), title: dt("Новая норма", "New target"), body: dt("С 1 ноября собираемость инспекторских проверок — не ниже 90%.", "From Nov 1 inspector coverage must be at least 90%."), due: dt("до 1 ноя", "by Nov 1"), action: dt("Понятно", "Got it"), sample: true, pin: true },
  ];
  return (
    <div className="rounded-[14px] border border-line bg-[repeating-linear-gradient(45deg,color-mix(in_srgb,var(--pri-med)_7%,var(--surface-2))_0_2px,var(--surface-2)_2px_9px)] p-4">
      <div className="flex gap-4 overflow-x-auto pb-2 pt-2" style={{ scrollSnapType: "x mandatory" }}>
        {stickers.map((s, i) => (
          <article key={s.key} className={`relative flex min-h-[190px] w-[200px] shrink-0 flex-col gap-2 rounded-[3px] p-4 shadow-[0_8px_18px_rgba(0,0,0,.14)] transition-transform hover:-translate-y-0.5 hover:rotate-0 ${PAPER[s.tone]}`}
            style={{ transform: `rotate(${[-1.5, 1.2, -0.8, 1, -1.2][i % 5]}deg)`, scrollSnapAlign: "start" }}>
            {s.pin ? <i className="absolute left-1/2 top-[-6px] h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#D03A3A] shadow" />
              : <i className="absolute left-1/2 top-[-8px] h-4 w-16 -translate-x-1/2 rotate-[-2deg] bg-white/60" />}
            <div className="font-bold uppercase opacity-60" style={{ fontSize: 10, letterSpacing: "0.1em" }}>{s.kind}</div>
            <div className="font-bold leading-tight" style={{ fontSize: 19 }}>{s.title}</div>
            <div className="flex-1 opacity-80" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{s.body}</div>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded px-1.5 py-0.5 font-mono ${s.hot ? "bg-[#D03A3A] text-white" : "bg-black/10"}`} style={{ fontSize: 10.5 }}>{s.due}</span>
              <button type="button" onClick={s.onClick} className="rounded-[7px] bg-[#1B1B1B] px-2.5 py-1 font-semibold text-white hover:bg-black" style={{ fontSize: 11.5 }}>{s.action}</button>
            </div>
            {s.sample && <span className="absolute bottom-1 right-2 opacity-40" style={{ fontSize: 9 }}>{dt("пример", "sample")}</span>}
          </article>
        ))}
        <button type="button" className="grid w-[150px] shrink-0 place-items-center rounded-[6px] border-2 border-dashed border-line-2 text-ink-mute hover:border-accent-line hover:text-primary" style={{ fontSize: 12.5 }}>
          <span><b className="block text-center" style={{ fontSize: 22 }}>+</b>{dt("Объявление", "Notice")}<br /><small>{dt("видят все", "visible to all")}</small></span>
        </button>
      </div>
    </div>
  );
}

export function SalesWidget({ codes, sales }: { codes: string[]; sales: SalesState }) {
  const dt = useDt();
  const list = codes.map((cc) => sales.byCc[cc]).filter(Boolean);
  const total = list.reduce((s, c) => s + (c.last ?? 0), 0);
  const prev = list.reduce((s, c) => s + (c.months.at(-2)?.[1] ?? 0), 0);
  const months = Array.from(new Set(list.flatMap((c) => c.months.map((m) => m[0])))).sort().slice(-12);
  const series = months.map((m) => list.reduce((s, c) => s + (c.months.find((x) => x[0] === m)?.[1] ?? 0), 0));
  const lastMonth = months.at(-1);
  return (
    <div className="rounded-[12px] border border-line bg-surface p-4">
      {sales.loading ? <div className="roy-shim" style={{ height: 90, borderRadius: 8 }} /> : (
        <>
          <div className="font-mono font-semibold text-ink" style={{ fontSize: 30, letterSpacing: "-0.02em" }}>{list.length ? fmtEur(total) : "—"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
            <Delta v={prev ? ((total - prev) / prev) * 100 : null} />
            <span className="text-ink-mute">{dt(`за ${lastMonth ?? "—"} к прошлому месяцу, %`, `${lastMonth ?? "—"} vs previous month, %`)}</span>
          </div>
          <AreaSpark values={series} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ink-soft" style={{ fontSize: 11.5 }}>
            {list.map((c) => <span key={c.cc}>{countryFlag(c.cc)} {c.last != null ? fmtEur(c.last) : "—"}</span>)}
            {sales.failed.length > 0 && <span className="text-[var(--pri-high)]">{dt(`не загрузилось: ${sales.failed.join(", ")}`, `failed: ${sales.failed.join(", ")}`)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function MapsSoonWidget() {
  const dt = useDt();
  return (
    <div className="grid gap-4 rounded-[12px] border border-dashed border-line-2 bg-surface p-4 min-[1300px]:grid-cols-[1.4fr_1fr]">
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <b className="text-ink">{dt("После подключения Pointer здесь появятся:", "Once Pointer is connected you'll see:")}</b>
        <ul className="mt-1.5 list-disc pl-5 text-ink-soft">
          <li>{dt("рейтинг пиццерий в Google и Яндексе по месяцам;", "pizzeria ratings on Google and Yandex by month;")}</li>
          <li>{dt("свежие негативные отзывы с пометкой «без ответа»;", "fresh negative reviews flagged “no reply”;")}</li>
          <li>{dt("колонка «Карты ★» в таблице пиццерий.", "the “Maps ★” column in the pizzeria table.")}</li>
        </ul>
      </div>
      <div className="flex flex-col justify-center gap-2 opacity-40 grayscale" aria-hidden="true">
        {[70, 55, 80].map((w, i) => (
          <div key={w} className="flex items-center gap-2 text-[#E8A400]" style={{ fontSize: 12 }}>
            <span>{["★★★★☆", "★★☆☆☆", "★★★☆☆"][i]}</span><i className="block h-2 rounded bg-line-2" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
