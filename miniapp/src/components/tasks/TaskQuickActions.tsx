"use client";
// Быстрые действия в строке задачи: СРОК / ПИНГ / ПОВТОР / ИСПОЛНИТЕЛЬ / РЫНОК / СПИСКИ
// без открытия карточки. Повтор — RecurrencePicker (быстрые варианты + меню правила).
// Срок — DatePicker (compact); исполнитель — QuickPickPopover; страна — CountryPopover
// (variant="icon", сетка флагов, единый компонент с формой TaskModal); списки — пиктограммы-метки
// (PictogramPicker, multi).
// Каждый выбор МГНОВЕННО патчит задачу локально (onPatch) и уже фоном шлёт PATCH + reload.
import { DatePicker } from "@/components/ui/DatePicker";
import { QuickPickPopover } from "@/components/tasks/QuickPickPopover";
import { PictogramPicker } from "@/components/tasks/PictogramPicker";
import { CountryPopover } from "@/components/tasks/CountryPopover";
import { COUNTRY_NAMES } from "@/lib/countries";
import { updateTask, type UpdateTaskInput, type TaskLabel } from "@/lib/api";
import { displayName } from "@/lib/utils";
import type { RoyIconName } from "@/components/roy/icons";
import type { Task, User } from "@/types";
import { recurValueOf, type RecurValue } from "@/lib/recurrenceLabels";
import { RecurrencePicker } from "@/components/tasks/RecurrencePicker";
import { useDt } from "@/components/roy/nav";

const TRIGGER = "flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Оптимистичная правка задачи: сразу патчим строку локально, затем персист + сверка (reload). */
export async function saveTaskPatch(
  id: string, fields: UpdateTaskInput, patch: Partial<Task>,
  onPatch: (patch: Partial<Task>) => void, onChanged: () => void,
) {
  onPatch(patch);
  try { await updateTask(id, fields); } finally { onChanged(); }
}

/** Переключение списка: списки личные, поэтому выбор списка делает задачу личной. */
export function toggleLabelPatch(task: Task, labelId: string): { fields: UpdateTaskInput; patch: Partial<Task> } {
  const cur = task.label_ids ?? [];
  const next = cur.includes(labelId) ? cur.filter((x) => x !== labelId) : [...cur, labelId];
  const fields: UpdateTaskInput = { label_ids: next };
  const patch: Partial<Task> = { label_ids: next };
  if (next.length > 0 && !task.is_private) { fields.is_private = true; patch.is_private = true; }
  return { fields, patch };
}

/** PATCH и локальный патч строки для выбранного правила повтора (null — снять). */
function recurrencePatch(v: RecurValue | null, due: string | null): { fields: UpdateTaskInput; patch: Partial<Task> } {
  const rule = {
    recur_freq: v?.freq ?? null,
    recur_interval: v?.interval ?? 1,
    recur_weekdays: v?.weekdays ?? null,
    recur_setpos: v?.setpos ?? null,
  };
  const withDue = due ? { due_date: due } : {};
  return { fields: { ...rule, ...withDue }, patch: { ...rule, ...withDue } };
}

export function TaskQuickActions({ task, users, markets, labels, onPatch, onChanged }: { task: Task; users: User[]; markets: string[]; labels: TaskLabel[]; onPatch: (patch: Partial<Task>) => void; onChanged: () => void }) {
  // Рынки — только рынки ВОРКСПЕЙСА (allowed_markets из /config); если не заданы — все из COUNTRY_NAMES.
  // Текущий рынок задачи добавляется, если его нет в списке (легаси-значение), чтобы выбор не «потерялся».
  const dt = useDt();
  const codes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  if (task.country && !codes.includes(task.country)) codes.push(task.country);

  const commit = (fields: UpdateTaskInput, patch: Partial<Task>) => saveTaskPatch(task.id, fields, patch, onPatch, onChanged);

  return (
    <>
      <DatePicker
        variant="compact"
        value={task.due_date ?? ""}
        onChange={(iso) => commit({ due_date: iso || null }, { due_date: iso || null })}
        className={TRIGGER}
        placeholder=""
      />
      <DatePicker
        variant="compact"
        icon="bell"
        ariaLabel={dt("Пинг", "Reminder")}
        clearLabel={dt("Убрать пинг", "Clear reminder")}
        value={task.remind_date ?? ""}
        onChange={(iso) => commit({ remind_date: iso || null }, { remind_date: iso || null, reminded_at: null })}
        className={TRIGGER}
        placeholder=""
      />
      {/* Повтор (#823): быстрые варианты и «Настроить…» — отдельное меню правила. Без срока
          меню подставляет срок = сегодня и шлёт его вместе с правилом. */}
      <RecurrencePicker
        variant="icon"
        value={recurValueOf(task)}
        due={task.due_date ?? ""}
        anchorDom={task.recur_anchor_dom}
        onChange={(v, due) => {
          const { fields, patch } = recurrencePatch(v, due);
          commit(fields, patch);
        }}
      />
      <QuickPickPopover
        icon="team"
        ariaLabel={dt("Исполнитель", "Assignee")}
        clearable
        value={task.assignee_telegram_ids?.[0] != null ? String(task.assignee_telegram_ids[0]) : ""}
        options={users.map((u) => ({ id: String(u.telegram_id), label: displayName(u.name) }))}
        onPick={(id) => commit({ assignee_telegram_id: id ? Number(id) : null }, { assignee_telegram_ids: id ? [Number(id)] : [] })}
      />
      <CountryPopover
        variant="icon"
        value={task.country ?? ""}
        codes={codes}
        onChange={(code) => commit({ country: code || null }, { country: code || null })}
      />
      {labels.length > 0 && (
        <PictogramPicker
          triggerIcon="tag"
          ariaLabel={dt("Списки", "Lists")}
          multi
          options={labels.map((l) => ({ id: l.id, label: l.name, icon: ((l.icon as RoyIconName) || "tag") }))}
          selected={task.label_ids ?? []}
          onToggle={(id) => {
            const { fields, patch } = toggleLabelPatch(task, id);
            commit(fields, patch);
          }}
        />
      )}
    </>
  );
}
