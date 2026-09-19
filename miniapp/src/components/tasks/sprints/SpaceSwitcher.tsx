"use client";
import { useEffect, useRef, useState } from "react";
import type { Sprint } from "@/types";
import { useDt } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";
import { createSprint, deleteSprint, updateSprint } from "@/lib/api";

// Пространство — вкладка доски со своей чередой спринтов. Переключатель отдельным рядом
// над спринтами, потому что порядок вопросов у человека такой: сперва «какой проект», потом
// «какой спринт». Обратный порядок заставляет искать свой спринт среди чужих.
//
// ⚠️ `Sprint` здесь — ВКЛАДКА доски (таблица `sprints`, имя историческое), а не период
// работы: период — `SprintCycle`.
//
// Управление пространствами живёт здесь же, а не на экране: экран уже за 1000 строк (#265),
// а создание, переименование и удаление — это ровно про этот ряд чипов. Серверная часть
// существовала и раньше (`POST/PATCH/DELETE /sprints`), не хватало входа с экрана (#403).

/** null — «Без пространства»: спринты, заведённые до пространств, и они не должны пропасть. */
export const NO_SPACE = null;

export function SpaceSwitcher(
  { spaces, value, onChange, counts, showOrphans = false, canManage = false, onChanged }: {
    spaces: Sprint[];
    value: string | null;
    onChange: (id: string | null) => void;
    counts?: Map<string | null, number>;
    showOrphans?: boolean;
    /** Правка и удаление пространства — под админом, как и на сервере. Создание доступно всем. */
    canManage?: boolean;
    /** Перезагрузить список после изменения. Без него ряд разойдётся с сервером. */
    onChanged?: () => void | Promise<void>;
  },
) {
  const dt = useDt();
  const confirm = useConfirm();
  // draft: null — ничего не редактируем; {id: null} — создаём новое; {id} — переименовываем.
  const [draft, setDraft] = useState<{ id: string | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft) inputRef.current?.focus();
  }, [draft]);

  if (spaces.length === 0 && !showOrphans && !onChanged) return null;

  const active = spaces.find((s) => s.id === value) ?? null;

  async function save() {
    const name = draft?.name.trim();
    if (!name) {
      setErr(dt("Введите название", "Enter a name"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (draft!.id === null) {
        // Пространство — именованный фильтр, даты ему не нужны, но схема спринта их требует:
        // подставляем сегодняшнюю, человеку они не показываются.
        const today = new Date().toISOString().slice(0, 10);
        const created = await createSprint({ name, start_date: today, end_date: today });
        await onChanged?.();
        onChange(created.id);
      } else {
        await updateSprint(draft!.id, { name });
        await onChanged?.();
      }
      setDraft(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось сохранить", "Could not save"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!active) return;
    const inside = counts?.get(active.id) ?? 0;
    const ok = await confirm({
      title: dt(`Удалить пространство «${active.name}»?`, `Delete space “${active.name}”?`),
      description: inside > 0
        ? dt(
          `Внутри ${inside} спринт(ов) — они удалятся вместе с пространством. Задачи останутся, просто выйдут из него.`,
          `It holds ${inside} sprint(s) — they will be deleted with the space. Tasks stay, they just leave it.`,
        )
        : dt(
          "Задачи не удалятся — они просто выйдут из пространства.",
          "Tasks are not deleted — they just leave the space.",
        ),
      confirmText: dt("Удалить пространство", "Delete space"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteSprint(active.id);
      onChange(spaces.find((s) => s.id !== active.id)?.id ?? null);
      await onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось удалить", "Could not delete"));
    } finally {
      setBusy(false);
    }
  }

  const chip = (id: string | null, label: string) => {
    const isActive = value === id;
    const n = counts?.get(id);
    return (
      <button
        key={id ?? "__none__"}
        type="button"
        onClick={() => onChange(id)}
        className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
          isActive
            ? "bg-ink text-background"
            : "border border-line bg-surface text-ink-soft hover:bg-surface-2 dark:backdrop-blur-sm"
        }`}
      >
        {label}
        {
          /* Отделено точкой: «Sprint 24» и счётчик 3 без разделителя читаются как «Sprint 243» —
            проверено на живом экране, имя пространства превращалось в другое имя. */
        }
        {n ? <span className="ml-1 tabular-nums opacity-60">· {n}</span> : null}
      </button>
    );
  };

  // Иконка-кнопка ряда: мелкая, без подписи — ряд и так длинный, а действий три.
  const iconBtn = (title: string, onClick: () => void, glyph: string) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className="shrink-0 rounded-full border border-line bg-surface px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-surface-2 disabled:opacity-40"
    >
      {glyph}
    </button>
  );

  return (
    <div className="px-4 pt-3">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/60">
          {dt("Пространство", "Space")}
        </span>
        {spaces.map((s) => chip(s.id, s.name))}
        {showOrphans && chip(NO_SPACE, dt("Без пространства", "No space"))}
        {onChanged && !draft && (
          <>
            {iconBtn(dt("Новое пространство", "New space"), () => setDraft({ id: null, name: "" }), "+")}
            {canManage && active && iconBtn(
              dt("Переименовать", "Rename"),
              () => setDraft({ id: active.id, name: active.name }),
              "✎",
            )}
            {canManage && active && iconBtn(dt("Удалить", "Delete"), remove, "✕")}
          </>
        )}
      </div>

      {draft && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={draft.name}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setDraft(null);
                setErr(null);
              }
            }}
            placeholder={draft.id === null
              ? dt("Название пространства", "Space name")
              : dt("Новое название", "New name")}
            className="w-56 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink outline-none focus:border-ink-soft"
          />
          {iconBtn(dt("Сохранить", "Save"), save, "✓")}
          {iconBtn(dt("Отмена", "Cancel"), () => {
            setDraft(null);
            setErr(null);
          }, "✕")}
        </div>
      )}

      {err && <div className="mt-1 text-[11px] text-danger">{err}</div>}
    </div>
  );
}
