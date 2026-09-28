"use client";
import { useEffect, useMemo, useState } from "react";
import type { Task, User } from "@/types";
import { fetchTasks, fetchUsers } from "@/lib/api";
import { countryCode } from "@/lib/countries";
import { isDone, isOverdue } from "@/lib/smartLists";
import { ToolbarButton } from "@/components/tasks/table/Menu";
import { Avatar } from "@/components/roy/ui";
import { initials } from "@/components/roy/dash/shared";
import { useDt, useRoyNav } from "@/components/roy/nav";

// «Команда» десктопа по стенду (docs/redesign/stand/js/screens-system.js → screenTeam): таблица
// Участник · Роль · Рынок · Telegram · Открыто · Просрочено. Счёт задач — по тем задачам, что
// видны смотрящему (GET /tasks уже отфильтрован правилом видимости), поэтому у коллеги с личными
// задачами число может быть меньше настоящего. Вкладка «Воркспейсы» стенда — в «Админе».

const ROLE_LABELS: Record<string, [string, string]> = {
  marketing: ["Маркетинг", "Marketing"], bd: ["BD", "BD"], rnd: ["R&D", "R&D"],
};
const COLS = "minmax(0,1fr) 120px 120px minmax(120px,16%) 84px 112px";

export function TeamDesk() {
  const dt = useDt();
  const { tasksVersion } = useRoyNav();
  const [users, setUsers] = useState<User[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [failed, setFailed] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);

  useEffect(() => {
    fetchUsers().then(setUsers).catch((e) => { console.error("[TeamDesk] users", e); setFailed(true); setUsers([]); });
  }, []);
  useEffect(() => {
    fetchTasks().then(setTasks).catch((e) => console.warn("[TeamDesk] tasks", e));
  }, [tasksVersion]);

  const load = useMemo(() => {
    const now = new Date();
    const by = new Map<number, { open: number; late: number }>();
    for (const t of tasks) {
      if (isDone(t)) continue;
      for (const id of t.assignee_telegram_ids ?? []) {
        const c = by.get(id) ?? { open: 0, late: 0 };
        by.set(id, { open: c.open + 1, late: c.late + (isOverdue(t, now) ? 1 : 0) });
      }
    }
    return by;
  }, [tasks]);

  const all = users ?? [];
  const rows = all
    .filter((u) => !openOnly || (load.get(u.telegram_id)?.open ?? 0) > 0)
    .sort((a, b) => (load.get(b.telegram_id)?.open ?? 0) - (load.get(a.telegram_id)?.open ?? 0));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2">
        <ToolbarButton on={openOnly} onClick={() => setOpenOnly((v) => !v)}>
          {dt("Только с открытыми задачами", "Only with open tasks")}
        </ToolbarButton>
        <span className="ml-auto whitespace-nowrap text-ink-mute" style={{ fontSize: 12.5 }}>
          {dt("Показано", "Shown")} <b className="text-ink">{rows.length}</b> {dt("из", "of")} {all.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {users == null && [0, 1, 2, 3].map((i) => <div key={i} className="roy-shim mb-1.5" style={{ height: 34, borderRadius: 8 }} />)}
        {users != null && failed && (
          <div className="rounded-[10px] border border-line bg-surface px-4 py-5 text-center text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Команда не загрузилась — обновите страницу", "The team failed to load — reload the page")}
          </div>
        )}
        {users != null && !failed && rows.length === 0 && (
          <div className="rounded-[10px] border border-line bg-surface px-4 py-6 text-center text-ink-soft" style={{ fontSize: 13 }}>
            {openOnly ? dt("Ни у кого нет открытых задач", "Nobody has open tasks") : dt("Нет участников", "No members")}
          </div>
        )}
        {rows.length > 0 && (
          <div role="table" className="overflow-hidden rounded-[10px] border border-line bg-surface" style={{ fontSize: 13 }}>
            <div role="row" className="grid items-center border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
              style={{ gridTemplateColumns: COLS, height: 32, fontSize: 10.5, letterSpacing: "0.07em" }}>
              <span className="px-3">{dt("Участник", "Member")}</span>
              <span className="px-2">{dt("Роль", "Role")}</span>
              <span className="px-2">{dt("Рынок", "Market")}</span>
              <span className="px-2">Telegram</span>
              <span className="px-2 text-right">{dt("Открыто", "Open")}</span>
              <span className="px-3 text-right">{dt("Просрочено", "Overdue")}</span>
            </div>
            {rows.map((u) => {
              const c = load.get(u.telegram_id);
              const role = u.role ? (ROLE_LABELS[u.role] ?? [u.role, u.role]) : null;
              return (
                <div key={u.telegram_id} role="row" className="grid items-center border-b border-line last:border-b-0"
                  style={{ gridTemplateColumns: COLS, minHeight: 36 }}>
                  <div className="flex min-w-0 items-center gap-2.5 px-3">
                    <Avatar size={22}>{initials(u.name)}</Avatar>
                    <span className="truncate font-medium text-ink">{/^\d+$/.test(u.name) ? `#${u.name}` : u.name}</span>
                  </div>
                  <div className="truncate px-2 text-ink-soft">{role ? dt(role[0], role[1]) : <span className="text-ink-mute">—</span>}</div>
                  <div className="flex gap-1 px-2">
                    {u.markets.length
                      ? u.markets.slice(0, 3).map((m) => (
                        <span key={m} className="inline-flex h-[20px] items-center rounded-[5px] bg-surface-2 px-1.5 font-mono text-ink-soft" style={{ fontSize: 11 }}>{countryCode(m)}</span>
                      ))
                      : <span className="text-ink-mute">—</span>}
                  </div>
                  <div className="truncate px-2 font-mono text-ink-soft" style={{ fontSize: 12 }}>
                    {u.username ? `@${u.username}` : <span className="text-ink-mute">—</span>}
                  </div>
                  <div className="px-2 text-right font-mono text-ink-soft" style={{ fontSize: 12 }}>{c?.open || <span className="text-ink-mute">—</span>}</div>
                  <div className="px-3 text-right font-mono" style={{ fontSize: 12 }}>
                    {c?.late ? <span className="font-semibold text-pri-high">{c.late}</span> : <span className="text-ink-mute">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
