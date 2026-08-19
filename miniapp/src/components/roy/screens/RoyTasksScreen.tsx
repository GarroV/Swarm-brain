"use client";
import { useRoyNav } from "../nav";
import { RoyHeader, FAB } from "../ui";
import { RoyIcon, type RoyIconName } from "../icons";
import { SwipeRow } from "../SwipeRow";
import { SmartListNav } from "@/components/tasks/SmartListNav";
import { TaskRow } from "@/components/tasks/TaskRow";
import { LensToggle } from "@/components/tasks/LensToggle";
import { useReminderTasks } from "@/components/tasks/useReminderTasks";
import { SMART_LISTS } from "@/lib/smartLists";
import type { Task } from "@/types";

// Мобильный Reminders-вид задач: чипы смарт-списков + спокойный чек-лист со свайпом.
export function RoyTasksScreen() {
  const { push, toast, openTask } = useRoyNav();
  const r = useReminderTasks();
  const activeDef = SMART_LISTS.find((s) => s.id === r.activeList)!;
  // «По рынкам»/«Все сотрудники» — независимые тумблеры (не линза), см. RemindersTasks.tsx (десктоп).
  const byMarket = r.byMarket;
  const byStaff = r.allStaff;
  const both = byMarket && byStaff;
  const grouped = byMarket || byStaff;
  const total = grouped
    ? (both ? r.nestedGroups : byStaff ? r.staffGroups : r.marketGroups).reduce((n, g) => n + g.tasks.length, 0)
    : r.visible.length;
  const showAssignee = !byStaff && r.effLens !== "mine";

  const remove = async (t: Task) => {
    try {
      await r.remove(t);
      toast("Задача удалена");
    } catch {
      toast("Не удалось удалить");
    }
  };

  const row = (t: Task) => (
    <SwipeRow
      key={t.id}
      onTap={() => openTask(t)}
      actions={[
        { icon: "pencil", label: "Изменить", color: "var(--accent-ink)", onClick: () => push({ view: "newTask", params: { id: t.id } }) },
        { icon: "trash", label: "Удалить", color: "var(--pri-high)", onClick: () => remove(t) },
      ]}
    >
      <div className="bg-background px-3">
        <TaskRow task={t} now={r.now} showAssignee={showAssignee} onToggle={() => r.toggle(t)} />
      </div>
    </SwipeRow>
  );

  return (
    <div className="relative h-full overflow-y-auto">
      <RoyHeader title="Задачи" />
      <div className="px-5 pb-2">
        <LensToggle
          lens={r.lens}
          onChangeLens={r.setLens}
          byMarket={r.byMarket}
          onToggleMarket={() => r.setByMarket((v) => !v)}
          allStaff={r.allStaff}
          onToggleAllStaff={() => r.setAllStaff((v) => !v)}
          showAllStaff={!!r.me?.is_admin}
        />
      </div>
      <SmartListNav variant="chips" active={r.activeList} counts={r.counts} onSelect={r.setActiveList} />

      <div className="px-5 pb-2 text-ink-mute" style={{ fontSize: 12.5 }}>
        {activeDef.label} · {total}
      </div>

      <div className="space-y-2.5 px-5 pb-28">
        {r.loading && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 64, borderRadius: 18 }} />)}

        {!r.loading && total === 0 && (
          <div className="py-10 text-center text-sm text-ink-soft">
            {r.activeList === "done" ? "Пусто — всё разобрано" : "Здесь пока пусто"}
          </div>
        )}

        {!r.loading && both &&
          r.nestedGroups.map((sg) => (
            <section key={sg.label} className="space-y-2.5">
              <GroupLabel icon="team" label={sg.label} count={sg.tasks.length} />
              {sg.marketGroups.map((mg) => (
                <div key={mg.label} className="ml-4 space-y-2.5">
                  <GroupLabel icon="globe" label={mg.label} count={mg.tasks.length} small />
                  {mg.tasks.map(row)}
                </div>
              ))}
            </section>
          ))}

        {!r.loading && grouped && !both &&
          (byStaff ? r.staffGroups : r.marketGroups).map((g) => (
            <section key={g.label} className="space-y-2.5">
              <GroupLabel icon={byStaff ? "team" : "globe"} label={g.label} count={g.tasks.length} />
              {g.tasks.map(row)}
            </section>
          ))}

        {!r.loading && !grouped && r.visible.map(row)}
      </div>

      <FAB onClick={() => push({ view: "newTask" })} />
    </div>
  );
}

// Подзаголовок секции группировки (по рынку / по сотруднику / вложенный рынок внутри сотрудника).
function GroupLabel({ icon, label, count, small }: { icon: RoyIconName; label: string; count: number; small?: boolean }) {
  return (
    <div className="flex items-center gap-2 pt-1.5">
      <RoyIcon name={icon} size={small ? 12 : 13} className="text-ink-mute" />
      <span className="font-bold uppercase text-ink-mute" style={{ fontSize: small ? 10.5 : 11.5, letterSpacing: "0.05em" }}>{label}</span>
      <span className="text-ink-mute" style={{ fontSize: small ? 10.5 : 11.5 }}>{count}</span>
    </div>
  );
}
