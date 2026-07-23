"use client";
import { useState } from "react";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { cn, displayName } from "@/lib/utils";
import { countryCode } from "@/lib/countries";
import { RoyIcon, type RoyIconName } from "./icons";
import { useDt } from "./nav";

// Примитивы дизайн-системы из design_handoff_roy (mobile-proto-ui.jsx), портированные
// в идиому miniapp: Tailwind + семантические токены хендоффа (см. globals.css). Значения,
// которых нет как Tailwind-классы (точные радиусы пилюль, динамические цвета типов),
// заданы инлайн-стилем для пиксельного соответствия дизайну.

// active:scale для тача + видимое focus-кольцо для клавиатуры (токен --ring, янтарь).
// focus-visible (не focus) → кольцо только при Tab-навигации, не при клике мышью.
const TAP = "transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

// ── Канон типографики Roy (ЕДИНЫЙ МАСШТАБ) ───────────────────────────────────
// Раньше каждый экран хардкодил свой fontSize у заголовка → при переключении экранов
// заголовок «прыгал» (16→30px). Единый источник: заголовок экрана/детали ОДНОГО размера
// на всех полноэкранных поверхностях. Диалоги (модалки) — отдельный, меньший тир.
// Применять как style={ROY_TYPE.pageTitle} вместо инлайн-fontSize у h1.
export const ROY_TYPE = {
  /** Заголовок экрана/детали (Встречи / Задачи / База / конкретная встреча/задача / виды задач). */
  pageTitle: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" },
  /** Заголовок модального диалога (меньше экранного — конвенция модалок). */
  dialogTitle: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" },
} as const;

// ── Card ───────────────────────────────────────────────────────────────────
export function RoyCard({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  // dark:backdrop-blur — frosted-стекло поверх галактики (поверхности translucent в .dark);
  // щели между карточками остаются прозрачными → галактика видна между панелями.
  return <div className={cn("bg-surface border border-line rounded-[18px] dark:backdrop-blur-lg", className)} {...props} />;
}

// ── TypeTag (тип записи базы) ────────────────────────────────────────────────
// color — CSS-токен (var), а не сырой hex: в тёмной теме токены тюнятся ярче
// (note/doc/meet), иначе тег теряет контраст на тёмной поверхности. Фон/бордер
// собираются через color-mix (см. TypeTag / Materials), а не конкатенацией hex+alpha.
export const TYPE_TAG: Record<string, { icon: RoyIconName; label: string; color: string }> = {
  doc: { icon: "doc", label: "Документ", color: "var(--tag-doc)" },
  mic: { icon: "mic", label: "Транскрипт", color: "var(--tag-mic)" },
  note: { icon: "note", label: "Заметка", color: "var(--tag-note)" },
  meet: { icon: "meet", label: "Встреча", color: "var(--tag-meet)" },
  pdf: { icon: "pdf", label: "PDF", color: "var(--tag-pdf)" },
  link: { icon: "link", label: "Ссылка", color: "var(--tag-link)" },
};
export type RoyTypeKey = keyof typeof TYPE_TAG;

export function TypeTag({ type, small }: { type: RoyTypeKey; small?: boolean }) {
  const t = TYPE_TAG[type] ?? TYPE_TAG.doc;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap"
      style={{
        fontSize: small ? 11 : 12,
        color: t.color,
        background: `color-mix(in srgb, ${t.color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${t.color} 15%, transparent)`,
        borderRadius: 8,
        padding: small ? "2px 7px" : "3px 9px",
      }}
    >
      <RoyIcon name={t.icon} size={small ? 11 : 12} strokeWidth={1.9} />
      {t.label}
    </span>
  );
}

// ── Market (рынок) ───────────────────────────────────────────────────────────
// Тег рынка — короткий ISO-код (alpha-2, uppercase): «Словения»/«SI» → «SI». `countryCode`
// приводит и код, и легаси-имя к коду единообразно. Компактно и общепринято.
export function Market({ code }: { code?: string | null }) {
  if (!code || code === "—") return null;
  return (
    <span
      className="inline-flex items-center font-semibold whitespace-nowrap uppercase tracking-wide text-ink-soft bg-surface-2 border border-line-2"
      style={{ fontSize: 10.5, borderRadius: 6, padding: "1px 6px" }}
    >
      {countryCode(code)}
    </span>
  );
}

// ── Участники встречи (из календаря) ─────────────────────────────────────────
// Показывает имена (или email-фолбэк) участников. Это календарный список, НЕ диаризация
// аудио — кто именно говорил, мы не различаем. Пусто → ничего не рендерим.
// Список участников встречи. Свёрнут по умолчанию (первые PARTICIPANTS_LIMIT + «+N ещё»), иначе
// длинный список email превращается в нечитаемую стену на весь экран (жалоба владельца 2026-07-23).
const PARTICIPANTS_LIMIT = 6;
export function Participants({ attendees }: { attendees?: Array<{ name?: string; email?: string }> | null }) {
  const [expanded, setExpanded] = useState(false);
  const names = (attendees ?? [])
    .map((a) => (a.name?.trim() || a.email?.trim() || ""))
    .filter(Boolean);
  if (names.length === 0) return null;
  const overflow = names.length > PARTICIPANTS_LIMIT;
  const shown = expanded || !overflow ? names : names.slice(0, PARTICIPANTS_LIMIT);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-ink-soft" style={{ fontSize: 12 }}>
      <RoyIcon name="team" size={13} className="text-ink-mute self-center" />
      <span className="text-ink-mute">Участники ({names.length}):</span>
      <span className="text-ink">{shown.join(", ")}</span>
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="font-semibold text-accent-ink transition-opacity hover:opacity-80"
        >
          {expanded ? "свернуть" : `+${names.length - PARTICIPANTS_LIMIT} ещё`}
        </button>
      )}
    </span>
  );
}

// ── Meta (вторичная строка: иконка + текст) ──────────────────────────────────
export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-ink-soft whitespace-nowrap", className)} style={{ fontSize: 12 }}>
      {children}
    </span>
  );
}

// ── Avatar (инициалы) ────────────────────────────────────────────────────────
export function Avatar({ children, size = 32 }: { children: ReactNode; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center shrink-0 rounded-full bg-accent-soft text-accent-ink font-bold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.37) }}
    >
      {children}
    </span>
  );
}

function avInitials(name: string): string {
  const n = displayName(name);
  if (n === "—" || n.startsWith("#")) return "?";
  return n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// Стопка аватаров исполнителей: перекрытие + «+N». Показывает ВСЕХ назначенных, а не только
// первого — иначе групповая задача неотличима от личной (см. беклог «мультиассайн»).
export function AvatarStack({ names, size = 26, max = 3 }: { names: string[]; size?: number; max?: number }) {
  const list = names.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return <Avatar size={size}>{avInitials(list[0])}</Avatar>;
  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  const overlap = -Math.round(size * 0.32);
  return (
    <span className="flex items-center" title={list.join(", ")}>
      {shown.map((n, i) => (
        <span key={i} className="rounded-full ring-2 ring-[var(--surface)]" style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: shown.length - i }}>
          <Avatar size={size}>{avInitials(n)}</Avatar>
        </span>
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center shrink-0 rounded-full bg-surface-2 text-ink-soft font-bold ring-2 ring-[var(--surface)]"
          style={{ width: size, height: size, fontSize: Math.round(size * 0.34), marginLeft: overlap, zIndex: 0 }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

// ── Приоритет / статус задачи ────────────────────────────────────────────────
const PRI_COLOR: Record<string, string> = { high: "var(--pri-high)", med: "var(--pri-med)", low: "var(--pri-low)" };
export function PriDot({ pri }: { pri?: "high" | "med" | "low" | null }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: 8, height: 8, background: PRI_COLOR[pri ?? "low"] ?? "var(--pri-low)" }} />;
}

// Поддерживает оба написания статуса в данных: "in_progress" и "progress".
export const STATUS_META: Record<string, { color: string; label: string }> = {
  open: { color: "var(--status-open)", label: "Открыто" },
  in_progress: { color: "var(--status-prog)", label: "В работе" },
  progress: { color: "var(--status-prog)", label: "В работе" },
  done: { color: "var(--status-done)", label: "Готово" },
};

// ── StorageBadge (личное/общее хранилище встречи) ────────────────────────────
// Личное = замок в акцентном (янтарном) тоне; общее = «команда» в нейтральном.
// Показывать только для ПОДТВЕРЖДЁННЫХ встреч: у «ожидающих» приватность ещё не выбрана.
export function StorageBadge({ isPrivate }: { isPrivate: boolean }) {
  const style: CSSProperties = isPrivate
    ? { color: "var(--accent-ink)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }
    : { color: "var(--ink-soft)", background: "var(--surface-2)", border: "1px solid var(--line-2)" };
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold"
      style={{ fontSize: 11, borderRadius: 7, padding: "1px 7px", ...style }}
    >
      <RoyIcon name={isPrivate ? "lock" : "team"} size={11} strokeWidth={1.9} />
      {isPrivate ? "Личное" : "Общее"}
    </span>
  );
}

// ── Chip (фильтр/выбор) ──────────────────────────────────────────────────────
export function Chip({ children, active, onClick, leading }: { children: ReactNode; active?: boolean; onClick?: () => void; leading?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold whitespace-nowrap rounded-full border",
        TAP,
        active ? "bg-ink text-surface border-ink" : "bg-surface text-ink-soft border-line-2",
      )}
      style={{ fontSize: 13, padding: "7px 13px" }}
    >
      {leading}
      {children}
    </button>
  );
}

// ── Segmented (переключатель статуса/режима) ─────────────────────────────────
type SegItem = { id: string; label: string; count?: number };
export function Segmented({ items, value, onChange }: { items: SegItem[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-[3px] bg-surface-2 border border-line p-[3px]" style={{ borderRadius: 12 }}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 font-semibold border-0",
              TAP,
              on ? "bg-surface text-ink shadow-[0_1px_4px_rgba(80,60,20,.1)]" : "bg-transparent text-ink-soft",
            )}
            style={{ fontSize: 13.5, padding: "8px 6px", borderRadius: 9 }}
          >
            {it.label}
            {it.count != null && (
              <span style={{ fontSize: 11 }} className={on ? "text-accent-ink" : "text-ink-mute"}>
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Header (крупный заголовок экрана) ────────────────────────────────────────
export function RoyHeader({ title, right, sub }: { title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="px-5 pt-2 pb-3">
      <div className="flex items-center justify-between gap-2.5">
        {/* Единый масштаб заголовка экрана — ROY_TYPE.pageTitle (см. канон выше). */}
        <h1 className="leading-[1.1]" style={ROY_TYPE.pageTitle}>
          {title}
        </h1>
        {right}
      </div>
      {sub && (
        <div className="text-ink-soft" style={{ fontSize: 13.5, marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── IconBtn (круглая кнопка-иконка в шапке) ──────────────────────────────────
export function IconBtn({ name, onClick, className, "aria-label": ariaLabel }: { name: RoyIconName; onClick?: () => void; className?: string; "aria-label"?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn("inline-flex items-center justify-center shrink-0 rounded-full bg-surface border border-line-2 text-ink-soft", TAP, className)}
      style={{ width: 38, height: 38 }}
    >
      <RoyIcon name={name} size={19} strokeWidth={1.9} />
    </button>
  );
}

// ── SectionLabel (мелкий лейбл секции, uppercase) ────────────────────────────
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("font-mono font-semibold uppercase text-ink-mute", className)} style={{ fontSize: 11, letterSpacing: "0.08em", margin: "0 4px 9px" }}>
      {children}
    </div>
  );
}

// Рендер тезисов встречи. Все пути (granola/read.ai/рекордер/правка в боте) пишут один
// стабильный формат: «### Тема» + «- тезис». Парсим его сами (узкий формат — без markdown-
// зависимости: CSP/бандл-бюджет) в секции/списки, иначе в вебе видны литеральные ### и -.
// Единый компонент для всех экранов вычитки (DRY) — см. MeetAdmin/MeetingDetail/RecordDetail/Review.
type TezisyBlock =
  | { kind: "heading"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "para"; text: string };

function parseTezisy(src: string): TezisyBlock[] {
  const blocks: TezisyBlock[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) { blocks.push({ kind: "bullets", items: bullets }); bullets = []; }
  };
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    const heading = t.match(/^#{1,6}\s+(.+)$/);
    if (heading) { flush(); blocks.push({ kind: "heading", text: heading[1].trim() }); continue; }
    const bullet = t.match(/^[-*•]\s+(.+)$/);
    if (bullet) { bullets.push(bullet[1].trim()); continue; }
    flush();
    blocks.push({ kind: "para", text: t });
  }
  flush();
  return blocks;
}

// Инлайн-markdown: **жирный** → <strong> (срезаем звёздочки). GPT-дайджест шлёт **...**,
// а tezisy встреч иногда тоже — иначе видны сырые звёздочки.
function renderInline(text: string, onSource?: (n: number) => void, dt: (ru: string, en: string) => string = (ru) => ru): ReactNode {
  // Разбиваем по **bold** и сноскам [n]. Сноска → верхний индекс; кликабельный, если задан onSource
  // (клик открывает исходную запись — используется в дайджесте, где пункт привязан к источнику).
  const parts = text.split(/(\*\*[^*]+?\*\*|\[\d+\])/g);
  return parts.map((p, i) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
    }
    const ref = p.match(/^\[(\d+)\]$/);
    if (ref) {
      const n = Number(ref[1]);
      if (onSource) {
        return (
          <button key={i} type="button" onClick={() => onSource(n)} title={dt("Открыть источник", "Open source")}
            className="align-super rounded font-bold text-accent-ink transition-opacity hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            style={{ fontSize: 11 }}>{n}</button>
        );
      }
      return <sup key={i} className="text-accent-ink font-bold" style={{ fontSize: 11 }}>{n}</sup>;
    }
    return p;
  });
}

// Цветные эмодзи-заголовки дайджеста (🌍 ✅ 🔥 📋…) чужеродны лайн-арт-стилю → меняем на
// пиктограммы проекта. Неизвестный ведущий эмодзи просто срезаем (без иконки), чтобы сырых
// смайлов не оставалось.
const EMOJI_ICON: Record<string, RoyIconName> = {
  "🌍": "globe", "🌎": "globe", "🌏": "globe", "🗺": "globe",
  "✅": "check", "✔": "check", "☑": "check",
  "🔥": "flag", "⚠": "flag", "❗": "flag", "🚨": "flag", "🎯": "flag",
  "📋": "note", "📝": "note", "🗒": "note", "📌": "note", "📅": "cal",
  "🚀": "spark", "💡": "spark", "🎙": "mic", "👤": "team", "👥": "team", "🔗": "link",
};
function leadEmoji(text: string): { icon: RoyIconName | null; rest: string; had: boolean } {
  const m = text.match(/^\s*(\p{Extended_Pictographic})️?\s*/u);
  if (!m) return { icon: null, rest: text, had: false };
  return { icon: EMOJI_ICON[m[1]] ?? null, rest: text.slice(m[0].length), had: true };
}

export function TezisyBlocks({ text, className, onDeepen, onSource }: { text: string; className?: string; onDeepen?: (topic: string) => void; onSource?: (n: number) => void }) {
  const dt = useDt();
  const blocks = parseTezisy(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("flex flex-col", className)} style={{ gap: 9 }}>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const { icon, rest } = leadEmoji(b.text);
          return (
            <div key={i} className="flex items-center gap-2 font-semibold text-ink" style={{ fontSize: 14, letterSpacing: "-0.01em", marginTop: i === 0 ? 0 : 5 }}>
              {icon && <RoyIcon name={icon} size={15} strokeWidth={1.9} className="shrink-0 text-accent-ink" />}
              <span>{renderInline(rest, undefined, dt)}</span>
            </div>
          );
        }
        if (b.kind === "bullets") {
          return (
            <ul key={i} className="flex flex-col" style={{ gap: 4 }}>
              {b.items.map((it, j) => (
                <li key={j} className="group/deep flex items-start text-ink leading-relaxed" style={{ fontSize: 14, gap: 8 }}>
                  <span className="text-ink-mute select-none" style={{ marginTop: 1 }}>•</span>
                  <span className="flex-1">{renderInline(it, onSource, dt)}</span>
                  {(() => {
                    // Есть источник (сноска [n]) → лупа открывает исходную запись этого пункта.
                    // Иначе, если задан onDeepen → лупа углубляет тему через поиск (тезисы встреч).
                    const ref = onSource ? it.match(/\[(\d+)\]/) : null;
                    if (ref && onSource) {
                      const n = Number(ref[1]);
                      return (
                        <button type="button" onClick={() => onSource(n)} aria-label={dt("Открыть источник", "Open source")} title={dt("Открыть источник", "Open source")}
                          className="mt-0.5 shrink-0 text-ink-mute opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 focus-visible:outline-none group-hover/deep:opacity-100">
                          <RoyIcon name="search" size={14} strokeWidth={1.9} />
                        </button>
                      );
                    }
                    if (onDeepen) {
                      return (
                        <button type="button" onClick={() => onDeepen(it)} aria-label={dt("Углубиться в тему", "Dive deeper")} title={dt("Углубиться в тему", "Dive deeper")}
                          className="mt-0.5 shrink-0 text-ink-mute opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 focus-visible:outline-none group-hover/deep:opacity-100">
                          <RoyIcon name="search" size={14} strokeWidth={1.9} />
                        </button>
                      );
                    }
                    return null;
                  })()}
                </li>
              ))}
            </ul>
          );
        }
        {
          // Строка вида «🌍 **По рынкам…**» — это заголовок секции дайджеста: эмодзи → иконка.
          const { icon, rest, had } = leadEmoji(b.text);
          if (had) {
            return (
              <div key={i} className="flex items-center gap-2 font-semibold text-ink" style={{ fontSize: 14, letterSpacing: "-0.01em", marginTop: i === 0 ? 0 : 5 }}>
                {icon && <RoyIcon name={icon} size={15} strokeWidth={1.9} className="shrink-0 text-accent-ink" />}
                <span>{renderInline(rest, undefined, dt)}</span>
              </div>
            );
          }
        }
        return (
          <p key={i} className="text-ink leading-relaxed whitespace-pre-wrap" style={{ fontSize: 14 }}>
            {renderInline(b.text, undefined, dt)}
          </p>
        );
      })}
    </div>
  );
}

// ── FAB (плавающая кнопка действия) ──────────────────────────────────────────
export function FAB({ onClick, className, "aria-label": ariaLabel = "Создать" }: { onClick?: () => void; className?: string; "aria-label"?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "absolute z-20 flex items-center justify-center rounded-[18px] bg-primary text-white border-0 shadow-[0_10px_24px_-6px_rgba(200,130,30,.6)]",
        TAP,
        className,
      )}
      style={{ right: 18, bottom: 96, width: 56, height: 56 }}
    >
      <RoyIcon name="plus" size={26} strokeWidth={2.3} />
    </button>
  );
}

// ── NavHeader (шапка push-экрана с «Назад») ──────────────────────────────────
export function NavHeader({ onBack, title, right }: { onBack: () => void; title?: ReactNode; right?: ReactNode }) {
  return (
    <div className="shrink-0 flex items-center gap-2.5 bg-background dark:bg-[var(--surface)] dark:backdrop-blur-lg" style={{ padding: "6px 14px 10px" }}>
      <button
        type="button"
        onClick={onBack}
        className={cn("inline-flex items-center gap-0.5 bg-transparent border-0 text-primary font-semibold", TAP)}
        style={{ fontSize: 16, padding: "4px 4px 4px 0" }}
      >
        <RoyIcon name="cleft" size={20} strokeWidth={2.2} />
        Назад
      </button>
      <div className="flex-1 text-center font-semibold truncate" style={{ fontSize: 16, opacity: title ? 1 : 0 }}>
        {title}
      </div>
      <div className="flex justify-end" style={{ width: 64 }}>
        {right}
      </div>
    </div>
  );
}

// ── TabBar (4 корневых таба) ─────────────────────────────────────────────────
export const ROY_TABS: { id: string; label: string; icon: RoyIconName }[] = [
  { id: "search", label: "Поиск", icon: "search" },
  { id: "task", label: "Задачи", icon: "task" },
  { id: "book", label: "База", icon: "book" },
  { id: "cal", label: "Встречи", icon: "cal" },
];

export function RoyTabBar({ active, onChange, className }: { active: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={cn("shrink-0 flex justify-around items-start bg-surface border-t border-line", className)} style={{ paddingTop: 9, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
      {ROY_TABS.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn("flex flex-col items-center gap-1 bg-transparent border-0", TAP, on ? "text-primary" : "text-ink-mute")}
            style={{ padding: "2px 14px" }}
          >
            <RoyIcon name={t.icon} size={23} strokeWidth={on ? 2.1 : 1.8} />
            <span style={{ fontSize: 10.5 }} className={on ? "font-bold" : "font-medium"}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
