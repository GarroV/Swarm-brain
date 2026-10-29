"use client";
import type { CheckStatus } from "@/types";
import type { Progress } from "@/lib/initiatives";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { fmtDayShort, isOverdue } from "./format";
import { avatarTone, initials } from "@/lib/people";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Avatar } from "@/components/roy/ui";
import type { User } from "@/types";

// Мелкие детали доски инициатив: полоска прогресса, отметка сверки, «×N» переноса,
// исполнитель, срок. Вынесены отдельно, потому что одни и те же метки стоят в четырёх
// местах — список спринта, «Все инициативы», сверка, аналитика, — и нарисованные заново
// в каждом они начинают означать разное: серый «риск» в одном экране и жёлтый в другом.

/** Кнопка-пилюля экрана спринта — тот же вид и размер, что у кнопок карточки задачи
 *  (TaskModal: h-30, rounded-full, border-line-2, 13 px). Владелец 05.10.2026: «все элементы
 *  сделать в едином стиле и размере как в задачах». */
export const PILL_BTN =
  "inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line-2 bg-surface px-3 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.97] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Видимый «+ Задача» у заголовка группы и колонки (владелец 28.10.2026: «непонятно как добавлять
 *  новые задачи … нужен явный видимый плюсик»). Не появляется по наведению: на телефоне наведения
 *  нет, а на компьютере спрятанную кнопку не находят. Открывает стандартную карточку задачи. */
export function AddTaskChip({ onClick, className = "" }: {
  onClick: () => void;
  className?: string;
}) {
  const dt = useDt();
  const label = dt("Добавить задачу", "Add a task");
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      data-testid="add-task"
      className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium normal-case tracking-normal text-ink-soft transition-colors hover:bg-accent-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${className}`}
    >
      <RoyIcon name="plus" size={12} strokeWidth={2.2} />
      {dt("Задача", "Task")}
    </button>
  );
}

/** Полоска выполнения. Пустой прогресс рисуем серой полосой, а не пустотой: иначе
 *  «ничего не сделано» и «не загрузилось» выглядят одинаково. */
export function ProgressBar({ percent, className = "" }: {
  percent: number;
  className?: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-surface-2 ${className}`}
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/** «3/8 · 38%» — цифры рядом с полоской. */
export function ProgressText({ progress }: { progress: Progress }) {
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-ink-soft">
      {progress.done}/{progress.total} · {progress.percent}%
    </span>
  );
}

const CHECK_TONE: Record<CheckStatus, string> = {
  ok: "border-status-done/40 bg-status-done/10 text-status-done",
  risk: "border-pri-med/40 bg-pri-med/10 text-pri-med",
  problem: "border-pri-high/40 bg-pri-high/10 text-pri-high",
};

/**
 * Отметка сверки. `unchecked` — не «нет данных», а состояние «человек промолчал»: показываем
 * его ТОЛЬКО с дня сверки (D013), иначе вся доска с первого дня стоит в серых пометках.
 */
export function CheckBadge(
  { status, note, unchecked = false }: {
    status: CheckStatus | null;
    note?: string | null;
    unchecked?: boolean;
  },
) {
  const dt = useDt();
  if (status === null) {
    if (!unchecked) return null;
    return (
      <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
        {dt("не отмечено", "not checked")}
      </span>
    );
  }
  const label = status === "ok"
    ? dt("по плану", "on track")
    : status === "risk"
    ? dt("риск", "at risk")
    : dt("проблема", "problem");
  return (
    <span
      title={note ?? undefined}
      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
        CHECK_TONE[status]
      }`}
    >
      {label}
      {note ? " ·" : ""}
    </span>
  );
}

/**
 * «×N» у задачи, которая переезжает не первый раз (D012). С единицы не показываем: один
 * перенос — обычное дело, а метка на каждой второй строке перестаёт быть сигналом.
 */
export function CarryBadge({ count, reason }: {
  count: number;
  reason?: string | null;
}) {
  const dt = useDt();
  if (count < 2) return null;
  return (
    <span
      title={reason ??
        dt(`переносилась ${count} раза`, `carried over ${count} times`)}
      className="inline-flex items-center gap-0.5 rounded-full border border-pri-med/40 bg-pri-med/10 px-1.5 py-0.5 text-[10px] font-semibold text-pri-med"
    >
      <RoyIcon name="repeat" size={9} strokeWidth={2.5} />×{count}
    </span>
  );
}

/**
 * Значок заметки второго этажа строки: перенос («перенос: причина» / «перенос · причина?») и
 * риск/проблема («риск: что мешает» / «риск · что мешает?»). Один значок вместо трёх штук:
 * флага, красного приглашения и вечно висящего поля (владелец 21.10.2026). Клик раскрывает
 * редактор под строкой. Пустая заметка — акцентным тоном: это приглашение, а не сообщение.
 * Причину система не придумывает — её вписывает человек (решение владельца 19.10.2026).
 */
export function NoteBadge({ label, note, emptyHint, title, onClick }: {
  /** «перенос», «риск», «проблема». */
  label: string;
  note?: string | null;
  /** Подпись пустого значка: «причина?», «что мешает?». */
  emptyHint: string;
  title: string;
  /** Нет обработчика (принятый спринт, закрытая задача) — значок только показывает. */
  onClick?: () => void;
}) {
  const text = (note ?? "").trim();
  const cls = cn(
    "inline-flex max-w-[34ch] items-center rounded-full border px-1.5 py-px font-semibold leading-[14px]",
    text
      ? "border-pri-med/40 bg-pri-med/10 text-pri-med"
      : "border-pri-high/50 bg-pri-high/10 text-pri-high",
    onClick && "hover:brightness-95",
  );
  const body = (
    <span className="truncate">
      {text ? `${label}: ${text}` : `${label} · ${emptyHint}`}
    </span>
  );
  const tip = text ? `${title}\n${text}` : title;
  if (!onClick) {
    return (
      <span title={tip} className={cls} style={{ fontSize: 11 }}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={tip}
      // Метка для NoteEditor: клик по значку — его собственный переключатель, а не «клик вне поля».
      data-note-toggle=""
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cls}
      style={{ fontSize: 11 }}
    >
      {body}
    </button>
  );
}

/**
 * Редактор заметки под строкой: поле, «Сохранить», подсказка про Enter. Enter и кнопка
 * сохраняют и закрывают, Esc закрывает без сохранения; уход из поля НЕ сохраняет молча —
 * незаметное сохранение по blur владелец не отличал от потери текста.
 */
export function NoteEditor({ initial, placeholder, onSave, onClose }: {
  initial: string;
  placeholder: string;
  onSave: (value: string | null) => void | Promise<void>;
  onClose: () => void;
}) {
  const dt = useDt();
  const [value, setValue] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  const save = () => {
    const v = value.trim();
    if (v !== initial.trim()) void onSave(v || null);
    onClose();
  };
  // Клик вне поля закрывает редактор БЕЗ сохранения (владелец 22.10.2026): сохраняют только Enter
  // и кнопка. Клик по значку заметки не считается «вне» — значок сам открывает и закрывает.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || box.current?.contains(t)) return;
      if (t.closest("[data-note-toggle]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);
  return (
    <div
      ref={box}
      className="flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 rounded-[6px] border border-accent-line bg-surface px-2 py-1 text-ink outline-none"
        style={{ fontSize: 12 }}
      />
      <button
        type="button"
        onClick={save}
        className="shrink-0 rounded-[6px] border border-line bg-surface px-2.5 py-1 font-semibold text-ink hover:bg-surface-2"
        style={{ fontSize: 12 }}
      >
        {dt("Сохранить", "Save")}
      </button>
    </div>
  );
}

const AvatarDirectory = createContext<Map<string, string>>(new Map());

const nameKey = (name: string) => name.trim().toLowerCase();

/** Справочник «имя → фото из Google» для кружков исполнителей внутри экрана: имя в задаче —
 *  строка, а фото лежит у человека, и тащить его пропом через каждую строку списка незачем. */
export function AvatarDirectoryProvider({ users, children }: {
  users: ReadonlyArray<Pick<User, "name" | "avatar_url">>;
  children: ReactNode;
}) {
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) {
      if (u.avatar_url) m.set(nameKey(u.name), u.avatar_url);
    }
    return m;
  }, [users]);
  return (
    <AvatarDirectory.Provider value={map}>{children}</AvatarDirectory.Provider>
  );
}

/**
 * Исполнитель кружком с инициалами. Полное имя в каждой строке — главный источник её длины
 * (внутри инициативы человек чаще всего один и тот же, и имя перестаёт нести информацию,
 * оставаясь шумом на 120 px). Само имя никуда не девается: оно в подсказке.
 *
 * Если у человека есть фото из Google — кружок показывает его, при ошибке загрузки — инициалы.
 *
 * Цвет кружка считается от имени, а не назначается: человек узнаёт свои задачи по пятну
 * раньше, чем читает буквы, и одинаковый серый у всех эту подсказку убивает.
 */
export function AssigneeChip(
  { name, size = 22 }: { name: string | null; size?: number },
) {
  const dt = useDt();
  const photo = useContext(AvatarDirectory);
  if (!name) {
    return (
      <span
        title={dt("без исполнителя", "unassigned")}
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-line text-ink-soft/60"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      >
        ?
      </span>
    );
  }
  return (
    <span title={name} className="inline-flex shrink-0">
      <Avatar
        size={size}
        src={photo.get(nameKey(name))}
        tone={avatarTone(name)}
      >
        {initials(name)}
      </Avatar>
    </span>
  );
}

/** Срок задачи. Красным — только у незакрытой: у сделанной просрочка уже ничего не значит. */
export function DueBadge({ date, closed = false }: {
  date: string;
  closed?: boolean;
}) {
  const late = !closed && isOverdue(date);
  return (
    <span
      className={`whitespace-nowrap text-[10px] tabular-nums ${
        late ? "font-semibold text-pri-high" : "text-ink-soft"
      }`}
    >
      {fmtDayShort(date)}
    </span>
  );
}

/**
 * Значок «здесь есть о чём почитать»: сколько у задачи комментариев или ссылок. Ноль не
 * рисуется вовсе — пустой значок в каждой строке был бы ещё одной колонкой шума.
 *
 * Разворачивать содержимое прямо в строке (как в исходном макете) намеренно не стали: и
 * комментарии, и ссылки уже живут в карточке задачи, а второе место для них означало бы два
 * набора правил и два вида одного и того же.
 */
export function CountChip(
  { kind, count }: { kind: "comments" | "links"; count: number },
) {
  const dt = useDt();
  if (count <= 0) return null;
  const label = kind === "comments"
    ? dt(`комментариев: ${count}`, `comments: ${count}`)
    : dt(`ссылок: ${count}`, `links: ${count}`);
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px] tabular-nums text-ink-soft"
    >
      <RoyIcon
        name={kind === "comments" ? "note" : "link"}
        size={10}
        strokeWidth={2}
      />
      {count}
    </span>
  );
}
