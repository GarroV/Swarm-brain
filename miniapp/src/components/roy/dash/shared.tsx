"use client";
import type { ReactNode } from "react";
import { RoyCard } from "../ui";
import { RoyIcon, type RoyIconName } from "../icons";
import { useRoyNav, useDt } from "../nav";
import { TaskRow } from "@/components/tasks/TaskRow";
import { isDone } from "@/lib/smartLists";
import { updateTask } from "@/lib/api";
import type { Task } from "@/types";

// Общий каркас панелей desktop-главного экрана «Рой». Вынесено из RoyDashboard,
// чтобы пять панелей (PersonalTasks/SearchHero/Materials/MeetingsApprove/TeamTasks)
// делили один скелет: шапка-кнопка → раскрытие во вкладку/экран, скролл-тело,
// loading (roy-shim), empty- и failed-состояние. Flat, тонкие границы — без бенто-визуала.

// ── Форматирование даты «Рой» (ru, day + short month) ───────────────────────────
export function fmtDate(iso: string | null, locale: string = "ru-RU"): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}

// Инициалы для аватара. Сырой telegram_id (только цифры) → «Я» (себя не подписываем числом).
export function initials(name: string | undefined | null): string {
  if (!name || /^\d+$/.test(name.trim())) return "Я";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "Я";
}

// Относительное время «N мин / N ч / N дн» от now до created_at (для ленты материалов).
export function relTime(iso: string | null, now: number): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "сейчас";
  if (min < 60) return `${min} мин`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч`;
  const days = Math.floor(hrs / 24);
  return `${days} дн`;
}

// Нормализация статуса задачи: устаревший alias "progress" → "in_progress".
export const norm = (s: string): string => (s === "progress" ? "in_progress" : s);

// ── Панель: шапка-кнопка (раскрыть) + скроллируемое тело ─────────────────────────
export function DashBlock({
  title, icon, tint, badge, headAction, loading, failed, errorText, retryText, onRetry, empty, emptyText, onHead, onAdd, addLabel, children, className,
  flat, count, first,
}: {
  title: string;
  icon: RoyIconName;
  tint: string;
  /** правый бейдж в шапке (например «3 новых» / «N на согласовании») */
  badge?: ReactNode;
  /** правый текст-действие шапки (например «Доска ›») */
  headAction?: ReactNode;
  loading: boolean;
  /** Данные не пришли (таймаут/ошибка) — показываем «не загрузилось · повторить», а НЕ пустоту:
   *  фальшивое «задач нет» врёт пользователю о состоянии его работы. */
  failed?: boolean;
  errorText?: string;
  retryText?: string;
  onRetry?: () => void;
  empty: boolean;
  emptyText: string;
  /** Переход в раздел по клику на шапку. Не передан → шапка не кликабельна (у панели нет своего экрана). */
  onHead?: () => void;
  /** Быстрое «+» в шапке (например создать задачу, не уходя с дашборда). */
  onAdd?: () => void;
  /** aria-label/подсказка кнопки «+». */
  addLabel?: string;
  children: ReactNode;
  className?: string;
  /** Вид главной по стенду: надпись-разделитель вместо карточки (screens-home.js → .lab). */
  flat?: boolean;
  /** Число рядом с надписью плоского вида: «Встречи сегодня · 3». */
  count?: number;
  /** Плоский вид первым в колонке — без линии сверху. */
  first?: boolean;
}) {
  const body = (
    <DashBody loading={loading} failed={failed} errorText={errorText} retryText={retryText} onRetry={onRetry}
      empty={empty} emptyText={emptyText} flat={flat}>
      {children}
    </DashBody>
  );
  if (flat) {
    return (
      <section className={`flex min-h-0 flex-col ${className ?? ""}`}>
        <HomeLabel first={first} count={count} action={onHead ? { text: headAction ?? "Открыть", onClick: onHead } : undefined}>
          {title}
        </HomeLabel>
        {body}
      </section>
    );
  }

  // Левая часть шапки (иконка + заголовок + бейдж) — общая для обоих вариантов шапки.
  const headLeft = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[9px]"
        style={{ width: 28, height: 28, color: tint, backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)` }}
      >
        <RoyIcon name={icon} size={16} strokeWidth={2} />
      </span>
      {/* Заголовок ужимается ПОСЛЕДНИМ (issue #223). Раньше он и бейдж сжимались одинаково, и в
          правой колонке дашборда (344px на 1440) «Встречи» превращались в «Вс…», как только в
          бейдже появлялось «2 на согласовании». Заголовок — единственное, что говорит, ЧТО за
          панель; опознавать её по иконке человек не обязан. min-w не даёт схлопнуться ниже
          читаемого, truncate оставлен для действительно длинных названий. */}
      <span className="min-w-[7ch] truncate font-bold text-ink" style={{ fontSize: 15.5, letterSpacing: "-0.01em" }}>
        {title}
      </span>
      {/* Бейдж отдаёт место первым: его смысл дублируется ярусом ниже («Требуют решения N»). */}
      <span className="min-w-0 shrink overflow-hidden">{badge}</span>
    </div>
  );

  return (
    <RoyCard className={`flex min-h-0 flex-col overflow-hidden p-0 ${className ?? ""}`}>
      {onAdd ? (
        // Шапка с быстрым «+»: title-область и «Доска ›» — отдельные кнопки (вложенные
        // <button> невалидны), между ними — иконка добавления.
        <div className="flex shrink-0 items-stretch border-b border-line">
          <button
            type="button"
            onClick={onHead}
            className="group flex min-w-0 flex-1 items-center px-4 py-3 text-left transition-colors hover:bg-surface-2"
          >
            {headLeft}
          </button>
          <button
            type="button"
            onClick={onAdd}
            aria-label={addLabel ?? "Добавить"}
            title={addLabel ?? "Добавить"}
            className="flex shrink-0 items-center justify-center px-2.5 text-ink-mute transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
          >
            <RoyIcon name="plus" size={18} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={onHead}
            className="group flex shrink-0 items-center gap-0.5 py-3 pr-4 pl-1.5 font-semibold text-ink-mute transition-colors hover:text-primary"
            style={{ fontSize: 12.5 }}
          >
            {headAction ?? "Открыть"}
            <RoyIcon name="cright" size={14} strokeWidth={2} />
          </button>
        </div>
      ) : !onHead ? (
        // Без своего экрана: обычный заголовок, не кнопка — иначе клик обещает переход,
        // которого не будет.
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 text-left">
          {headLeft}
        </div>
      ) : (
        <button
          type="button"
          onClick={onHead}
          className="group flex shrink-0 items-center justify-between border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2"
        >
          {headLeft}
          <span
            className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-ink-mute transition-colors group-hover:text-primary"
            style={{ fontSize: 12.5 }}
          >
            {headAction ?? "Открыть"}
            <RoyIcon name="cright" size={14} strokeWidth={2} />
          </span>
        </button>
      )}
      {body}
    </RoyCard>
  );
}

// Тело панели главной: скелетон, «не загрузилось · повторить», пусто или содержимое.
// Общее для карточки и плоского вида — состояния не должны разойтись между ними.
function DashBody({ loading, failed, errorText, retryText, onRetry, empty, emptyText, flat, children }: {
  loading: boolean; failed?: boolean; errorText?: string; retryText?: string; onRetry?: () => void;
  empty: boolean; emptyText: string; flat?: boolean; children: ReactNode;
}) {
  return (
    <div className={flat ? "min-h-0" : "min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-2"}>
      {loading && [0, 1, 2, 3].map((i) => <div key={i} className="roy-shim" style={{ height: 52, borderRadius: 8 }} />)}
      {!loading && failed && (
        <div className={`flex flex-col items-center gap-2 ${flat ? "py-4" : "py-9"} text-center`}>
          <span className="text-sm text-ink-soft">{errorText ?? "Не загрузилось"}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-[10px] px-3 py-1.5 font-semibold text-ink-mute transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 12.5 }}
            >
              {retryText ?? "Повторить"}
            </button>
          )}
        </div>
      )}
      {!loading && !failed && empty && <div className={flat ? "py-3 text-ink-mute" : "py-10 text-center text-sm text-ink-soft"} style={flat ? { fontSize: 12.5 } : undefined}>{emptyText}</div>}
      {!loading && !failed && !empty && children}
    </div>
  );
}

// Надпись раздела главной по стенду (.lab): мелкие прописные, линия сверху, справа ссылка.
export function HomeLabel({ children, count, action, first }: {
  children: ReactNode;
  count?: number;
  action?: { text: ReactNode; onClick: () => void };
  /** Первая надпись колонки — без линии сверху: над ней уже шапка экрана. */
  first?: boolean;
}) {
  return (
    <div className={`mb-[7px] flex items-center justify-between gap-2 ${first ? "pt-4" : "mt-[18px] border-t border-line pt-3.5"}`}>
      <span className="font-semibold uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.1em" }}>
        {children}{count != null && ` · ${count}`}
      </span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex min-h-6 items-center font-medium text-primary hover:underline"
          style={{ fontSize: 12 }}
        >
          {action.text}
        </button>
      )}
    </div>
  );
}

// ── Бейдж-счётчик «требует внимания» (акцент) ───────────────────────────────────
export function AccentBadge({ children }: { children: ReactNode }) {
  return (
    <span className="mr-1.5 inline-block max-w-[calc(100%-0.375rem)] truncate whitespace-nowrap rounded-full bg-accent-soft px-2 py-0.5 align-middle font-semibold text-accent-ink" style={{ fontSize: 12 }}>
      {children}
    </span>
  );
}

// ── Строка-кнопка тела панели ───────────────────────────────────────────────────
// НЕ <button> (issue #248). Внутрь строки кладут собственные кнопки — «Подключиться»/«Вернуться»
// в панели «Встречи сегодня», — а кнопка внутри кнопки невалидна в HTML. Парсер закрывает
// внешнюю раньше времени, серверная разметка расходится с клиентским деревом, и React пишет
// hydration error на каждом рендере дашборда. Ровно по этой причине рядом уже живёт DashTaskRow
// не кнопкой.
//
// Клавиатуру у div приходится делать руками: Enter и Пробел, роль и tabIndex. Пробел ещё и
// гасим на нажатии — иначе браузер прокрутит страницу вместо активации строки.
export function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
    >
      {children}
    </div>
  );
}

// ── Строка задачи на дашборде ─────────────────────────────────────────────────
// Единый рендер с полным списком задач: тот же `TaskRow` (круглый чекбокс, та же
// типографика/чипы/трактовка срока), чтобы задача не «прыгала» при переходе
// дашборд ↔ доска. Кликабельный контейнер открывает задачу; чекбокс гасит всплытие
// и переключает done (updateTask → bumpTasks обновляет панели). Не button — внутри
// TaskRow уже есть button-чекбокс (вложенные button невалидны).
export function DashTaskRow({ task, showAssignee = false }: { task: Task; showAssignee?: boolean }) {
  const { openTask, toast, bumpTasks } = useRoyNav();
  const dt = useDt();
  const toggle = async () => {
    try {
      await updateTask(task.id, { status: isDone(task) ? "open" : "done" });
      bumpTasks();
    } catch {
      toast(dt("Не удалось обновить", "Couldn't update"));
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTask(task)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(task); } }}
      className="cursor-pointer rounded-[8px] transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <TaskRow task={task} showAssignee={showAssignee} onToggle={toggle} />
    </div>
  );
}

// ── Мелкий лейбл подсекции внутри панели (Сегодня / На неделе) ───────────────────
export function SubHead({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5 pt-1">
      <span className="font-mono font-semibold uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.09em" }}>
        {children}
      </span>
      {count != null && (
        <span className="font-mono font-bold text-accent-ink" style={{ fontSize: 11 }}>
          {count}
        </span>
      )}
      <span className="ml-1 h-px flex-1 bg-line" />
    </div>
  );
}
