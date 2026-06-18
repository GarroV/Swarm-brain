"use client";
import { useRoyNav } from "../nav";
import { RoyHeader, FAB } from "../ui";
import { RoyIcon } from "../icons";
import { SwipeRow } from "../SwipeRow";
import { SmartListNav } from "@/components/tasks/SmartListNav";
import { TaskRow } from "@/components/tasks/TaskRow";
import { LensToggle } from "@/components/tasks/LensToggle";
import { useReminderTasks } from "@/components/tasks/useReminderTasks";
import { SMART_LISTS } from "@/lib/smartLists";
import type { Task } from "@/types";

// Мобильный Reminders-вид задач: чипы смарт-списков + спокойный чек-лист со свайпом.
export function RoyTasksScreen() {
  const { push, toast } = useRoyNav();
  const r = useReminderTasks();
  const activeDef = SMART_LISTS.find((s) => s.id === r.activeList)!;
  const total = r.activeList === "byMarket" ? r.marketGroups.reduce((n, g) => n + g.tasks.length, 0) : r.visible.length;
  const showAssignee = r.lens === "all";

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
      onTap={() => push({ view: "taskDetail", params: { id: t.id } })}
      actions={[
        { icon: "pencil", label: "Изменить", color: "var(--status-open)", onClick: () => push({ view: "newTask", params: { id: t.id } }) },
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
      <RoyHeader title="Задачи" right={<LensToggle lens={r.lens} onChange={r.setLens} />} />
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

        {!r.loading && r.activeList === "byMarket" &&
          r.marketGroups.map((g) => (
            <section key={g.label} className="space-y-2.5">
              <div className="flex items-center gap-2 pt-1.5">
                <RoyIcon name="globe" size={13} className="text-ink-mute" />
                <span className="font-bold uppercase text-ink-mute" style={{ fontSize: 11.5, letterSpacing: "0.05em" }}>{g.label}</span>
                <span className="text-ink-mute" style={{ fontSize: 11.5 }}>{g.tasks.length}</span>
              </div>
              {g.tasks.map(row)}
            </section>
          ))}

        {!r.loading && r.activeList !== "byMarket" && r.visible.map(row)}
      </div>

      <FAB onClick={() => push({ view: "newTask" })} />
    </div>
  );
}
