"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApiError,
  archiveShortLink,
  createShortLink,
  fetchShortLinks,
  type ShortLink,
  type ShortLinkMeta,
  updateShortLink,
} from "@/lib/api";
import { useDt } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";
import { ShortLinkRow } from "./ShortLinkRow";

// Сокращатель ссылок: адрес + название (+ комментарий) → `<сайт>/s/<код>`, сразу в буфер.
// Ниже — все ссылки пространства с автором, временем и переходами, поиск по названию и
// комментарию. Править и убирать — автор или админ; «убрать» архивирует (ссылка перестаёт
// открываться). Видимость на всё пространство — решение владельца 03.10.2026 (issue #770).
// Адрес проверяет сервер (swarm-api/short-links-core.ts), экран только переводит код отказа в текст.

type Dt = (ru: string, en: string) => string;

function errorText(e: unknown, dt: Dt): string {
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : null;
  switch (code) {
    case "empty": return dt("Вставьте ссылку", "Paste a link");
    case "invalid": return dt("Это не похоже на адрес сайта", "This doesn't look like a web address");
    case "scheme": return dt("Подходят только ссылки http:// и https://", "Only http:// and https:// links are supported");
    case "credentials": return dt("Ссылка с логином и паролем внутри не принимается", "Links with a login and password inside are not accepted");
    case "loop": return dt("Это уже короткая ссылка", "This is already a short link");
    case "too_long": return dt("Ссылка слишком длинная", "The link is too long");
    case "rate_limited": return dt("Слишком много ссылок за сутки — попробуйте завтра", "Too many links today — try again tomorrow");
    case "title_required": return dt("Дайте ссылке название", "Give the link a name");
    case "title_too_long": return dt("Название длиннее 120 символов", "The name is longer than 120 characters");
    case "note_too_long": return dt("Комментарий длиннее 500 символов", "The comment is longer than 500 characters");
    case "not_found": return dt("Ссылка уже убрана или недоступна", "The link was removed or isn't available");
    case "demo_readonly": return dt("В демо ссылки не создаются", "Short links can't be created in the demo");
    default: return dt("Не получилось — попробуйте ещё раз", "Something went wrong — please try again");
  }
}

const shortUrl = (code: string) => `${window.location.origin}/s/${code}`;

export function ShortLinkTool({ onBack }: { onBack: () => void }) {
  const dt = useDt();
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<ShortLink[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetchShortLinks()
      .then(setLinks)
      .catch((e) => { console.error("[ShortLinkTool] list", e); setListFailed(true); });
  }, []);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(shortUrl(code));
      setCopied(code);
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1800);
    } catch (e) {
      console.error("[ShortLinkTool] copy", e);
      setError(dt("Не удалось скопировать — выделите ссылку вручную", "Couldn't copy — select the link manually"));
    }
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const link = await createShortLink(input, { title, note });
      setLinks((prev) => [link, ...(prev ?? [])]);
      setInput("");
      setTitle("");
      setNote("");
      await copy(link.code);
    } catch (e) {
      setError(errorText(e, dt));
    } finally {
      setBusy(false);
    }
  };

  const save = async (code: string, meta: ShortLinkMeta): Promise<boolean> => {
    setError(null);
    try {
      const updated = await updateShortLink(code, meta);
      setLinks((prev) => (prev ?? []).map((l) => (l.code === code ? updated : l)));
      return true;
    } catch (e) {
      setError(errorText(e, dt));
      return false;
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !links) return links;
    return links.filter((l) => `${l.title ?? ""} ${l.note ?? ""}`.toLowerCase().includes(q));
  }, [links, query]);

  const remove = async (code: string) => {
    try {
      await archiveShortLink(code);
      setLinks((prev) => (prev ?? []).filter((l) => l.code !== code));
    } catch (e) {
      console.error("[ShortLinkTool] archive", e);
      setError(dt("Не удалось убрать ссылку", "Couldn't remove the link"));
    }
  };

  return (
    <div className="mx-auto w-full max-w-[720px] p-4">
      <button type="button" onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-ink-soft hover:text-ink" style={{ fontSize: 13 }}>
        <RoyIcon name="cleft" size={16} />
        {dt("Полезности", "Tools")}
      </button>
      <h2 className="mb-1 font-semibold text-ink" style={{ fontSize: 18 }}>{dt("Короткие ссылки", "Short links")}</h2>
      <p className="mb-4 text-ink-soft" style={{ fontSize: 13 }}>
        {dt(
          "Вставьте длинную ссылку и дайте ей название — короткая сразу окажется в буфере обмена. Открыть её может любой, у кого она есть; список ниже видит вся команда.",
          "Paste a long link and give it a name — the short one goes straight to your clipboard. Anyone who has it can open it; the whole team sees the list below.",
        )}
      </p>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder={dt("Название, например «Акция, октябрь»", "Name, e.g. “October promo”")}
          aria-label={dt("Название", "Name")}
          className="rounded-[10px] border border-line bg-surface px-3 py-2.5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 14 }}
        />
        <div className="flex gap-2 max-[520px]:flex-col">
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://…/document.pdf"
          aria-label={dt("Длинная ссылка", "Long link")}
          className="min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 14 }}
        />
        <button type="submit" disabled={busy || !input.trim() || !title.trim()}
          className="rounded-[10px] bg-ink px-4 py-2.5 font-semibold text-surface disabled:opacity-50" style={{ fontSize: 14 }}>
          {busy ? dt("Сокращаю…", "Shortening…") : dt("Сократить", "Shorten")}
        </button>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={dt("Комментарий — необязательно", "Comment — optional")}
          aria-label={dt("Комментарий", "Comment")}
          className="resize-y rounded-[10px] border border-line bg-surface px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ fontSize: 13 }}
        />
      </form>
      {error && <p role="alert" className="mt-2 text-destructive" style={{ fontSize: 13 }}>{error}</p>}

      <div className="mt-6">
        {links == null && !listFailed && [0, 1].map((i) => <div key={i} className="roy-shim mb-2" style={{ height: 58, borderRadius: 10 }} />)}
        {listFailed && (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Список не загрузился — обновите страницу", "The list failed to load — reload the page")}
          </p>
        )}
        {links != null && links.length > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2">
            <RoyIcon name="search" size={15} className="text-ink-soft" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={dt("Поиск по названию и комментарию", "Search by name and comment")}
              aria-label={dt("Поиск ссылок", "Search links")}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none"
              style={{ fontSize: 13 }}
            />
          </div>
        )}
        {links != null && links.length > 0 && shown?.length === 0 && (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>{dt("Ничего не нашлось", "Nothing found")}</p>
        )}
        {links?.length === 0 && (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>{dt("Пока ни одной ссылки", "No links yet")}</p>
        )}
        {shown?.map((l) => (
          <ShortLinkRow
            key={l.code}
            link={l}
            dt={dt}
            copied={copied === l.code}
            onCopy={() => copy(l.code)}
            onSave={(meta) => save(l.code, meta)}
            onArchive={() => remove(l.code)}
          />
        ))}
      </div>
    </div>
  );
}
