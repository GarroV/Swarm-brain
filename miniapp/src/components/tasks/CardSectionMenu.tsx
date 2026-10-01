"use client";
import { type ReactNode, type Ref, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { cn } from "@/lib/utils";

// Ссылки, файлы и подзадачи в карточке задачи — пиктограммами с раскрывающимся меню
// (решение владельца 01.10.2026, docs/decisions/2026-10-01-task-card-compact-sections.md).
// Пустой раздел не рисуется: от него остаётся пиктограмма в строке CardIconBar. Непустой
// раздел показывает заголовок и список, а добавление — маленьким «+» у заголовка. И пиктограмма,
// и «+» открывают одно и то же меню: его содержимое передаётся сюда детьми.

const BTN_CLS =
  "grid shrink-0 place-items-center rounded-[7px] text-ink-mute transition-colors hover:bg-surface hover:text-ink " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] " +
  "disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-surface data-[popup-open]:text-ink";

export function CardSectionMenu({
  icon,
  label,
  variant = "icon",
  disabled = false,
  width = 300,
  triggerRef,
  children,
}: {
  icon: RoyIconName;
  label: string;
  /** "icon" — пиктограмма 28px в строке пустых разделов; "plus" — «+» у заголовка раздела. */
  variant?: "icon" | "plus";
  disabled?: boolean;
  width?: number;
  triggerRef?: Ref<HTMLButtonElement>;
  /** Содержимое меню; close — закрыть его после действия (фокус вернётся на кнопку). */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const plus = variant === "plus";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={label}
        aria-label={label}
        data-section-menu={icon}
        className={cn(BTN_CLS, plus ? "size-[22px]" : "size-[28px]")}
      >
        <RoyIcon
          name={plus ? "plus" : icon}
          size={plus ? 13 : 15}
          strokeWidth={plus ? 2 : 1.7}
        />
      </PopoverTrigger>
      <PopoverContent aria-label={label} style={{ width }}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/** Строка пиктограмм пустых разделов. Ничего не рисует, если все разделы уже заполнены. */
export function CardIconBar(
  { label, children }: { label: string; children: ReactNode },
) {
  return (
    <div
      role="group"
      aria-label={label}
      data-card-block="add-bar"
      className="-ml-1 flex items-center gap-0.5 empty:hidden"
    >
      {children}
    </div>
  );
}

/** Заголовок непустого раздела: название, счётчик и «+» справа от них. */
export function CardSectionHeader(
  { title, count, action }: {
    title: string;
    count?: ReactNode;
    action?: ReactNode;
  },
) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="font-semibold text-ink" style={{ fontSize: 13 }}>
        {title}
      </span>
      {count != null && (
        <span className="font-mono text-ink-mute" style={{ fontSize: 11.5 }}>
          {count}
        </span>
      )}
      {action}
    </div>
  );
}

/** Заголовок внутри меню — подпись того, что сейчас добавляется. */
export function MenuTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 font-semibold text-ink" style={{ fontSize: 12.5 }}>
      {children}
    </p>
  );
}
