"use client";
// Чип свойства карточки задачи: «значок · значение» (макет владельца 28.09.2026 — все настройки
// кнопками прямо под названием). Заданное значение — спокойный чип с рамкой, пустое — бледный
// пунктирный с названием свойства, чтобы было видно, что его можно задать.
//
// До 28.09.2026 здесь жили строки «иконка · подпись · значение справа» (PropertyRow). Логика
// выбора у свойств прежняя — меняется только оболочка-кнопка.
//
// Высота: 40px на телефоне — норма тач-цели, её НЕ уменьшаем; на десктопе 30px (там мышь).
//
// Часть чипов рисуют собственную кнопку (DatePicker, CountryPopover, Select) — им отдаём
// `propertyPillCls` и `PropertyPillBody`, чтобы вид был один и тот же, а не похожий.
import type { ReactNode } from "react";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";

const PILL_BASE =
  "inline-flex max-w-full min-h-10 items-center gap-1.5 rounded-full border px-2.5 text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[30px]";

export const propertyPillCls = (filled: boolean) =>
  `${PILL_BASE} ${filled
    ? "border-line-2 bg-surface text-ink hover:bg-surface-2"
    : "border-dashed border-line-2 bg-transparent text-ink-mute hover:bg-surface-2 hover:text-ink-soft"}`;

// Для триггера кастомного Select: гасим его собственные фон/высоту/шеврон (база SelectTrigger
// ставит `dark:bg-input/30` и фиксированную высоту — в тёмной теме чип стоял бы подсвеченным).
export const propertyPillSelectCls = (filled: boolean) =>
  `${propertyPillCls(filled)} w-auto justify-start px-2.5 py-0 data-[size=default]:h-auto ${filled ? "dark:bg-surface" : "dark:bg-transparent"} dark:hover:bg-surface-2 [&>*:last-child]:hidden`;

/** Начинка чипа: значок, скрытое для глаза название свойства (для скринридера) и значение.
 *  Пустой чип (value = null) показывает само название — второй раз для скринридера его не читаем. */
export function PropertyPillBody({ icon, label, value }: { icon: RoyIconName; label: string; value: ReactNode | null }) {
  return (
    <>
      <RoyIcon name={icon} size={14} strokeWidth={1.9} className="shrink-0 text-ink-mute" />
      {value != null && <span className="sr-only">{label}: </span>}
      <span className="min-w-0 max-w-[200px] truncate" style={{ fontSize: 12.5 }}>{value ?? label}</span>
    </>
  );
}

type PropertyPillProps = {
  icon: RoyIconName;
  /** Название свойства — подсказка и подпись для скринридера. */
  label: string;
  /** Значение; пустое (null) — чип рисуется пунктиром с названием свойства. */
  value: ReactNode | null;
  disabled?: boolean;
  onClick?: () => void;
  expanded?: boolean;
  title?: string;
};

/** Готовый чип для свойств, у которых нет своего триггера-компонента. */
export function PropertyPill({ icon, label, value, disabled = false, onClick, expanded, title }: PropertyPillProps) {
  const filled = value != null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      title={title ?? label}
      className={propertyPillCls(filled)}
    >
      <PropertyPillBody icon={icon} label={label} value={value} />
    </button>
  );
}
