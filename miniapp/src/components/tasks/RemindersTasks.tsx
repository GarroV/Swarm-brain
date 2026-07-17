"use client";
import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { SmartListNav } from "./SmartListNav";
import { TaskRow } from "./TaskRow";
import { LensToggle } from "./LensToggle";
import { TaskQuickActions } from "./TaskQuickActions";
import { useReminderTasks } from "./useReminderTasks";
import { LabelEditor } from "./LabelEditor";
import { SMART_LISTS } from "@/lib/smartLists";
import { fetchUsers, fetchConfig, type TaskLabel } from "@/lib/api";
import type { Task, User } from "@/types";
import { TaskModal } from "@/components/TaskModal";
import { RoyIcon } from "@/components/roy/icons";
import { useConfirm } from "@/components/ui/confirm";

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "задача";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "задачи";
  return "задач";
}

// Десктопный Reminders-вид «Список»: рельс смарт-списков слева + спокойный чек-лист справа.
export function RemindersTasks() {
  const r = useReminderTasks();
  const confirm = useConfirm();
  const [modalTask, setModalTask] = useState<Task | "new" | null>(null);
  const [draft, setDraft] = useState("");
  const [labelEditor, setLabelEditor] = useState<TaskLabel | "new" | null>(null);
  // Свёрнутые секции группировки (по label): клик по заголовку прячет/раскрывает задачи.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  // Исполнители + рынки воркспейса для быстрого выбора — грузим один раз (не на каждую строку).
  const [users, setUsers] = useState<User[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => {});
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => {});
  }, []);

  const activeDef = SMART_LISTS.find((s) => s.id === r.activeList)!;
  // Активная персональная метка перебивает смарт-список и группировки.
  const activeLabel = r.activeLabelId ? r.labels.find((l) => l.id === r.activeLabelId) ?? null : null;
  const isLabelView = !!activeLabel;
  const byMarket = !isLabelView && r.lens === "market";
  const byStaff = !isLabelView && r.lens === "staff";
  const grouped = byMarket || byStaff;
  const groups: { label: string; tasks: Task[] }[] = byStaff ? r.staffGroups : r.marketGroups;
  const visibleRows = isLabelView ? r.visibleByLabel : r.visible;
  const total = grouped ? groups.reduce((n, g) => n + g.tasks.length, 0) : visibleRows.length;
  const headerTitle = isLabelView ? activeLabel!.name : activeDef.label;
  // В группировке по сотруднику исполнитель — заголовок секции, в строке его не дублируем.
  const showAssignee = !isLabelView && r.lens !== "mine" && !byStaff;

  const submitDraft = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const v = draft;
    setDraft("");
    r.quickAdd(v, r.activeLabelId ?? undefined);
  };

  const onDelete = async (t: Task) => {
    if (!(await confirm({ title: `Удалить «${t.title}»?`, description: "Задача будет удалена без возможности восстановления." }))) return;
    try { await r.remove(t); } catch { /* hook сделает reload */ }
  };

  const rowTrailing = (t: Task) => (
    // stopPropagation на всём блоке действий: клики по быстрому меню (срок/исполнитель/страна)
    // и кнопкам НЕ должны всплывать на строку — иначе после выбора открывается карточка правки.
    <span
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
    >
      {/* Быстро задать срок / исполнителя / страну, не открывая карточку */}
      <TaskQuickActions task={t} users={users} markets={markets} labels={r.labels} myId={r.me?.telegram_id ?? null} onChanged={r.reload} />
      <IconBtn label="Изменить" color="var(--accent-ink)" onClick={(e) => { e.stopPropagation(); setModalTask(t); }}>
        <RoyIcon name="pencil" size={15} strokeWidth={1.9} />
      </IconBtn>
      <IconBtn label="Удалить" color="var(--pri-high)" onClick={(e) => { e.stopPropagation(); onDelete(t); }}>
        <RoyIcon name="trash" size={15} strokeWidth={1.9} />
      </IconBtn>
    </span>
  );

  const renderRow = (t: Task) => (
    <div
      key={t.id}
      onClick={() => setModalTask(t)}
      className="group flex cursor-pointer border-b border-line transition-colors hover:bg-surface-2"
    >
      <TaskRow task={t} now={r.now} showAssignee={showAssignee} onToggle={() => r.toggle(t)} trailing={rowTrailing(t)} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <SmartListNav
        variant="rail"
        active={r.activeList}
        counts={r.counts}
        onSelect={(id) => { r.setActiveLabelId(null); r.setActiveList(id); }}
        query={r.query}
        onQuery={r.setQuery}
        allStaffActive={r.lens === "staff"}
        onAllStaff={r.me?.is_admin ? () => { r.setActiveLabelId(null); r.setLens("staff"); r.setActiveList("all"); } : undefined}
        labels={r.labels}
        labelCounts={r.labelCounts}
        activeLabelId={r.activeLabelId}
        onSelectLabel={(id) => r.setActiveLabelId(id)}
        onCreateLabel={() => setLabelEditor("new")}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="truncate font-bold text-accent-ink" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>{headerTitle}</h1>
            <span className="shrink-0 text-ink-mute" style={{ fontSize: 13 }}>{total} {plural(total)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LensToggle lens={r.lens} onChange={r.setLens} />
            <button
              type="button"
              onClick={() => setModalTask("new")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 font-semibold text-white transition-transform active:scale-[0.97]"
              style={{ fontSize: 13 }}
            >
              <RoyIcon name="plus" size={15} strokeWidth={2.3} />
              Новая задача
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {r.loading && [0, 1, 2].map((i) => <div key={i} className="roy-shim my-1" style={{ height: 56, borderRadius: 12 }} />)}

          {!r.loading && total === 0 && (
            <p className="py-12 text-center text-ink-soft" style={{ fontSize: 13.5 }}>
              {r.activeList === "done" ? "Пусто — всё разобрано" : "Здесь пока пусто"}
            </p>
          )}

          {!r.loading && grouped &&
            groups.map((g) => {
              const open = !collapsed.has(g.label);
              return (
                <section key={g.label} className="mb-4">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.label)}
                    className="mb-1 flex w-full items-center gap-2 pt-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-[8px]"
                    aria-expanded={open}
                  >
                    <RoyIcon name="cright" size={12} strokeWidth={2.2} className={`text-ink-mute transition-transform ${open ? "rotate-90" : ""}`} />
                    <RoyIcon name={byStaff ? "team" : "globe"} size={13} className="text-ink-mute" />
                    <span className="font-mono font-semibold uppercase text-ink-mute" style={{ fontSize: 11, letterSpacing: "0.08em" }}>{g.label}</span>
                    <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{g.tasks.length}</span>
                  </button>
                  {open && g.tasks.map(renderRow)}
                </section>
              );
            })}

          {!r.loading && !grouped && visibleRows.map(renderRow)}

          {/* Инлайн быстрое добавление */}
          {!r.loading && (isLabelView || r.activeList !== "done") && (
            <label className="mt-1 flex items-center gap-3 px-1 py-3 text-ink-soft">
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 border-primary text-primary">
                <RoyIcon name="plus" size={13} strokeWidth={2.4} />
              </span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={submitDraft}
                placeholder="Новое напоминание"
                className="w-full bg-transparent outline-none placeholder:text-ink-mute"
                style={{ fontSize: 14.5 }}
              />
            </label>
          )}
        </div>
      </div>

      <TaskModal
        task={modalTask !== null && modalTask !== "new" ? modalTask : undefined}
        open={modalTask !== null}
        onClose={() => setModalTask(null)}
        onSaved={r.reload}
      />

      {labelEditor && (
        <LabelEditor label={labelEditor} open onClose={() => setLabelEditor(null)} onSaved={r.reloadLabels} />
      )}
    </div>
  );
}

function IconBtn({ label, onClick, color, children }: { label: string; onClick: (e: MouseEvent) => void; color: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      style={{ width: 26, height: 26, color }}
    >
      {children}
    </button>
  );
}
