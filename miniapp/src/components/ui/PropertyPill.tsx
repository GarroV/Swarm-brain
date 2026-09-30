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

// Сегментная пилюля — одна рамка, внутри кнопки-сегменты (статус; срок · пинг · повтор).
// Пустой сегмент — только бледный значок, заданный — заливка и значение рядом со значком:
// пилюля «расширяется» ровно на то, что задано (владелец 29.09.2026: «чтобы новые секции
// как бы расширяли пилюлю»). Высота как у чипа: 40px на телефоне, 30px с `sm`.
export const PILL_GROUP_CLS =
  "inline-flex max-w-full items-center gap-0.5 rounded-full border border-line-2 bg-surface p-0.5";

export const pillSegmentCls = (on: boolean) =>
  `inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 font-semibold transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 sm:min-h-[24px] sm:min-w-0 ${on
    ? "bg-accent-soft text-accent-ink"
    : "text-ink-mute enabled:hover:bg-surface-2 enabled:hover:text-ink"}`;

// Сегмент-триггер кастомного Select внутри сегментной пилюли: гасим рамку, высоту, шеврон и
// тёмную подсветку базы SelectTrigger — вид тот же, что у кнопок-сегментов.
export const pillSegmentSelectCls = (on: boolean) =>
  `${pillSegmentCls(on)} w-auto max-w-[220px] border-0 py-0 text-sm shadow-none data-[size=default]:h-auto ${on ? "dark:bg-accent-soft dark:hover:bg-accent-soft" : "dark:bg-transparent dark:hover:bg-surface-2"} [&>*:last-child]:hidden`;

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
