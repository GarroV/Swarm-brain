"use client";
import { useEffect, useRef, useState } from "react";
import { useDt } from "./nav";
import { RoyIcon } from "./icons";
import { countryCode, countryFlag } from "@/lib/countries";
import { effectiveAssigneeId, resolveAssigneeId, taskCountLabel, type ProposedTask } from "@/lib/proposedTasks";
import type { User } from "@/types";
import { formatDate } from "@/lib/displayFormat";

// Разбор задач, предложенных из встречи, — прямо во вкладке «Задачи», под кнопкой
// «Сгенерировать». До 07.10.2026 разбор открывался листом поверх затемнённого экрана: это
// решение прежнего интерфейса, где правая панель была узкой. В нынешнем вкладка широкая, и лист
// выглядел «максимально нелогично и странно» (владелец, issue #830) — затемнения, отдельного
// экрана и анимаций больше нет. Каждая задача по-прежнему видна целиком, согласие — одной
// кнопкой на выбранные.

export type DraftTask = ProposedTask & { _key: string; _selected: boolean };

function fmtDate(iso: string | null): string | null {
  return formatDate(iso, { day: "numeric", month: "short" });
}

export type HarvestActions = {
  toggle: (key: string) => void;
  toggleAll: (next: boolean) => void;
  rename: (key: string, title: string) => void;
  remove: (key: string) => void;
  edit: (task: DraftTask) => void;
  addOwn: () => void;
  commit: () => void;
};

type Props = {
  /** Прямоугольник блока-источника, снятый в момент открытия: из него «разъезжается» лист. */
  tasks: DraftTask[];
  users: User[];
  /** Кто разбирает: задача без названного ответственного уйдёт на него — строка показывает это ДО публикации. */
  meId: number | null;
  /** Идёт массовое добавление: кнопки заблокированы, лист не закрывается сам. */
  busy: boolean;
  /** Модель ещё пишет: внизу висит заготовка, «Задач не найдено» не показываем раньше времени. */
  streaming: boolean;
  actions: HarvestActions;
};

export function TasksHarvest({ tasks, users, meId, busy, streaming, actions }: Props) {
  const dt = useDt();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const selected = tasks.filter((t) => t._selected);
  const allSelected = tasks.length > 0 && selected.length === tasks.length;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-soft" style={{ fontSize: 12.5, margin: "0 4px" }} aria-live="polite">
        {streaming
          ? (tasks.length === 0
              ? dt("Читаю тезисы…", "Reading the notes…")
              : dt(`Нашёл ${tasks.length}, ищу дальше…`, `${tasks.length} so far, still reading…`))
          : tasks.length === 0
            ? dt("Задач не найдено.", "No tasks found.")
            : dt(
                `Найдено ${tasks.length} · выбрано ${selected.length}`,
                `${tasks.length} found · ${selected.length} selected`,
              )}
      </p>

      {tasks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <HarvestRow
              key={task._key}
              task={task}
              users={users}
              meId={meId}
              busy={busy}
              editing={editingKey === task._key}
              onStartEdit={() => setEditingKey(task._key)}
              onStopEdit={() => setEditingKey(null)}
              actions={actions}
            />
          ))}
        </ul>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => actions.toggleAll(!allSelected)}
            disabled={busy || streaming}
            className="rounded-full border border-line bg-surface font-semibold text-ink-soft transition-colors hover:border-line-2 disabled:opacity-50"
            style={{ padding: "6px 12px", fontSize: 12, minHeight: 40 }}
          >
            {allSelected ? dt("Снять все", "Clear all") : dt("Выбрать все", "Select all")}
          </button>
          <button
            type="button"
            onClick={actions.commit}
            disabled={busy || streaming || selected.length === 0}
            className="ml-auto inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:opacity-60"
            // Пока ничего не выбрано, кнопка НЕ выглядит главной: акцентная заливка на
            // неработающей кнопке читается как «нажми», и человек тыкает в пустоту.
            style={(selected.length === 0 || streaming) && !busy
              ? { padding: "10px 16px", fontSize: 14, minHeight: 40, background: "var(--surface-2)", color: "var(--ink-mute)", border: "1px solid var(--line)" }
              : { padding: "10px 16px", fontSize: 14, minHeight: 40, background: "var(--accent-ink)", color: "var(--card)", border: 0 }}
          >
            <RoyIcon name="check" size={16} strokeWidth={2.1} />
            {streaming
              ? dt("Ещё ищу…", "Still reading…")
              : busy
              ? dt("Добавляем…", "Adding…")
              // Ноль выбранных — говорим ПОЧЕМУ кнопка не нажимается, а не «Добавить 0 задач».
              : selected.length === 0
                ? dt("Ничего не выбрано", "Nothing selected")
                : dt(`Добавить ${taskCountLabel(selected.length)}`, `Add ${selected.length} task${selected.length === 1 ? "" : "s"}`)}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Строка разбора ────────────────────────────────────────────────────────────

type RowProps = {
  task: DraftTask;
  users: User[];
  meId: number | null;
  busy: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  actions: HarvestActions;
};

function HarvestRow({ task, users, meId, busy, editing, onStartEdit, onStopEdit, actions }: RowProps) {
  const dt = useDt();
  // Тот же расчёт, что и при публикации: строка обязана показывать РЕАЛЬНОГО будущего
  // исполнителя, иначе человек соглашается не на то, что уедет в базу.
  const assigneeId = effectiveAssigneeId(task.assignee, users, meId);
  // Имя в тезисах было, но такого человека в команде нет (или их двое) → по решению владельца
  // задача уходит на разбирающего. Исходное имя всё равно показываем: подмена ответственного
  // молча — это то же враньё интерфейса, от которого чинили пропажу задач.
  const fellBackToMe = Boolean(task.assignee?.trim()) && resolveAssigneeId(task.assignee, users) == null;
  const matched = assigneeId ? users.find((u) => u.telegram_id === assigneeId) : undefined;
  const due = fmtDate(task.due_date);

  return (
    <li
      className="rounded-[10px] border border-line bg-surface transition-colors hover:border-line-2"
      style={{ opacity: task._selected ? 1 : 0.55 }}
    >
      <div className="flex items-start gap-2 p-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={task._selected}
          aria-label={dt("Взять задачу", "Include task")}
          onClick={() => actions.toggle(task._key)}
          disabled={busy}
          className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded-[8px] border transition-colors duration-150 disabled:opacity-50"
          style={{
            width: 22,
            height: 22,
            borderColor: task._selected ? "var(--accent-ink)" : "var(--line-2)",
            background: task._selected ? "var(--accent-ink)" : "transparent",
            color: "var(--card)",
          }}
        >
          {task._selected && <RoyIcon name="check" size={13} strokeWidth={2.4} />}
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <TitleEditor
              value={task.title}
              onCommit={(next) => { actions.rename(task._key, next); onStopEdit(); }}
              onCancel={onStopEdit}
            />
          ) : (
            <button
              type="button"
              onClick={onStartEdit}
              disabled={busy}
              className="w-full rounded-[8px] px-1 py-0.5 text-left font-medium text-ink transition-colors hover:bg-surface-2"
              style={{ fontSize: 13.5, lineHeight: 1.35 }}
            >
              {task.title}
            </button>
          )}

          {task.description && (
            <p className="px-1 pt-1 text-ink-mute" style={{ fontSize: 12, lineHeight: 1.4 }}>
              {task.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1.5 text-ink-mute" style={{ fontSize: 11.5 }}>
            <span className="inline-flex items-center gap-1">
              <RoyIcon name="team" size={12} strokeWidth={1.8} />
              {matched
                ? fellBackToMe
                  // Имя из тезисов в команде не нашлось: задача уходит на разбирающего, но рядом
                  // остаётся исходное имя — иначе человек не поймёт, почему задача вдруг его.
                  ? <span title={dt(
                      `«${task.assignee}» в команде не найден — задача уйдёт на вас`,
                      `“${task.assignee}” is not in the team — the task will go to you`,
                    )}>
                      {matched.name} <span className="text-[var(--pri-high)]">·&nbsp;{dt(`вместо «${task.assignee}»`, `instead of “${task.assignee}”`)}</span>
                    </span>
                  : matched.name
                : task.assignee
                  // Ни в команде, ни на кого перевесить (личность разбирающего неизвестна).
                  ? <span title={dt("Не найден в команде — задача создастся без исполнителя", "Not found in the team — the task will be created unassigned")}>
                      {task.assignee} <span className="text-[var(--pri-high)]">·&nbsp;{dt("не найден", "not found")}</span>
                    </span>
                  : dt("Не назначен", "Unassigned")}
            </span>
            {due && (
              <span className="inline-flex items-center gap-1">
                <RoyIcon name="cal" size={12} strokeWidth={1.8} />
                {dt(`до ${due}`, `by ${due}`)}
              </span>
            )}
            {task.country && (
              <span
                className="inline-flex items-center gap-1 font-semibold text-ink-soft bg-surface-2 border border-line-2"
                style={{ borderRadius: 6, padding: "1px 6px", fontSize: 10.5 }}
              >
                {countryFlag(task.country)} {countryCode(task.country)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            aria-label={dt("Открыть в редакторе задачи", "Open in task editor")}
            onClick={() => actions.edit(task)}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full border border-line bg-surface text-ink-mute transition-[opacity,border-color] hover:border-line-2 hover:opacity-70 disabled:opacity-40"
            style={{ width: 36, height: 36 }}
          >
            <RoyIcon name="pencil" size={13} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            aria-label={dt("Убрать предложенную задачу", "Discard suggestion")}
            onClick={() => actions.remove(task._key)}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full border border-line bg-surface text-ink-mute transition-[opacity,border-color] hover:border-line-2 hover:opacity-70 disabled:opacity-40"
            style={{ width: 36, height: 36 }}
          >
            <RoyIcon name="x" size={13} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </li>
  );
}

// Правка заголовка прямо в строке — самое частое действие на вычитке (переформулировать).
// Остальные поля живут в TaskModal: дублировать его тут значило бы развести две формы задачи.
function TitleEditor({ value, onCommit, onCancel }: { value: string; onCommit: (next: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const commit = () => {
    const next = draft.trim();
    // Пустой заголовок задачу обессмысливает — считаем это отменой, а не стиранием названия.
    if (next.length === 0) { onCancel(); return; }
    onCommit(next);
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
        // Esc гасим здесь: иначе Base UI примет его за «закрыть лист» и правка утащит за собой
        // всё окно разбора.
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
      }}
      className="w-full resize-none rounded-[8px] border border-[var(--accent-ink)] bg-surface px-1.5 py-1 font-medium text-ink outline-none"
      style={{ fontSize: 13.5, lineHeight: 1.35 }}
    />
  );
}
