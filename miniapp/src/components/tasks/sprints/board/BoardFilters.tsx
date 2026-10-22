"use client";
import { ToolbarButton } from "@/components/tasks/table/Menu";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { PILL_BTN } from "../atoms";
import type { BoardFilter } from "./boardModel";

// Строка над доской (спека, «Доска»): поиск, «Все люди», «Требуют внимания», «История спринтов».
// Поиск и человек действуют на ВСЕ колонки, включая мастер-план. Пространство и переключатель вида
// стоят выше, в полосе спринта, — здесь их не дублируем.

export function BoardFilters(
  { value, onChange, people, attentionCount, onHistory }: {
    value: BoardFilter;
    onChange: (next: BoardFilter) => void;
    /** Имена исполнителей по алфавиту. */
    people: readonly string[];
    attentionCount: number;
    onHistory: () => void;
  },
) {
  const dt = useDt();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pb-2 pt-2.5 lg:px-5">
      <label className="relative">
        <span className="sr-only">
          {dt("Поиск по задачам", "Search tasks")}
        </span>
        <RoyIcon
          name="search"
          size={13}
          strokeWidth={2}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute"
        />
        <input
          type="search"
          value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
          placeholder={dt("Поиск", "Search")}
          className="h-[30px] w-[180px] rounded-full border border-line-2 bg-surface pl-8 pr-3 text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-accent-line max-sm:w-[140px]"
          style={{ fontSize: 12.5 }}
        />
      </label>
      <label>
        <span className="sr-only">{dt("Исполнитель", "Assignee")}</span>
        <select
          value={value.person ?? ""}
          onChange={(e) =>
            onChange({ ...value, person: e.target.value || null })}
          className="h-[30px] max-w-[170px] rounded-full border border-line-2 bg-surface px-3 text-ink-soft outline-none focus:border-accent-line"
          style={{ fontSize: 12.5 }}
        >
          <option value="">{dt("Все люди", "Everyone")}</option>
          {people.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <ToolbarButton
        on={value.attention}
        onClick={() => onChange({ ...value, attention: !value.attention })}
        title={dt(
          "Риск, проблема, просроченный срок, перенос без причины",
          "At risk, problem, overdue, moved without a reason",
        )}
      >
        {dt("Требуют внимания", "Need attention")}
        <span className="font-mono">{attentionCount}</span>
      </ToolbarButton>
      <button
        type="button"
        onClick={onHistory}
        className={`${PILL_BTN} ml-auto`}
        style={{ fontSize: 12.5 }}
      >
        {dt("История спринтов", "Sprint history")}
      </button>
    </div>
  );
}
