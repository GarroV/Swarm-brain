"use client";
import { cn, displayName } from "@/lib/utils";
import type { User } from "@/types";
import type { TaskLabel } from "@/lib/api";
import { countryName } from "@/lib/countries";
import type { Lens } from "@/lib/smartLists";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { RangePicker } from "@/components/ui/RangePicker";
import type { useReminderTasks } from "@/components/tasks/useReminderTasks";
import { Menu, ToolbarButton, type MenuItem } from "./Menu";

// Панель фильтров задач — ОДНА строка (стенд: screens-tasks.js → tasksToolbar): чья работа
// (переключатель), готовые (один тумблер), фильтры — меню, режимы вида — пиктограммы. Справа поиск, счётчик и «＋ Задача».

export type ToolbarState = {
  assignee: number | null;
  setAssignee: (id: number | null) => void;
  market: string | null;
  setMarket: (code: string | null) => void;
  users: User[];
  markets: string[];
  shown: number;
  onNew: () => void;
  onNewLabel: () => void;
  onEditLabel: (l: TaskLabel) => void;
  calView: boolean;
  setCalView: (on: boolean) => void;
};

const LENSES: Array<[Exclude<Lens, "staff">, string, string]> = [
  ["mine", "Мои", "Mine"],
  ["team", "Командные", "Team"],
  ["all", "Все", "All"],
];

export function TasksToolbar({ r, s }: { r: ReturnType<typeof useReminderTasks>; s: ToolbarState }) {
  const dt = useDt();
  const admin = !!r.me?.is_admin;
  // Выбран человек — смотрим ВСЮ его работу, делить на «Мои / Командные / Все» нечего:
  // переключатель гаснет (решение владельца 22.09.2026), а не прячется.
  const lensOff = s.assignee != null;
  const doneOn = r.statuses.has("done");
  const recurOnly = r.activeList === "recurring";
  const activeLabel = r.labels.find((l) => l.id === r.activeLabelId) ?? null;

  const staffItems: MenuItem[] = [
    { key: "off", label: dt("Моё и командное", "Mine & team"), on: !r.allStaff && s.assignee == null,
      action: true, onPick: () => { s.setAssignee(null); r.setAllStaff(false); } },
    { key: "all", label: dt("Все сотрудники", "All staff"), on: r.allStaff && s.assignee == null,
      action: true, onPick: () => { s.setAssignee(null); r.setActiveLabelId(null); r.setAllStaff(true); } },
    ...s.users
      .filter((u) => u.telegram_id !== r.me?.telegram_id)
      .map((u) => ({
        key: String(u.telegram_id),
        label: displayName(u.name),
        on: s.assignee === u.telegram_id,
        action: true,
        // Чужие задачи видны только в админском охвате — выбор человека его включает.
        onPick: () => { r.setAllStaff(true); s.setAssignee(u.telegram_id); },
      })),
  ];
  const staffName = s.assignee != null
    ? displayName(s.users.find((u) => u.telegram_id === s.assignee)?.name ?? "")
    : "";
  const staffLabel = s.assignee != null
    ? `${dt("Сотрудник", "Person")}: ${staffName}`
    : r.allStaff ? dt("Сотрудники: все", "Staff: all") : dt("Сотрудники", "Staff");

  const marketItems: MenuItem[] = [
    { key: "", label: dt("Все рынки", "All markets"), on: s.market == null, action: true, onPick: () => s.setMarket(null) },
    ...s.markets.map((c) => ({
      key: c,
      label: <><span className="mr-1.5 font-mono text-ink-mute">{c}</span>{countryName(c)}</>,
      on: s.market === c,
      action: true,
      onPick: () => s.setMarket(c),
    })),
  ];

  const labelItems: MenuItem[] = [
    { key: "", label: dt("Все задачи", "All tasks"), on: !r.activeLabelId, action: true, onPick: () => r.setActiveLabelId(null) },
    ...r.labels.map((l) => ({
      key: l.id,
      label: l.name,
      on: r.activeLabelId === l.id,
      action: true,
      onPick: () => r.setActiveLabelId(l.id),
    })),
  ];

  // Бывшее меню «Ещё» — пиктограммы в строке (решение владельца 2026-09-25: «заменим
  // пиктограммами? место есть»). Календарный вид — только у админа, как у стенда.
  const toggles: { key: string; icon: RoyIconName; label: string; on: boolean; onClick: () => void }[] = [
    { key: "market", icon: "globe", label: dt("Группировать по рынкам", "Group by market"), on: r.byMarket, onClick: () => r.setByMarket((v) => !v) },
    { key: "recur", icon: "repeat", label: dt("Только регулярные", "Recurring only"), on: recurOnly,
      onClick: () => r.setActiveList(recurOnly ? "all" : "recurring") },
    ...(admin ? [{ key: "cal", icon: "cal" as RoyIconName, label: dt("Календарный вид", "Calendar view"), on: s.calView, onClick: () => s.setCalView(!s.calView) }] : []),
  ];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2">
      <span
        // Линзы — сегмент по .seg стенда: общая рамка, выбранная ячейка залита акцентом.
        className={cn("inline-flex overflow-hidden rounded-[8px] border border-line-2 bg-surface", lensOff && "opacity-50")}
        title={lensOff ? dt("Выбран сотрудник — показана вся его работа", "A person is selected — showing all their work") : undefined}
      >
        {LENSES.map(([id, ru, en]) => (
          <button
            key={id}
            type="button"
            disabled={lensOff}
            onClick={() => r.setLens(id)}
            className={cn(
              "border-r border-line-2 px-3 font-medium transition-colors last:border-r-0",
              r.lens === id ? "bg-primary font-semibold text-primary-foreground" : "text-ink-soft hover:bg-surface-2 hover:text-ink",
            )}
            style={{ fontSize: 12.5, height: 28 }}
          >
            {dt(ru, en)}
          </button>
        ))}
      </span>
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolbarButton
        on={doneOn}
        onClick={() => r.toggleStatus("done")}
        title={doneOn ? dt("Завершённые показаны", "Done tasks shown") : dt("Завершённые скрыты", "Done tasks hidden")}
      >
        <span className="size-[7px] rounded-full bg-status-done" />
        {dt("Завершённые", "Completed")}
      </ToolbarButton>
      {admin && <Menu label={staffLabel} on={r.allStaff || s.assignee != null} items={staffItems} />}
      <Menu
        label={s.market ? `${dt("Рынок", "Market")}: ${s.market}` : dt("Рынок", "Market")}
        on={s.market != null}
        items={marketItems}
      />
      <RangePicker value={r.range} onChange={r.setRange} variant="toolbar" />
      <Menu
        label={activeLabel ? `${dt("Список", "List")}: ${activeLabel.name}` : dt("Списки", "Lists")}
        on={!!activeLabel}
        items={labelItems}
        footer={
          <div className="mt-1 flex gap-1 border-t border-line pt-1">
            <button type="button" onClick={s.onNewLabel} className="flex-1 rounded-[6px] px-2.5 py-1.5 text-left text-accent-ink hover:bg-surface-2" style={{ fontSize: 12.5 }}>
              ＋ {dt("Новый список", "New list")}
            </button>
            {activeLabel && (
              <button type="button" onClick={() => s.onEditLabel(activeLabel)} className="rounded-[6px] px-2.5 py-1.5 text-ink-soft hover:bg-surface-2" style={{ fontSize: 12.5 }}>
                {dt("Изменить", "Edit")}
              </button>
            )}
          </div>
        }
      />
      <span className="inline-flex gap-1">
        {toggles.map((t) => (
          <ToolbarButton key={t.key} icon on={t.on} onClick={t.onClick} title={t.label}>
            <RoyIcon name={t.icon} size={15} strokeWidth={1.8} />
          </ToolbarButton>
        ))}
      </span>

      <div className="ml-auto flex items-center gap-2.5">
        {/* Фильтр свёрнут в пиктограмму, пока пуст и не в фокусе: так панель влезает в одну
            строку на 1300px. Клик по пиктограмме (это label) ставит фокус и раскрывает поле. */}
        <label title={dt("Фильтр по названию", "Filter by title")}
          className="group flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line-2 bg-surface px-[7px] text-ink-mute hover:border-ink-mute/40 focus-within:border-primary">
          <RoyIcon name="search" size={14} />
          <input
            value={r.query}
            onChange={(e) => r.setQuery(e.target.value)}
            placeholder={dt("Фильтр", "Filter")}
            aria-label={dt("Фильтр по названию", "Filter by title")}
            className={cn(
              "bg-transparent text-ink outline-none transition-[width] placeholder:text-ink-mute group-focus-within:w-[140px]",
              r.query ? "w-[140px]" : "w-0",
            )}
            style={{ fontSize: 12.5 }}
          />
        </label>
        <span className="whitespace-nowrap text-ink-mute" style={{ fontSize: 12.5 }}>
          {dt("Показано", "Shown")} <b className="text-ink">{s.shown}</b>
        </span>
        <button
          type="button"
          onClick={s.onNew}
          className="inline-flex h-[30px] items-center gap-1 rounded-[7px] bg-primary px-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.97]"
          style={{ fontSize: 12.5 }}
        >
          <RoyIcon name="plus" size={13} strokeWidth={2.4} />
          {dt("Задача", "Task")}
        </button>
      </div>
    </div>
  );
}
