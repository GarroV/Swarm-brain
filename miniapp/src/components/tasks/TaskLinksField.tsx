"use client";
import { useState } from "react";
import type { TaskLink } from "@/types";
import { addLink, isSafeLinkUrl, linkLabel, LINKS_MAX } from "@/lib/taskLinks";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// Поле «Ссылки» в карточке задачи — над описанием (решение владельца 18.09.2026).
// В эталоне ссылки живут строкой внутри задачи; отдельным полем их видно, не читая описание,
// и, главное, они переживают правку текста — вырезанная из абзаца ссылка исчезала молча.
//
// Пустое по умолчанию: одна строка ввода, без списка и без заголовка-обрубка. Поле, которое
// на 90% задач не нужно, не должно занимать место в карточке.

export function TaskLinksField(
  { links, onChange, disabled = false }: {
    links: TaskLink[];
    onChange: (next: TaskLink[]) => void;
    disabled?: boolean;
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
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-ink-soft">
        {dt("Ссылки", "Links")}
      </label>

      {links.length > 0 && (
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
                  onClick={() => onChange(links.filter((_, j) => j !== i))}
                  className="shrink-0 rounded p-0.5 text-ink-soft hover:text-destructive"
                >
                  <RoyIcon name="x" size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && links.length < LINKS_MAX && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="https://…"
            inputMode="url"
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink outline-none focus:border-primary/50"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={dt("название (необязательно)", "title (optional)")}
            className="w-36 rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={submit}
            title={dt("Добавить ссылку", "Add link")}
            className="shrink-0 rounded-lg border border-line bg-surface p-1.5 text-ink-soft hover:bg-surface-2"
          >
            <RoyIcon name="plus" size={12} strokeWidth={2} />
          </button>
        </div>
      )}

      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}
