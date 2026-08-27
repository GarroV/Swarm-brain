"use client";
// Быстрые действия в строке задачи: СРОК / ПИНГ / ЦИКЛИЧНОСТЬ / ИСПОЛНИТЕЛЬ / РЫНОК / СПИСКИ
// без открытия карточки.
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
import { recurrenceOptions } from "@/lib/recurrenceLabels";
import { useDt } from "@/components/roy/nav";

const TRIGGER = "flex h-[26px] w-[26px] items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function TaskQuickActions({ task, users, markets, labels, onPatch, onChanged }: { task: Task; users: User[]; markets: string[]; labels: TaskLabel[]; onPatch: (patch: Partial<Task>) => void; onChanged: () => void }) {
  // Рынки — только рынки ВОРКСПЕЙСА (allowed_markets из /config); если не заданы — все из COUNTRY_NAMES.
  // Текущий рынок задачи добавляется, если его нет в списке (легаси-значение), чтобы выбор не «потерялся».
  const dt = useDt();
  const codes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  if (task.country && !codes.includes(task.country)) codes.push(task.country);

  // Оптимистично: сразу патчим строку локально, затем персист + сверка (reload).
  const commit = async (fields: UpdateTaskInput, patch: Partial<Task>) => {
    onPatch(patch);
    try { await updateTask(task.id, fields); } finally { onChanged(); }
  };

  return (
    <>
      <DatePicker
        compact
        value={task.due_date ?? ""}
        onChange={(iso) => commit({ due_date: iso || null }, { due_date: iso || null })}
        className={TRIGGER}
        placeholder=""
      />
      <DatePicker
        compact
        icon="bell"
        ariaLabel="Пинг"
        clearLabel="Убрать пинг"
        value={task.remind_date ?? ""}
        onChange={(iso) => commit({ remind_date: iso || null }, { remind_date: iso || null, reminded_at: null })}
        className={TRIGGER}
        placeholder=""
      />
      {/* Цикличность — только у задачи со сроком: день недели и число берутся из него, без срока
          считать следующее вхождение не от чего (то же правило, что в форме). */}
      {task.due_date && (
        <QuickPickPopover
          icon="repeat"
          ariaLabel={dt("Повторять", "Repeat")}
          clearable
          value={task.recur_freq ?? ""}
          options={(recurrenceOptions(task.due_date, task.recur_anchor_dom) ?? []).map((o) => ({
            id: o.freq,
            label: dt(o.ru, o.en),
          }))}
          onPick={(freq) => commit({ recur_freq: freq || null }, { recur_freq: freq || null })}
        />
      )}
      <QuickPickPopover
        icon="team"
        ariaLabel="Исполнитель"
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
          ariaLabel="Списки"
          multi
          options={labels.map((l) => ({ id: l.id, label: l.name, icon: ((l.icon as RoyIconName) || "tag") }))}
          selected={task.label_ids ?? []}
          onToggle={(id) => {
            const cur = task.label_ids ?? [];
            const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
            // Списки — личные: выбор списка делает задачу личной (метки только на личных).
            const fields: UpdateTaskInput = { label_ids: next };
            const patch: Partial<Task> = { label_ids: next };
            if (next.length > 0 && !task.is_private) { fields.is_private = true; patch.is_private = true; }
            commit(fields, patch);
          }}
        />
      )}
    </>
  );
}
