"use client";
// Быстрые действия в строке задачи: СРОК / ИСПОЛНИТЕЛЬ / РЫНОК / СПИСКИ без открытия карточки.
// Срок — DatePicker (compact); исполнитель — QuickPickPopover; рынок — пиктограммы-флаги
// (PictogramPicker, single, «Global» = пусто); списки — пиктограммы-метки (PictogramPicker, multi,
// только на своей личной задаче). Каждый выбор сразу шлёт PATCH (updateTask) и просит reload.
import { DatePicker } from "@/components/ui/DatePicker";
import { QuickPickPopover } from "@/components/tasks/QuickPickPopover";
import { PictogramPicker, type PictoOption } from "@/components/tasks/PictogramPicker";
import { COUNTRY_NAMES, countryName, countryFlag } from "@/lib/countries";
import { updateTask, type UpdateTaskInput, type TaskLabel } from "@/lib/api";
import { displayName } from "@/lib/utils";
import type { RoyIconName } from "@/components/roy/icons";
import type { Task, User } from "@/types";

const TRIGGER = "flex h-[26px] w-[26px] items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function TaskQuickActions({ task, users, markets, labels, myId, onChanged }: { task: Task; users: User[]; markets: string[]; labels: TaskLabel[]; myId: number | null; onChanged: () => void }) {
  // Рынки — только рынки ВОРКСПЕЙСА (allowed_markets из /config); если не заданы — все из COUNTRY_NAMES.
  // Текущий рынок задачи добавляется, если его нет в списке (легаси-значение), чтобы выбор не «потерялся».
  const codes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  if (task.country && !codes.includes(task.country)) codes.push(task.country);
  const marketOpts: PictoOption[] = [
    { id: "", label: "Global", icon: "globe" },
    ...codes.map((code) => ({ id: code, label: countryName(code), flag: countryFlag(code) })),
  ];

  // Списки-метки доступны только на своей личной задаче.
  const canLabel = task.is_private && task.owner_id != null && task.owner_id === myId;

  const commit = async (fields: UpdateTaskInput) => {
    try { await updateTask(task.id, fields); } finally { onChanged(); }
  };

  return (
    <>
      <DatePicker
        compact
        value={task.due_date ?? ""}
        onChange={(iso) => commit({ due_date: iso || null })}
        className={TRIGGER}
        placeholder=""
      />
      <QuickPickPopover
        icon="team"
        ariaLabel="Исполнитель"
        clearable
        value={task.assignee_telegram_ids?.[0] != null ? String(task.assignee_telegram_ids[0]) : ""}
        options={users.map((u) => ({ id: String(u.telegram_id), label: displayName(u.name) }))}
        onPick={(id) => commit({ assignee_telegram_id: id ? Number(id) : null })}
      />
      <PictogramPicker
        triggerIcon="globe"
        ariaLabel="Рынок"
        multi={false}
        options={marketOpts}
        selected={task.country ? [task.country] : [""]}
        onToggle={(code) => commit({ country: code || null })}
      />
      {canLabel && labels.length > 0 && (
        <PictogramPicker
          triggerIcon="tag"
          ariaLabel="Списки"
          multi
          options={labels.map((l) => ({ id: l.id, label: l.name, icon: ((l.icon as RoyIconName) || "tag") }))}
          selected={task.label_ids ?? []}
          onToggle={(id) => {
            const cur = task.label_ids ?? [];
            const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
            commit({ label_ids: next });
          }}
        />
      )}
    </>
  );
}
