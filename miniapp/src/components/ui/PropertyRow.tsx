"use client";
// Строка свойства: «иконка · подпись · значение справа». Тихий вид — в покое ни рамки, ни фона;
// подложка и шеврон появляются под курсором и в фокусе. Так колонка настроек читается сводкой,
// а не формой из десятка одинаковых боксов (владелец 2026-08-28: «очень все крупно, хочется
// минимализма в интерфейсе задач»).
//
// Высота: 40px на телефоне — норма тач-цели, поднятая намеренно (см. историю min-h-10 в
// TaskModal), её НЕ уменьшаем. На десктопе 34px: там целятся мышью, и лишние 6px на каждой из
// шести строк — это треть экрана впустую.
//
// Часть строк рисуют собственную кнопку (DatePicker, CountryPopover, Select) — им отдаём
// `propertyRowCls` и части подписи/значения, чтобы вид был один и тот же, а не похожий.
import type { ReactNode } from "react";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";

export const propertyRowCls =
  "group/prow flex w-full min-h-[40px] items-center gap-2.5 rounded-[10px] border border-transparent bg-transparent px-2 py-0 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:min-h-[34px]";

/** Иконка + название свойства. Спокойный вес: значение справа должно читаться первым. */
export function PropertyLabel({ icon, children }: { icon: RoyIconName; children: ReactNode }) {
  return (
    <>
      <RoyIcon name={icon} size={15} strokeWidth={1.8} className="shrink-0 text-ink-mute" />
      <span className="shrink-0 text-ink-soft" style={{ fontSize: 12.5 }}>{children}</span>
    </>
  );
}

/** Значение — прижато к правому краю, чтобы значения выстроились в колонку и сканировались. */
export function PropertyValue({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={`ml-auto min-w-0 truncate font-medium ${muted ? "text-ink-mute" : "text-ink"}`}
      style={{ fontSize: 13 }}
    >
      {children}
    </span>
  );
}

/** Шеврон-подсказка «строку можно нажать». В покое невидим — иначе шесть стрелок создают шум. */
export function PropertyChevron() {
  return (
    <RoyIcon
      name="cright"
      size={12}
      strokeWidth={2}
      className="shrink-0 text-ink-mute opacity-0 transition-opacity group-hover/prow:opacity-100 group-focus-visible/prow:opacity-100"
    />
  );
}

// Класс для триггера кастомного Select. Кроме рамки и высоты гасим ЕГО СОБСТВЕННЫЙ фон: база
// SelectTrigger ставит `dark:bg-input/30`, из-за чего в тёмной теме строки «Проект»/«Исполнитель»
// стояли подсвеченными в покое, пока соседние строки были прозрачными. Шеврон — только на hover.
export const propertySelectCls = `${propertyRowCls} justify-start data-[size=default]:h-auto dark:bg-transparent dark:hover:bg-surface-2 [&>svg:last-of-type]:size-3 [&>svg:last-of-type]:text-ink-mute [&>svg:last-of-type]:opacity-0 [&>svg:last-of-type]:transition-opacity hover:[&>svg:last-of-type]:opacity-100 focus-visible:[&>svg:last-of-type]:opacity-100`;

type PropertyRowProps = {
  icon: RoyIconName;
  label: ReactNode;
  value: ReactNode;
  /** Значение пустое или недоступное — приглушаем, чтобы взгляд его пропускал. */
  muted?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  expanded?: boolean;
};

/** Готовая строка для свойств, у которых нет своего триггера-компонента. */
export function PropertyRow({ icon, label, value, muted = false, disabled = false, onClick, expanded }: PropertyRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      className={`${propertyRowCls} disabled:cursor-not-allowed disabled:hover:bg-transparent`}
    >
      <PropertyLabel icon={icon}>{label}</PropertyLabel>
      <PropertyValue muted={muted}>{value}</PropertyValue>
      {!disabled && <PropertyChevron />}
    </button>
  );
}
