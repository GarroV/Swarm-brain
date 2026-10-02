"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, archiveShortLink, createShortLink, fetchShortLinks, type ShortLink } from "@/lib/api";
import { useDt } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";

// Сокращатель ссылок: вставил длинную → получил `<сайт>/s/<код>` и скопировал.
// Ниже — свои ссылки со счётчиком переходов; «убрать» архивирует (ссылка перестаёт открываться).
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
    case "demo_readonly": return dt("В демо ссылки не создаются", "Short links can't be created in the demo");
    default: return dt("Не получилось — попробуйте ещё раз", "Something went wrong — please try again");
  }
}

const shortUrl = (code: string) => `${window.location.origin}/s/${code}`;

export function ShortLinkTool({ onBack }: { onBack: () => void }) {
  const dt = useDt();
  const [input, setInput] = useState("");
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
      const link = await createShortLink(input);
      setLinks((prev) => [link, ...(prev ?? [])]);
      setInput("");
      await copy(link.code);
    } catch (e) {
      setError(errorText(e, dt));
    } finally {
      setBusy(false);
    }
  };

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
          "Вставьте длинную ссылку — короткая сразу окажется в буфере обмена. Открыть её может любой, у кого она есть.",
          "Paste a long link — the short one goes straight to your clipboard. Anyone who has it can open it.",
        )}
      </p>

      <form onSubmit={submit} className="flex gap-2 max-[520px]:flex-col">
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
        <button type="submit" disabled={busy || !input.trim()}
          className="rounded-[10px] bg-ink px-4 py-2.5 font-semibold text-surface disabled:opacity-50" style={{ fontSize: 14 }}>
          {busy ? dt("Сокращаю…", "Shortening…") : dt("Сократить", "Shorten")}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-destructive" style={{ fontSize: 13 }}>{error}</p>}

      <div className="mt-6">
        {links == null && !listFailed && [0, 1].map((i) => <div key={i} className="roy-shim mb-2" style={{ height: 58, borderRadius: 10 }} />)}
        {listFailed && (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>
            {dt("Список не загрузился — обновите страницу", "The list failed to load — reload the page")}
          </p>
        )}
        {links?.length === 0 && (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>{dt("Пока ни одной ссылки", "No links yet")}</p>
        )}
        {links?.map((l) => (
          <div key={l.code} className="mb-2 flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-ink" style={{ fontSize: 14 }}>{shortUrl(l.code).replace(/^https?:\/\//, "")}</div>
              <div className="truncate text-ink-soft" style={{ fontSize: 12 }} title={l.url}>{l.url}</div>
            </div>
            <span className="shrink-0 text-ink-soft" style={{ fontSize: 12 }} title={dt("Переходов", "Clicks")}>
              {l.clicks} <RoyIcon name="eye" size={13} className="inline align-[-2px]" />
            </span>
            <button type="button" onClick={() => copy(l.code)}
              className="shrink-0 rounded-[8px] border border-line px-2.5 py-1.5 text-ink" style={{ fontSize: 12 }}>
              {copied === l.code ? dt("Скопировано", "Copied") : dt("Копировать", "Copy")}
            </button>
            <button type="button" onClick={() => remove(l.code)} aria-label={dt("Убрать ссылку", "Remove link")}
              className="shrink-0 rounded-[8px] p-1.5 text-ink-soft hover:text-ink">
              <RoyIcon name="trash" size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
