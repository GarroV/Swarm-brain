"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useDt } from "./nav";
import { RoyIcon } from "./icons";
import { countryCode, countryFlag } from "@/lib/countries";
import { resolveAssigneeId, taskCountLabel, type ProposedTask } from "@/lib/proposedTasks";
import type { User } from "@/types";

// Разбор задач, предложенных из встречи. До 2026-08-27 предложения жили строками в УЗКОЙ
// правой панели ревью: заголовок резался в одну строку, исполнитель не показывался вовсе,
// и чтобы принять семь задач, надо было семь раз открыть и закрыть редактор. Владелец:
// «хочется сразу видеть, на что соглашаешься, а не открывать каждую по отдельности».
//
// Отсюда форма: лист во всю высоту окна поверх затемнённого экрана, где каждая задача видна
// целиком, а согласие даётся одной кнопкой на выбранные. Геометрия листа считается здесь же
// (SHEET_GAP/SHEET_MAX_W) и ставится инлайном — те же числа нужны JS для анимации, поэтому
// держать их в CSS значило бы завести второй источник правды и разойтись с ним.

const SHEET_GAP = 12;
const SHEET_MAX_W = 620;

export type DraftTask = ProposedTask & { _key: string; _selected: boolean };

// Высота НЕ фиксируется: лист растёт под содержимое и упирается в maxHeight. Три задачи не
// должны разворачивать пустую простыню во весь экран — проверено на живом прогоне.
type Geometry = { left: number; top: number; width: number; maxHeight: number };

function sheetGeometry(): Geometry {
  const width = Math.min(SHEET_MAX_W, window.innerWidth - SHEET_GAP * 2);
  return {
    left: window.innerWidth - SHEET_GAP - width,
    top: SHEET_GAP,
    width,
    maxHeight: window.innerHeight - SHEET_GAP * 2,
  };
}

// Обратный transform, накладывающий финальный лист на прямоугольник блока-источника.
// transform-origin: 0 0 задан в CSS — поэтому хватает сдвига и масштаба.
//
// Масштаб РАВНОМЕРНЫЙ (по ширине), а не отдельный по осям: во-первых, высота листа теперь
// зависит от содержимого и на первом кадре неизвестна; во-вторых, неравномерный масштаб
// плющит скругления и буквы. Равномерный даёт честное «блок вырос из своего места».
// Якоря нет (блок не отрисован / нулевой размер) — отдаём мягкий зум вместо разъезда.
function flipVars(anchor: DOMRect | null, geo: Geometry | null): CSSProperties {
  if (!geo || !anchor || anchor.width < 1 || anchor.height < 1) {
    return { "--hv-x": "0px", "--hv-y": "8px", "--hv-sx": "0.96", "--hv-sy": "0.96" } as CSSProperties;
  }
  const scale = `${anchor.width / geo.width}`;
  return {
    "--hv-x": `${anchor.left - geo.left}px`,
    "--hv-y": `${anchor.top - geo.top}px`,
    "--hv-sx": scale,
    "--hv-sy": scale,
  } as CSSProperties;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
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
  open: boolean;
  onClose: () => void;
  /** Прямоугольник блока-источника, снятый в момент открытия: из него «разъезжается» лист. */
  anchorRect: DOMRect | null;
  tasks: DraftTask[];
  users: User[];
  /** Идёт массовое добавление: кнопки заблокированы, лист не закрывается сам. */
  busy: boolean;
  /** Модель ещё пишет: внизу висит заготовка, «Задач не найдено» не показываем раньше времени. */
  streaming: boolean;
  actions: HarvestActions;
};

export function TasksHarvestSheet({ open, onClose, anchorRect, tasks, users, busy, streaming, actions }: Props) {
  const dt = useDt();
  // Пересчёт геометрии при смене размера окна: лист открыт, а окно перетащили на другой экран.
  const [, bumpViewport] = useState(0);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onResize = () => bumpViewport((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // Закрыли лист — забываем, что правили заголовок: при следующем открытии поле не всплывёт.
  useEffect(() => { if (!open) setEditingKey(null); }, [open]);

  // Считаем в рендере, а не в эффекте: переменные --hv-* обязаны стоять в самом первом кадре,
  // иначе Base UI снимет data-starting-style раньше, чем они появятся, и разъезда не будет.
  const geo = typeof window === "undefined" ? null : sheetGeometry();

  const selected = tasks.filter((t) => t._selected);
  const allSelected = tasks.length > 0 && selected.length === tasks.length;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="roy-harvest-backdrop fixed inset-0 z-50 bg-black/50 supports-backdrop-filter:backdrop-blur-md"
        />
        <Dialog.Popup
          className="roy-harvest fixed z-50 flex flex-col overflow-hidden rounded-[20px] border border-line bg-[var(--popover)] shadow-2xl outline-none dark:backdrop-blur-xl"
          style={{ ...(geo ?? {}), position: "fixed", ...flipVars(anchorRect, geo) }}
        >
          <div className="roy-harvest-body flex min-h-0 flex-auto flex-col">
            <header className="flex items-start gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="font-bold uppercase text-ink-mute" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
                  {dt("Разбор задач из встречи", "Tasks from this meeting")}
                </Dialog.Title>
                <p className="mt-1 text-ink-soft" style={{ fontSize: 13 }}>
                  {streaming
                    ? (tasks.length === 0
                        ? dt("Читаю тезисы…", "Reading the notes…")
                        : dt(`Нашёл ${tasks.length}, ищу дальше…`, `${tasks.length} so far, still reading…`))
                    : dt(
                        `Найдено ${tasks.length} · выбрано ${selected.length}`,
                        `${tasks.length} found · ${selected.length} selected`,
                      )}
                </p>
              </div>
              <button
                type="button"
                aria-label={dt("Закрыть разбор", "Close review")}
                onClick={onClose}
                disabled={busy}
                className="inline-flex shrink-0 items-center justify-center rounded-[11px] border border-line bg-surface text-ink-mute transition-[opacity,border-color] duration-150 hover:border-line-2 hover:opacity-70 disabled:opacity-40"
                style={{ width: 40, height: 40 }}
              >
                <RoyIcon name="x" size={16} strokeWidth={1.9} />
              </button>
            </header>

            <div className="min-h-0 flex-auto overflow-y-auto px-3 py-3">
              {tasks.length === 0 && !streaming ? (
                <p className="px-1 text-ink-mute" style={{ fontSize: 12.5 }}>
                  {dt("Задач не найдено.", "No tasks found.")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {tasks.map((task) => (
                    <HarvestRow
                      key={task._key}
                      task={task}
                      users={users}
                      busy={busy}
                      editing={editingKey === task._key}
                      onStartEdit={() => setEditingKey(task._key)}
                      onStopEdit={() => setEditingKey(null)}
                      actions={actions}
                    />
                  ))}
                  {streaming && <PendingRow />}
                </ul>
              )}
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
              {tasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => actions.toggleAll(!allSelected)}
                  disabled={busy || streaming}
                  className="rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50"
                  style={{ padding: "6px 12px", fontSize: 12, minHeight: 40 }}
                >
                  {allSelected ? dt("Снять все", "Clear all") : dt("Выбрать все", "Select all")}
                </button>
              )}
              <button
                type="button"
                onClick={actions.addOwn}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50"
                style={{ padding: "6px 12px", fontSize: 12, minHeight: 40 }}
              >
                <RoyIcon name="plus" size={13} strokeWidth={2.1} />
                {dt("Своя", "Own")}
              </button>
              <button
                type="button"
                onClick={actions.commit}
                disabled={busy || streaming || selected.length === 0}
                className="ml-auto inline-flex items-center justify-center gap-2 rounded-[13px] font-semibold transition-[transform,opacity,filter,background] duration-150 enabled:hover:scale-[1.02] enabled:hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
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
            </footer>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Строка разбора ────────────────────────────────────────────────────────────

type RowProps = {
  task: DraftTask;
  users: User[];
  busy: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  actions: HarvestActions;
};

function HarvestRow({ task, users, busy, editing, onStartEdit, onStopEdit, actions }: RowProps) {
  const dt = useDt();
  const assigneeId = resolveAssigneeId(task.assignee, users);
  const matched = assigneeId ? users.find((u) => u.telegram_id === assigneeId) : undefined;
  const due = fmtDate(task.due_date);

  return (
    <li
      // roy-harvest-row-in отыгрывается ОДИН раз при монтировании: строки приезжают потоком в
      // непредсказуемые моменты, и без собственного движения это читается как мигание списка.
      className="roy-harvest-row-in rounded-[14px] border border-line bg-surface transition-colors hover:border-line-2 dark:backdrop-blur-lg"
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
                ? matched.name
                : task.assignee
                  // Имя из тезисов не нашлось в команде: показываем как есть, но честно
                  // помечаем — задача создастся без исполнителя, а не «на кого-то похожего».
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
            className="inline-flex items-center justify-center rounded-[9px] border border-line bg-surface text-ink-mute transition-[opacity,border-color] hover:border-line-2 hover:opacity-70 disabled:opacity-40"
            style={{ width: 36, height: 36 }}
          >
            <RoyIcon name="pencil" size={13} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            aria-label={dt("Убрать предложенную задачу", "Discard suggestion")}
            onClick={() => actions.remove(task._key)}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-[9px] border border-line bg-surface text-ink-mute transition-[opacity,border-color] hover:border-line-2 hover:opacity-70 disabled:opacity-40"
            style={{ width: 36, height: 36 }}
          >
            <RoyIcon name="x" size={13} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </li>
  );
}

// Заготовка в хвосте списка, пока модель пишет. Занимает место примерно одной строки, чтобы
// приезд настоящей задачи не дёргал высоту листа сильнее необходимого, и показывает, что
// работа идёт, — пустой хвост читался бы как «всё, больше не будет».
function PendingRow() {
  const dt = useDt();
  return (
    <li
      aria-live="polite"
      aria-label={dt("Модель ищет задачи", "The model is finding tasks")}
      className="roy-harvest-row-in rounded-[14px] border border-dashed border-line bg-surface/50 p-3"
    >
      <div className="roy-harvest-wave flex flex-col gap-2">
        <div className="rounded-[6px] bg-surface-2" style={{ height: 11, width: "62%" }} />
        <div className="rounded-[6px] bg-surface-2" style={{ height: 9, width: "88%" }} />
        <div className="rounded-[6px] bg-surface-2" style={{ height: 9, width: "34%" }} />
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
