"use client";
import { cn } from "@/lib/utils";

// Тумблер-переключатель (switch). Заведён для фильтров по статусу задач (issue #216, владелец
// 03.09.2026: «переключалки у статусов я просил тумблерами сделать») — но специально общий:
// в проекте до этого тумблерами назывались чипы («По рынкам», «Все сотрудники»), и второй
// самодельный переключатель рядом смотрелся бы как другая система.
//
// Анимируются только transform и background-color — свойства, дружелюбные к компоновщику,
// поэтому переключение не вызывает раскладку страницы.

type ToggleProps = {
  on: boolean;
  /** Не передаётся в визуальном режиме: клик обрабатывает внешняя кнопка. */
  onChange?: () => void;
  /** true — только вид, без своей семантики и обработчика: строка-кнопка снаружи уже
      объявлена role="switch", а вложенная кнопка сделала бы две цели для одного действия. */
  asVisual?: boolean;
  /** Цвет включённого состояния. По умолчанию — акцент продукта. */
  color?: string;
  /** Подпись для скринридера, когда рядом нет текстовой метки. */
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
};

export function Toggle({ on, onChange, asVisual, color = "var(--accent-ink)", ariaLabel, size = "md", className }: ToggleProps) {
  const w = size === "sm" ? 30 : 34;
  const h = size === "sm" ? 18 : 20;
  const knob = h - 6;
  const Tag = asVisual ? "span" : "button";
  return (
    <Tag
      {...(asVisual
        ? { "aria-hidden": true as const }
        : { type: "button" as const, role: "switch", "aria-checked": on, "aria-label": ariaLabel, onClick: onChange })}
      className={cn("relative inline-flex shrink-0 items-center rounded-full transition-colors", className)}
      style={{
        width: w,
        height: h,
        background: on ? color : "var(--surface-2)",
        border: `1px solid ${on ? color : "var(--line-2)"}`,
      }}
    >
      <span
        className="absolute rounded-full bg-white transition-transform"
        style={{
          width: knob,
          height: knob,
          left: 2,
          transform: `translateX(${on ? w - knob - 6 : 0}px)`,
          boxShadow: "0 1px 2px rgba(0,0,0,.18)",
        }}
      />
    </Tag>
  );
}
