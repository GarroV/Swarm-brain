"use client";
import { useEffect, useState } from "react";
import { fetchPeopleStats, type PeopleStatsResponse } from "@/lib/api";
import { Avatar } from "@/components/roy/ui";
import { initials } from "@/components/roy/dash/shared";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { ActivityStrip, PersonStatsPanel } from "./PersonStatsPanel";

// «Статистика» (решение владельца 2026-09-25): столбец с командой, по клику — справа плитки
// по человеку. Числа считает сервер (GET /stats/people, _shared/stats/people.ts) по тем данным,
// что видны смотрящему; «на вычитке» — только число, видят все.

export function StatsDesk() {
  const dt = useDt();
  const { me } = useRoyNav();
  const [data, setData] = useState<PeopleStatsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    fetchPeopleStats()
      .then(setData)
      .catch((e) => { console.error("[StatsDesk] load", e); setFailed(true); });
  }, []);

  const people = data?.people ?? [];
  const selected = people.find((p) => p.telegram_id === picked)
    ?? people.find((p) => p.telegram_id === me?.telegram_id)
    ?? people[0];

  if (failed) {
    return (
      <div className="p-4">
        <div className="rounded-[10px] border border-line bg-surface px-4 py-5 text-center text-ink-soft" style={{ fontSize: 13 }}>
          {dt("Статистика не загрузилась — обновите страницу", "Stats failed to load — reload the page")}
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] min-[900px]:grid-cols-[300px_minmax(0,1fr)] min-[900px]:grid-rows-1">
      <aside aria-label={dt("Команда", "Team")}
        className="min-h-0 overflow-y-auto border-b border-line bg-surface-2 p-2 max-[899px]:max-h-[38vh] min-[900px]:border-b-0 min-[900px]:border-r">
        {data == null && [0, 1, 2, 3, 4].map((i) => <div key={i} className="roy-shim mb-1.5" style={{ height: 46, borderRadius: 8 }} />)}
        {data != null && people.length === 0 && (
          <p className="px-2 py-4 text-center text-ink-soft" style={{ fontSize: 13 }}>{dt("Нет участников", "No members")}</p>
        )}
        {people.map((p) => {
          const on = p.telegram_id === selected?.telegram_id;
          return (
            <button key={p.telegram_id} type="button" onClick={() => setPicked(p.telegram_id)} aria-pressed={on}
              className={cn(
                "mb-0.5 flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                on ? "bg-surface shadow-[0_0_0_1px_var(--color-line)]" : "hover:bg-surface/70",
              )}>
              <Avatar size={26}>{initials(p.name)}</Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink" style={{ fontSize: 13 }}>{p.name}</span>
                <span className="mt-1 block"><ActivityStrip strip={p.activity.strip} size={6} /></span>
              </span>
              <span className="shrink-0 text-right font-mono" style={{ fontSize: 11.5 }}>
                <span className="text-ink-soft">{p.tasks.open + p.tasks.inProgress}</span>
                {p.tasks.overdue > 0 && <span className="ml-1.5 font-semibold text-pri-high">{p.tasks.overdue}</span>}
              </span>
            </button>
          );
        })}
      </aside>
      <section className="min-h-0 overflow-y-auto p-4 min-[900px]:p-6">
        {data == null && <div className="roy-shim" style={{ height: 220, borderRadius: 12 }} />}
        {data != null && selected && <PersonStatsPanel person={selected} meta={data} />}
      </section>
    </div>
  );
}
