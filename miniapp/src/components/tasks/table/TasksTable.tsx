"use client";
import { useEffect, useMemo, useState } from "react";
import type { Project, Task, User } from "@/types";
import { fetchConfig, fetchProjects, fetchUsers, type TaskLabel } from "@/lib/api";
import { countryName } from "@/lib/countries";
import { groupByDue, groupByPerson, type TaskSection } from "@/lib/taskTable";
import { nestSubtasks, progressByParent } from "@/lib/subtasks";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { TaskModal } from "@/components/TaskModal";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import { LabelEditor } from "@/components/tasks/LabelEditor";
import { useReminderTasks } from "@/components/tasks/useReminderTasks";
import { COLS, TaskTableRow } from "./TaskTableRow";
import { TasksToolbar, type ToolbarState } from "./TasksToolbar";

// Экран «Задачи» нового вида (витрина, решение владельца 24.09.2026: «прям полную переделку
// ебаш на стенд»). Образец — docs/redesign/stand/js/screens-tasks.js: одна панель фильтров,
// таблица с колонками, секции по сроку. Данные и правила — прежние (useReminderTasks:
// линзы видимости, статусы, оверсайт админа), меняется только вид.

export function TasksTable() {
  const isDesktop = useIsDesktop();
  const r = useReminderTasks();
  const dt = useDt();
  const lang = dt("ru", "en") === "en" ? 1 : 0;
  const [modalTask, setModalTask] = useState<Task | "new" | null>(null);
  const [labelEditor, setLabelEditor] = useState<TaskLabel | "new" | null>(null);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [market, setMarket] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<User[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => {});
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => {});
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  // Вкладок времени у задач нет: срок виден секциями в самом списке. Из смарт-списков остались
  // «все» и «регулярные» (тумблер в «Ещё»); сохранённое «сегодня»/«ближайшие» сводим к «всем».
  const { activeList, setActiveList } = r;
  useEffect(() => {
    if (activeList !== "all" && activeList !== "recurring") setActiveList("all");
  }, [activeList, setActiveList]);

  const scope = r.activeLabelId ? r.visibleByLabel : r.visible;
  const list = useMemo(
    () => scope.filter((t) =>
      (assignee == null || (t.assignee_telegram_ids ?? []).includes(assignee)) &&
      (market == null || t.country === market)),
    [scope, assignee, market],
  );

  const staffView = r.allStaff && assignee == null && !r.activeLabelId;
  const sections: TaskSection[] = useMemo(() => {
    if (staffView) return groupByPerson(list, users, r.now, dt("не назначен", "unassigned"));
    if (r.byMarket) {
      const by = new Map<string, Task[]>();
      for (const t of list) by.set(t.country ?? "", [...(by.get(t.country ?? "") ?? []), t]);
      return [...by.keys()].sort().map((k) => ({
        key: k || "none",
        label: k ? countryName(k) : dt("Без рынка", "No market"),
        tasks: by.get(k)!,
      }));
    }
    return groupByDue(list, r.now, lang);
  }, [staffView, r.byMarket, list, users, r.now, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // «X из Y» у родителя считаем по ВСЕМ загруженным задачам, а не по срезу: фильтр не должен
  // превращать «2 из 5» в «2 из 2».
  const progress = useMemo(() => progressByParent(r.tasks ?? []), [r.tasks]);

  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [projects]);

  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filtered = assignee != null || market != null || !!r.query || !!r.range || !!r.activeLabelId || activeList === "recurring";
  const resetFilters = () => {
    setAssignee(null);
    setMarket(null);
    r.setQuery("");
    r.setRange(null);
    r.setActiveLabelId(null);
    setActiveList("all");
  };

  const toolbar: ToolbarState = {
    assignee, setAssignee, market, setMarket, users, markets,
    shown: list.length,
    onNew: () => setModalTask("new"),
    onNewLabel: () => setLabelEditor("new"),
    onEditLabel: (l) => setLabelEditor(l),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TasksToolbar r={r} s={toolbar} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[960px]">
          <div
            role="row"
            // Шапка по стенду (.th): капс, разрядка, серая подложка — визуальный шаг В2.
            className="sticky top-0 z-10 grid border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
            style={{ gridTemplateColumns: COLS, fontSize: 10.5, letterSpacing: "0.07em", height: 32, alignItems: "center" }}
          >
            <span className="px-3">{dt("Задача", "Task")}</span>
            <span className="px-2">{dt("Срок", "Due")}</span>
            <span />
            <span className="px-2">{dt("Рынок", "Market")}</span>
            <span className="px-2">{dt("Проект", "Project")}</span>
            <span className="px-2">{dt("Исполнитель", "Assignee")}</span>
            <span className="px-2">{dt("Списки", "Lists")}</span>
          </div>

          {r.loading && [0, 1, 2, 3].map((i) => <div key={i} className="roy-shim mx-3 my-1.5" style={{ height: 30, borderRadius: 6 }} />)}

          {!r.loading && list.length === 0 && (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold text-ink" style={{ fontSize: 14 }}>{dt("Задач в этом срезе нет", "No tasks in this view")}</p>
              {/* Пустой экран без объяснения читается как «данных нет»: называем, что скрыто фильтрами */}
              {filtered && (
                <>
                  <p className="mt-1 text-ink-soft" style={{ fontSize: 13 }}>
                    {dt("Часть задач скрыта фильтрами", "Some tasks are hidden by filters")}
                  </p>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-3 rounded-[7px] bg-primary px-3 py-1.5 font-semibold text-white"
                    style={{ fontSize: 13 }}
                  >
                    {dt("Показать все", "Show all")}
                  </button>
                </>
              )}
            </div>
          )}

          {!r.loading && sections.map((sec) => {
            const shut = collapsed.has(sec.key);
            return (
              <section key={sec.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(sec.key)}
                  aria-expanded={!shut}
                  // Подпись группы по стенду: «ПРОСРОЧЕНО · 10» капсом с разрядкой на серой полосе.
                  className="flex w-full items-center gap-2 border-b border-line bg-surface-2 px-3 text-left font-semibold uppercase text-ink-soft"
                  style={{ height: 30, fontSize: 10.5, letterSpacing: "0.07em" }}
                >
                  <RoyIcon name="cright" size={10} strokeWidth={2.4} className={shut ? "" : "rotate-90"} />
                  <span>{sec.label} · {sec.tasks.length}</span>
                  {!!sec.late && (
                    <span className="font-normal text-pri-high">{dt(`просрочено ${sec.late}`, `${sec.late} overdue`)}</span>
                  )}
                </button>
                {!shut && nestSubtasks(sec.tasks).map(({ task: t, depth }) => (
                  <TaskTableRow
                    key={`${sec.key}:${t.id}`}
                    depth={depth}
                    progress={progress.get(t.id)}
                    task={t}
                    now={r.now}
                    users={users}
                    markets={markets}
                    labels={r.labels}
                    projectName={projectName(t.project_id)}
                    onOpen={() => setModalTask(t)}
                    onToggle={() => r.toggle(t)}
                    onPatch={(patch) => r.patchTask(t.id, patch)}
                    onChanged={r.reload}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </div>

      <TaskModal
        task={modalTask !== null && modalTask !== "new" ? modalTask : undefined}
        open={modalTask !== null}
        onClose={() => setModalTask(null)}
        onSaved={r.reload}
        drawer={isDesktop}
      />
      {labelEditor && (
        <LabelEditor label={labelEditor} open onClose={() => setLabelEditor(null)} onSaved={r.reloadLabels} />
      )}
    </div>
  );
}
