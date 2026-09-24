"use client";
import { useEffect, useRef, useState } from "react";
import type { Sprint } from "@/types";
import { useDt } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";
import { createSprint, deleteSprint, updateSprint } from "@/lib/api";
import { Menu, type MenuItem } from "@/components/tasks/table/Menu";

// Пространство — вкладка доски со своей чередой спринтов. Переключатель — первая кнопка
// полосы спринта, перед выбором спринта, потому что порядок вопросов у человека такой: сперва «какой проект», потом
// «какой спринт». Обратный порядок заставляет искать свой спринт среди чужих.
//
// ⚠️ `Sprint` здесь — ВКЛАДКА доски (таблица `sprints`, имя историческое), а не период
// работы: период — `SprintCycle`.
//
// Управление пространствами живёт здесь же, а не на экране: экран уже за 1000 строк (#265),
// а создание, переименование и удаление — это ровно про это меню. Серверная часть
// существовала и раньше (`POST/PATCH/DELETE /sprints`), не хватало входа с экрана (#403).

/** null — «Без пространства»: спринты, заведённые до пространств, и они не должны пропасть. */
export const NO_SPACE = null;

export function SpaceSwitcher(
  {
    spaces,
    value,
    onChange,
    counts,
    showOrphans = false,
    canManage = false,
    onChanged,
  }: {
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
  const [draft, setDraft] = useState<
    { id: string | null; name: string } | null
  >(null);
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
        const created = await createSprint({
          name,
          start_date: today,
          end_date: today,
          // Именно пространство раздела «Спринты», не вкладка доски «Проекты» — одна таблица
          // на две сущности однажды показала это пространство в проектах (issue #423).
          kind: "space",
        });
        await onChanged?.();
        onChange(created.id);
      } else {
        await updateSprint(draft!.id, { name });
        await onChanged?.();
      }
      setDraft(null);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось сохранить", "Could not save"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!active) return;
    const inside = counts?.get(active.id) ?? 0;
    const ok = await confirm({
      title: dt(
        `Удалить пространство «${active.name}»?`,
        `Delete space “${active.name}”?`,
      ),
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
      setErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось удалить", "Could not delete"),
      );
    } finally {
      setBusy(false);
    }
  }

  const n = (id: string | null) => {
    const c = counts?.get(id);
    // Отделено точкой: «Sprint 24» и счётчик 3 без разделителя читаются как «Sprint 243» —
    // проверено на живом экране, имя пространства превращалось в другое имя.
    return c ? <span className="ml-1 font-mono text-ink-mute">· {c}</span> : null;
  };
  const items: MenuItem[] = [
    ...spaces.map((s) => ({
      key: s.id,
      label: <>{s.name}{n(s.id)}</>,
      on: value === s.id,
      action: true,
      onPick: () => onChange(s.id),
    })),
    ...(showOrphans
      ? [{
        key: "__none__",
        label: <>{dt("Без пространства", "No space")}{n(NO_SPACE)}</>,
        on: value === NO_SPACE,
        action: true,
        onPick: () => onChange(NO_SPACE),
      }]
      : []),
    ...(onChanged
      ? [{
        key: "__new__",
        label: <span className="text-accent-ink">{dt("＋ Новое пространство", "＋ New space")}</span>,
        action: true,
        onPick: () => setDraft({ id: null, name: "" }),
      }]
      : []),
    ...(onChanged && canManage && active
      ? [
        {
          key: "__rename__",
          label: dt("Переименовать пространство", "Rename space"),
          action: true,
          onPick: () => setDraft({ id: active.id, name: active.name }),
        },
        {
          key: "__delete__",
          label: <span className="text-pri-high">{dt("Удалить пространство", "Delete space")}</span>,
          action: true,
          onPick: remove,
        },
      ]
      : []),
  ];
  const current = active?.name ??
    (value === NO_SPACE && showOrphans ? dt("Без пространства", "No space") : dt("не выбрано", "none"));

  const iconBtn = (title: string, onClick: () => void, glyph: string) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className="h-[28px] shrink-0 rounded-[7px] border border-line bg-surface px-2 text-ink-soft transition-colors hover:bg-surface-2 disabled:opacity-40"
      style={{ fontSize: 12.5 }}
    >
      {glyph}
    </button>
  );

  // Кнопка-меню полосы спринта (стенд: sprintBar → «Пространство: …»). Черновик имени — рядом
  // в той же полосе: меню закрывается на выборе пункта, и поле внутри него пропадало бы.
  return (
    <>
      <Menu label={<>{dt("Пространство", "Space")}: <span className="text-ink">{current}</span></>} items={items} />
      {draft && (
        <span className="flex items-center gap-1">
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
            className="h-[28px] w-48 rounded-[7px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-accent-line"
            style={{ fontSize: 12.5 }}
          />
          {iconBtn(dt("Сохранить", "Save"), save, "✓")}
          {iconBtn(dt("Отмена", "Cancel"), () => {
            setDraft(null);
            setErr(null);
          }, "✕")}
        </span>
      )}
      {err && <span className="text-pri-high" style={{ fontSize: 11.5 }}>{err}</span>}
    </>
  );
}
