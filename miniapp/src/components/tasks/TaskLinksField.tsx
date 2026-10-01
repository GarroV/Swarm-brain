"use client";
import { type KeyboardEvent, type ReactNode, type Ref, useState } from "react";
import type { TaskLink } from "@/types";
import { addLink, isSafeLinkUrl, linkLabel, LINKS_MAX } from "@/lib/taskLinks";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import {
  CardSectionHeader,
  CardSectionMenu,
  MenuTitle,
} from "@/components/tasks/CardSectionMenu";

// Поле «Ссылки» в карточке задачи — над описанием (решение владельца 18.09.2026).
// В эталоне ссылки живут строкой внутри задачи; отдельным полем их видно, не читая описание,
// и, главное, они переживают правку текста — вырезанная из абзаца ссылка исчезала молча.
//
// Пустой раздел не рисуется вовсе (решение владельца 01.10.2026): от него остаётся пиктограмма
// в строке CardIconBar, а поле ввода живёт в её меню — TaskLinkForm. Непустой — TaskLinksList:
// заголовок, список и «+» у заголовка, который открывает то же меню.

/** Форма добавления ссылки — содержимое меню. onAdded — ссылка принята, меню можно закрыть. */
export function TaskLinkForm(
  { links, onChange, onAdded }: {
    links: TaskLink[];
    onChange: (next: TaskLink[]) => void;
    onAdded?: () => void;
  },
) {
  const dt = useDt();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const result = addLink(links, url, title);
    if (!result.ok) {
      // Пустая строка — не ошибка: человек просто нажал Enter в пустом поле.
      setErr(
        result.reason === "empty" ? null : {
          "not-url": dt(
            "Это не адрес — нужен полный, с http:// или https://",
            "Not an address — a full http:// or https:// URL is needed",
          ),
          protocol: dt(
            "Принимаются только адреса http:// и https://",
            "Only http:// and https:// addresses are accepted",
          ),
          duplicate: dt("Такая ссылка уже есть", "That link is already here"),
          limit: dt(
            `Больше ${LINKS_MAX} ссылок у одной задачи — это уже папка`,
            `More than ${LINKS_MAX} links on one task is a folder, not a task`,
          ),
        }[result.reason],
      );
      return;
    }
    onChange(result.links);
    setUrl("");
    setTitle("");
    setErr(null);
    onAdded?.();
  };

  if (links.length >= LINKS_MAX) {
    return (
      <p className="text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          `У задачи уже ${LINKS_MAX} ссылок — больше не добавить`,
          `The task already has ${LINKS_MAX} links — no more fit`,
        )}
      </p>
    );
  }

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };
  const inputCls =
    "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-ink outline-none placeholder:text-ink-mute focus:border-primary/50";

  return (
    <div className="flex flex-col gap-1.5">
      <MenuTitle>{dt("Ссылка", "Link")}</MenuTitle>
      <input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setErr(null);
        }}
        onKeyDown={onEnter}
        placeholder="https://…"
        inputMode="url"
        aria-label={dt("Адрес ссылки", "Link address")}
        className={inputCls}
        style={{ fontSize: 13 }}
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onEnter}
        placeholder={dt("Название (необязательно)", "Title (optional)")}
        aria-label={dt("Название ссылки", "Link title")}
        className={inputCls}
        style={{ fontSize: 13 }}
      />
      {err && (
        <p className="text-destructive" style={{ fontSize: 11.5 }}>{err}</p>
      )}
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="text-ink-mute" style={{ fontSize: 11.5 }}>
          {dt("Enter — добавить", "Enter to add")}
        </span>
        <button
          type="button"
          onClick={submit}
          className="h-[28px] rounded-full bg-primary px-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 12.5 }}
        >
          {dt("Добавить", "Add")}
        </button>
      </div>
    </div>
  );
}

/** Непустой раздел «Ссылки»: заголовок с «+» (action) и список. Пустой не рисуется. */
export function TaskLinksList(
  { links, onChange, disabled = false, action }: {
    links: TaskLink[];
    onChange: (next: TaskLink[]) => void;
    disabled?: boolean;
    action?: ReactNode;
  },
) {
  const dt = useDt();
  if (links.length === 0) return null;
  return (
    <div>
      <CardSectionHeader
        title={dt("Ссылки", "Links")}
        count={links.length}
        action={action}
      />
      <ul className="space-y-1">
        {links.map((link, i) => (
          <li
            key={link.url}
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1"
          >
            <RoyIcon
              name="link"
              size={12}
              className="shrink-0 text-ink-soft"
            />
            {
              /* Небезопасный адрес показываем текстом, а не ссылкой: строки, записанные до
                  проверки на сервере, не должны стать кликабельными. */
            }
            {isSafeLinkUrl(link.url)
              ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-xs text-primary hover:underline"
                  title={link.url}
                >
                  {linkLabel(link)}
                </a>
              )
              : (
                <span
                  className="min-w-0 flex-1 truncate text-xs text-ink-soft"
                  title={link.url}
                >
                  {linkLabel(link)}
                </span>
              )}
            {!disabled && (
              <button
                type="button"
                title={dt("Убрать ссылку", "Remove link")}
                aria-label={dt("Убрать ссылку", "Remove link")}
                onClick={() => onChange(links.filter((_, j) => j !== i))}
                className="shrink-0 rounded p-0.5 text-ink-soft hover:text-destructive"
              >
                <RoyIcon name="x" size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Меню ссылки — для строки пустых разделов (variant "icon") и для «+» у заголовка. */
export function LinksMenu(
  { links, onChange, variant = "icon", disabled, triggerRef, onDone }: {
    links: TaskLink[];
    onChange: (next: TaskLink[]) => void;
    variant?: "icon" | "plus";
    disabled?: boolean;
    triggerRef?: Ref<HTMLButtonElement>;
    /** Ссылка добавлена — меню закрыто. */
    onDone?: () => void;
  },
) {
  const dt = useDt();
  return (
    <CardSectionMenu
      icon="link"
      variant={variant}
      label={dt("Добавить ссылку", "Add a link")}
      disabled={disabled || links.length >= LINKS_MAX}
      triggerRef={triggerRef}
    >
      {(close) => (
        <TaskLinkForm
          links={links}
          onChange={onChange}
          onAdded={() => {
            close();
            onDone?.();
          }}
        />
      )}
    </CardSectionMenu>
  );
}
