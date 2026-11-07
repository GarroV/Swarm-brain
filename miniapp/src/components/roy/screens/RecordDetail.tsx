"use client";
import { useEffect, useState } from "react";
import { useRoyNav, useDt } from "../nav";
import { NavHeader, TypeTag, Market, SectionLabel, TezisyBlocks, Participants } from "../ui";
import type { Attendee } from "@/types";
import { RoyIcon } from "../icons";
import { entryTagKey, deriveEntryTitle, isSearchIndexSummary, entryImporterName } from "../entry";
import { fetchEntry, createTask } from "@/lib/api";
import type { Entry } from "@/types";
import { formatDate } from "@/lib/displayFormat";
import { entrySourceLabel } from "@/lib/sourceLabels";

const RECORD_COPY = {
  record: { ru: "Запись", en: "Record" },
  loadError: { ru: "Не удалось загрузить запись.", en: "Could not load the record." },
  source: { ru: "Источник", en: "Source" },
  addedBy: { ru: "добавил", en: "Added by" },
  download: { ru: "Скачать файл", en: "Download file" },
  aiSummary: { ru: "Кратко от ИИ", en: "AI summary" },
  text: { ru: "Текст", en: "Text" },
} as const;

function fmtDate(iso: string | null): string {
  return formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) ?? "";
}

// Содержимое записи + обязательная строка источника. Переиспользуется push-экраном RecordDetail
// и контекстным окном ответа (AnswerModal).
export function RecordBody({ entry: e }: { entry: Entry }) {
  const dt = useDt();
  const tx = (key: keyof typeof RECORD_COPY) => dt(RECORD_COPY[key].ru, RECORD_COPY[key].en);
  const who = entryImporterName(e);
  const date = fmtDate(e.entry_date || e.created_at);
  // Участники из календаря — кладутся в metadata.attendees при публикации встречи рекордера.
  const attendees = (e.metadata?.attendees as Attendee[] | undefined) ?? [];
  // Вложение. API отдаёт ссылку уже нормализованной (/api/file/<path>) — публичных ссылок на
  // файлы команды не существует, доступ проверяется на каждом открытии. Строить адрес здесь
  // нельзя: в metadata лежит путь, а у старых записей — ещё прежний URL.
  const fileHref = typeof e.metadata?.file_url === "string" ? (e.metadata.file_url as string) : null;
  const fileName = (e.metadata?.file_name ?? e.metadata?.filename) as string | undefined;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 pt-1">
        <TypeTag type={entryTagKey(e)} />
        <Market code={e.countries?.[0]} />
        {date && <span className="text-ink-mute" style={{ fontSize: 12 }}>{date}</span>}
      </div>
      <h1 className="mb-2 font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
        {deriveEntryTitle(e)}
      </h1>
      {/* Источник / провенанс — у каждой записи. */}
      <div className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-soft" style={{ fontSize: 12 }}>
        <span className="inline-flex items-center gap-1.5">
          <RoyIcon name="link" size={13} className="text-ink-mute" />
          {tx("source")}: <span className="font-semibold text-ink">{entrySourceLabel(e, dt)}</span>
        </span>
        {who && <span>· {tx("addedBy")}: <span className="font-semibold text-ink">{who}</span></span>}
      </div>
      {fileHref && (
        <a
          href={fileHref}
          target="_blank"
          rel="noreferrer"
          className="mb-3.5 inline-flex max-w-full items-center gap-2 px-3 py-2 text-ink transition hover:opacity-80"
          style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 8, fontSize: 13 }}
        >
          <RoyIcon name={entryTagKey(e) === "pdf" ? "pdf" : "doc"} size={15} className="shrink-0 text-accent-ink" />
          <span className="truncate font-semibold">{fileName || tx("download")}</span>
        </a>
      )}
      {attendees.length > 0 && (
        <div className="mb-3.5 -mt-1.5">
          <Participants attendees={attendees} />
        </div>
      )}
      {e.summary && !isSearchIndexSummary(e) && (
        <div className="mb-4 px-4 py-3.5" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 10 }}>
          <div className="mb-1.5 font-mono font-semibold uppercase text-accent-ink" style={{ fontSize: 10.5, letterSpacing: "0.08em" }}>{tx("aiSummary")}</div>
          <TezisyBlocks text={e.summary} />
        </div>
      )}
      <SectionLabel>{tx("text")}</SectionLabel>
      <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 14.5, lineHeight: 1.65 }}>{e.content}</p>
    </>
  );
}

export function RecordDetail({ id }: { id: string }) {
  const { pop, setTab, toast } = useRoyNav();
  const dt = useDt();
  const tx = (key: keyof typeof RECORD_COPY) => dt(RECORD_COPY[key].ru, RECORD_COPY[key].en);
  const [e, setE] = useState<Entry | null>(null);
  const [err, setErr] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreateTask = async () => {
    if (!e || creating) return;
    setCreating(true);
    try {
      await createTask({ title: deriveEntryTitle(e), country: e.countries?.[0] ?? null });
      toast("Задача создана");
      setTab("task");
    } catch {
      toast("Не удалось создать задачу");
      setCreating(false);
    }
  };

  useEffect(() => {
    let alive = true;
    fetchEntry(id).then((x) => alive && setE(x)).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={tx("record")} />
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        {err && <div className="py-8 text-center text-sm text-ink-soft">{tx("loadError")}</div>}
        {e && <RecordBody entry={e} />}
      </div>
      <div className="shrink-0 border-t border-line bg-background dark:bg-[var(--surface)] px-5 pt-3" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <button
          type="button"
          onClick={handleCreateTask}
          disabled={!e || creating}
          className="w-full rounded-full bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60"
          style={{ fontSize: 15 }}
        >
          {creating ? "Создаём…" : "В задачу"}
        </button>
      </div>
    </div>
  );
}
