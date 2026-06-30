"use client";
import { useCallback, useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, RoyCard, SectionLabel, Avatar, Segmented, TezisyBlocks, Participants } from "../ui";
import { RoyIcon } from "../icons";
import { deriveEntryTitle } from "../entry";
import {
  fetchMeetings,
  fetchAgentMeetings,
  fetchAgentMeeting,
  patchMeeting,
  patchAgentMeetingDraft,
  renameAgentMeeting,
  resummarizeAgentMeeting,
  deleteMeeting,
  deleteAgentMeeting,
  publishAgentMeeting,
} from "@/lib/api";
import type { Entry, AgentMeeting, TranscriptSegment } from "@/types";
import { sourceLabel } from "./RoyMeetingsScreen";
import { TasksFromMeeting } from "../TasksFromMeeting";
import { MarkdownTextarea } from "../MarkdownTextarea";

// ── Типы объединённого списка ────────────────────────────────────────────────

type MeetItem =
  | { kind: "entry"; data: Entry }
  | { kind: "agent"; data: AgentMeeting };

// Хранилище при согласовании/публикации: общее (воркспейс) либо личное.
type Storage = "shared" | "personal";

function itemId(it: MeetItem): string {
  return it.data.id;
}

function itemTitle(it: MeetItem): string {
  if (it.kind === "entry") return deriveEntryTitle(it.data);
  return it.data.title ?? "Встреча без названия";
}

function itemDate(it: MeetItem): string | null {
  if (it.kind === "entry") return it.data.entry_date ?? it.data.created_at;
  return it.data.started_at ?? it.data.created_at;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}

function itemSource(it: MeetItem): string {
  return sourceLabel(it.data.source);
}

// Кто принёс запись: для entry — added_by (granola/read.ai), для рекордера —
// имена записавших (recorder_names с сервера). null, если неизвестно.
function itemRecorder(it: MeetItem): string | null {
  if (it.kind === "entry") {
    // Кто вкинул встречу: резолвнутое имя импортёра; иначе added_by, но НЕ источник "granola"
    // (это не человек) → тогда ничего.
    if (it.data.importer_name) return it.data.importer_name;
    const a = it.data.added_by;
    return a && a !== "granola" && a !== "read_ai" ? a : null;
  }
  const names = it.data.recorder_names?.filter(Boolean) ?? [];
  return names.length ? names.join(", ") : null;
}

// ── Стат-плашка ──────────────────────────────────────────────────────────────

function StatChip({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className="flex-1 rounded-[12px] border border-line bg-surface px-3 py-2.5"
    >
      <div
        className="font-bold leading-none"
        style={{ fontSize: 24, color: accent ? "var(--accent-ink)" : "var(--ink)" }}
      >
        {value}
      </div>
      <div className="mt-1 font-semibold text-ink-mute" style={{ fontSize: 11 }}>
        {label}
      </div>
    </div>
  );
}

// ── Строка списка ─────────────────────────────────────────────────────────────

function ListRow({
  item,
  active,
  onClick,
  removing = false,
}: {
  item: MeetItem;
  active: boolean;
  onClick: () => void;
  removing?: boolean;
}) {
  const isAgent = item.kind === "agent";
  const title = itemTitle(item);
  const date = fmtDate(itemDate(item));
  const src = itemSource(item);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={removing}
      // Exit-анимация при согласовании/удалении: затухание + сворачивание (maxHeight) + лёгкий сдвиг.
      className={`block w-full text-left overflow-hidden transition-all duration-300 ease-out${
        removing ? " opacity-0 -translate-x-2 scale-[0.97] pointer-events-none" : " hover:scale-[1.01]"
      }`}
      style={{ maxHeight: removing ? 0 : 260 }}
    >
      <RoyCard
        className="px-3.5 py-3 transition-colors hover:border-line-2 hover:bg-surface-2"
        style={active ? { borderColor: "var(--accent-ink)", background: "var(--accent-soft)" } : {}}
      >
        <div className="flex items-start gap-3">
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-[11px]"
            style={{ width: 34, height: 34, background: "var(--meet-soft)", color: "var(--meet-ink)" }}
          >
            <RoyIcon name="meet" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-semibold text-ink"
              style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}
            >
              {title}
            </div>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center font-semibold"
                style={{
                  fontSize: 10,
                  color: isAgent ? "var(--status-open)" : "var(--meet-ink)",
                  background: isAgent ? "color-mix(in srgb, var(--status-open) 10%, transparent)" : "var(--meet-soft)",
                  borderRadius: 6,
                  padding: "1px 6px",
                }}
              >
                {isAgent ? "На вычитке" : "На согласовании"}
              </span>
              <span className="text-ink-mute font-medium" style={{ fontSize: 11 }}>
                {src}
              </span>
              {date && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>
                  {date}
                </span>
              )}
              {itemRecorder(item) && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>· {itemRecorder(item)}</span>
              )}
            </div>
          </div>
        </div>
      </RoyCard>
    </button>
  );
}

// ── Inline-редактор содержания (entry) ────────────────────────────────────────

function ContentEditor({
  entry,
  onSaved,
}: {
  entry: Entry;
  onSaved: (updated: Entry) => void;
}) {
  const { toast } = useRoyNav();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [saving, setSaving] = useState(false);

  // Если выбрали другую запись — сбросить локальное состояние редактора.
  useEffect(() => {
    setEditing(false);
    setDraft(entry.content);
    setSaving(false);
  }, [entry.id, entry.content]);

  const startEdit = () => {
    setDraft(entry.content);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(entry.content);
    setEditing(false);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await patchMeeting(entry.id, { content: draft });
      onSaved(updated);
      setEditing(false);
    } catch {
      toast("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const hasContent = Boolean(entry.content?.trim());

  return (
    <div>
      <div className="flex items-center justify-between" style={{ margin: "0 4px 9px" }}>
        <span className="font-bold uppercase text-ink-mute" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
          Содержание
        </span>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 bg-transparent border-0 font-semibold text-ink-soft transition-opacity hover:opacity-70"
            style={{ fontSize: 11.5 }}
          >
            <RoyIcon name="pencil" size={13} strokeWidth={1.9} />
            Редактировать
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            className="w-full resize-y rounded-[12px] border border-line bg-surface text-ink leading-relaxed outline-none focus:border-[var(--accent-ink)] disabled:opacity-50"
            style={{ fontSize: 13, padding: "10px 12px", minHeight: 220 }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="inline-flex items-center gap-1.5 rounded-[11px] border-0 font-semibold transition-opacity disabled:opacity-50"
              style={{ padding: "8px 14px", fontSize: 13, background: "var(--accent-ink)", color: "var(--card)" }}
            >
              <RoyIcon name="check" size={14} strokeWidth={2.1} />
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={cancel}
              className="rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-opacity disabled:opacity-50"
              style={{ padding: "7px 14px", fontSize: 13 }}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : hasContent ? (
        <p className="text-ink-soft leading-relaxed whitespace-pre-wrap" style={{ fontSize: 13 }}>
          {entry.content.slice(0, 800)}{entry.content.length > 800 ? "…" : ""}
        </p>
      ) : (
        <p className="text-ink-mute" style={{ fontSize: 13 }}>Содержания нет.</p>
      )}
    </div>
  );
}


// ── Панель деталей (центр) ────────────────────────────────────────────────────

function DetailPanel({
  item,
  onEntryUpdated,
  onAgentUpdated,
}: {
  item: MeetItem;
  onEntryUpdated: (updated: Entry) => void;
  onAgentUpdated: (updated: AgentMeeting) => void;
}) {
  const title = itemTitle(item);
  const date = fmtDate(itemDate(item));
  const src = itemSource(item);
  // Инлайн-правка названия встречи (карандаш у заголовка). Пишем в metadata.title (его и
  // предпочитает deriveEntryTitle). Сброс при смене выбранной записи.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  useEffect(() => { setEditingTitle(false); }, [item.data.id]);

  if (item.kind === "entry") {
    const e = item.data;
    const saveTitle = async () => {
      const t = titleDraft.trim();
      if (!t || t === title) { setEditingTitle(false); return; }
      setSavingTitle(true);
      try {
        const updated = await patchMeeting(e.id, { title: t });
        onEntryUpdated(updated);
        setEditingTitle(false);
      } catch { /* оставляем режим правки при ошибке */ }
      setSavingTitle(false);
    };
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-16">
        <div>
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={titleDraft}
                onChange={(ev) => setTitleDraft(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter") saveTitle(); if (ev.key === "Escape") setEditingTitle(false); }}
                disabled={savingTitle}
                className="min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 py-2 font-bold text-ink outline-none focus:border-[var(--accent-ink)] disabled:opacity-50"
                style={{ fontSize: 24, letterSpacing: "-0.02em" }}
              />
              <button type="button" onClick={saveTitle} disabled={savingTitle} aria-label="Сохранить название"
                className="inline-flex shrink-0 items-center justify-center rounded-[10px] p-2.5 text-ink transition-opacity hover:opacity-70 disabled:opacity-50">
                <RoyIcon name="check" size={18} strokeWidth={2} />
              </button>
              <button type="button" onClick={() => setEditingTitle(false)} disabled={savingTitle} aria-label="Отмена"
                className="inline-flex shrink-0 items-center justify-center rounded-[10px] p-2.5 text-ink-mute transition-opacity hover:opacity-70 disabled:opacity-50">
                <RoyIcon name="x" size={18} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <h2 className="flex-1 font-bold text-ink leading-tight" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
                {title}
              </h2>
              <button type="button" onClick={() => { setTitleDraft(title); setEditingTitle(true); }} aria-label="Изменить название"
                className="mt-1 inline-flex shrink-0 items-center justify-center rounded-[10px] p-2 text-ink-mute transition-colors hover:bg-accent-soft hover:text-ink active:scale-[0.94]">
                <RoyIcon name="pencil" size={18} strokeWidth={1.9} />
              </button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center font-semibold"
              style={{ fontSize: 11, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 7, padding: "2px 8px" }}
            >
              {src}
            </span>
            {date && <span className="text-ink-mute" style={{ fontSize: 12 }}>{date}</span>}
            {itemRecorder(item) && (
              <span className="text-ink-mute" style={{ fontSize: 12 }}>· Импортировал: {itemRecorder(item)}</span>
            )}
            {e.countries?.[0] && (
              <span
                className="inline-flex items-center font-semibold text-ink-soft bg-surface-2 border border-line-2"
                style={{ fontSize: 11, borderRadius: 7, padding: "2px 7px" }}
              >
                {e.countries[0]}
              </span>
            )}
          </div>
        </div>

        {e.summary && (
          <div>
            <SectionLabel>Саммари</SectionLabel>
            <TezisyBlocks text={e.summary} />
          </div>
        )}

        <ContentEditor entry={e} onSaved={onEntryUpdated} />
      </div>
    );
  }

  // AgentMeeting — вынесено в отдельный компонент: там живёт поллинг тезисов.
  return <AgentMeetingDetail meeting={item.data} title={title} date={date} src={src} onUpdated={onAgentUpdated} />;
}

// ── Деталь черновика агента (с поллингом тезисов) ─────────────────────────────

const AGENT_POLL_MS = 10_000;
// После ~3 минут непрерывного поллинга (18 опросов по 10с) показываем подсказку,
// что обработка затянулась — фоновая задача могла отвалиться на длинной записи.
const AGENT_SLOW_POLL_COUNT = 18;

// Подпись секунд транскрипта в строку «спикер: текст». Спикер опционален
// (может быть «собеседник»/«я»); если его нет — выводим только текст.
function transcriptLine(seg: TranscriptSegment): string {
  const speaker = seg.speaker?.trim();
  return speaker ? `${speaker}: ${seg.text}` : seg.text;
}

function AgentMeetingDetail({
  meeting,
  title,
  date,
  src,
  onUpdated,
}: {
  meeting: AgentMeeting;
  title: string;
  date: string | null;
  src: string;
  onUpdated: (updated: AgentMeeting) => void;
}) {
  const { toast } = useRoyNav();
  // Локальная копия: поллинг подменяет её свежими данными по мере готовности тезисов.
  const [m, setM] = useState<AgentMeeting>(meeting);
  // Счётчик опросов: после AGENT_SLOW_POLL_COUNT показываем подсказку «обработка затянулась».
  const [pollCount, setPollCount] = useState(0);

  // Инлайн-правка названия и тезисов черновика (до публикации). Сброс при смене встречи.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  useEffect(() => { setEditingTitle(false); setEditingNotes(false); setSaving(false); setCopied(false); setReprocessing(false); }, [meeting.id]);

  // Переобработать тезисы текущим промптом (из сохранённого транскрипта, без ре-транскрибации).
  const reprocess = async () => {
    if (reprocessing) return;
    setReprocessing(true);
    try { apply(await resummarizeAgentMeeting(m.id)); toast("Тезисы переобработаны"); }
    catch { toast("Не удалось переобработать"); }
    finally { setReprocessing(false); }
  };

  const copyTranscript = async () => {
    const text = (m.transcript?.segments ?? []).map(transcriptLine).join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Не удалось скопировать");
    }
  };

  const apply = (updated: AgentMeeting) => { setM(updated); onUpdated(updated); };

  const saveTitle = async () => {
    const t = titleDraft.trim();
    if (!t || saving) { setEditingTitle(false); return; }
    setSaving(true);
    try { apply(await renameAgentMeeting(m.id, t)); setEditingTitle(false); }
    catch { toast("Не удалось сохранить название"); }
    finally { setSaving(false); }
  };

  const saveNotes = async () => {
    if (saving) return;
    setSaving(true);
    try { apply(await patchAgentMeetingDraft(m.id, notesDraft)); setEditingNotes(false); }
    catch { toast("Не удалось сохранить тезисы"); }
    finally { setSaving(false); }
  };

  // Смена выбранной встречи: сразу показать данные из списка, затем подтянуть полную
  // деталь. Список (GET /agent-meetings) НЕ содержит transcript — он есть только в
  // детальном GET /agent-meetings/:id. Без этой догрузки стенограмма не видна, когда
  // тезисы уже готовы (поллинг ниже в этом случае не стартует и деталь не запрашивает).
  useEffect(() => {
    setM(meeting);
    setPollCount(0);
    let alive = true;
    fetchAgentMeeting(meeting.id)
      .then((full) => {
        if (alive) setM(full);
      })
      .catch(() => {
        /* оставляем данные из списка при ошибке догрузки */
      });
    return () => {
      alive = false;
    };
  }, [meeting]);

  // Поллинг, пока тезисы готовятся (нет draft_notes_md) и обработка не упала.
  useEffect(() => {
    if (m.draft_notes_md || m.summary_status === "failed") return;
    const id = setInterval(() => {
      setPollCount((c) => c + 1);
      fetchAgentMeeting(m.id)
        .then(setM)
        .catch(() => {
          /* сохраняем текущее при ошибке поллинга */
        });
    }, AGENT_POLL_MS);
    return () => clearInterval(id);
  }, [m.id, m.draft_notes_md, m.summary_status]);

  // Подсказка, что обработка затянулась: всё ещё processing, тезисов нет, опросов накопилось много.
  const isTakingTooLong =
    !m.draft_notes_md && m.summary_status !== "failed" && pollCount >= AGENT_SLOW_POLL_COUNT;

  const segments = m.transcript?.segments ?? [];
  const hasTranscript = segments.length > 0;

  return (
    // Панель — flex-колонка во всю высоту: шапка фиксирована, контент скроллится в своём контейнере.
    <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
      <div className="shrink-0">
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
              disabled={saving}
              className="min-w-0 flex-1 rounded-[10px] border border-line-2 bg-surface px-3 py-1.5 font-bold text-ink outline-none focus:border-primary disabled:opacity-50"
              style={{ fontSize: 24, letterSpacing: "-0.02em" }}
            />
            <button type="button" onClick={saveTitle} disabled={saving} aria-label="Сохранить название" className="inline-flex items-center justify-center rounded-[9px] bg-primary text-white disabled:opacity-50" style={{ width: 32, height: 32 }}>
              <RoyIcon name="check" size={16} strokeWidth={2.2} />
            </button>
            <button type="button" onClick={() => setEditingTitle(false)} disabled={saving} aria-label="Отмена" className="inline-flex items-center justify-center rounded-[9px] border border-line bg-surface text-ink-soft disabled:opacity-50" style={{ width: 32, height: 32 }}>
              <RoyIcon name="x" size={15} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <div className="group flex items-start gap-2">
            <h2 className="flex-1 font-bold text-ink leading-tight" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
              {title}
            </h2>
            <button
              type="button"
              onClick={() => { setTitleDraft(m.title ?? ""); setEditingTitle(true); }}
              aria-label="Изменить название"
              className="mt-1 inline-flex shrink-0 items-center justify-center rounded-[9px] text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
              style={{ width: 30, height: 30 }}
            >
              <RoyIcon name="pencil" size={15} strokeWidth={1.9} />
            </button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center font-semibold"
            style={{ fontSize: 11, color: "var(--status-open)", background: "color-mix(in srgb, var(--status-open) 10%, transparent)", borderRadius: 7, padding: "2px 8px" }}
          >
            На вычитке
          </span>
          <span
            className="inline-flex items-center font-semibold"
            style={{ fontSize: 11, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 7, padding: "2px 8px" }}
          >
            {src}
          </span>
          {date && <span className="text-ink-mute" style={{ fontSize: 12 }}>{date}</span>}
          {m.recorder_names && m.recorder_names.length > 0 && (
            <span className="text-ink-mute" style={{ fontSize: 12 }}>
              · Записал: {m.recorder_names.join(", ")}
            </span>
          )}
        </div>
        {m.attendees && m.attendees.length > 0 && (
          <div className="mt-1.5">
            <Participants attendees={m.attendees} />
          </div>
        )}
      </div>

      {/* Тезисы + транскрипт скроллятся внутри своего контейнера, а не растят страницу. */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-16">
        {/* Верх: тезисы / статус обработки */}
        {m.draft_notes_md ? (
          <div>
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Тезисы</SectionLabel>
              {!editingNotes && (
                <div className="-mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={reprocess}
                    disabled={reprocessing || !hasTranscript}
                    title="Пересобрать тезисы текущим ИИ-промптом из транскрипта"
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97] disabled:opacity-50"
                    style={{ padding: "5px 11px", fontSize: 12 }}
                  >
                    <RoyIcon name="spark" size={13} strokeWidth={1.9} /> {reprocessing ? "Обрабатываю…" : "Переобработать"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNotesDraft(m.draft_notes_md ?? ""); setEditingNotes(true); }}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97]"
                    style={{ padding: "5px 11px", fontSize: 12 }}
                  >
                    <RoyIcon name="pencil" size={13} strokeWidth={1.9} /> Править
                  </button>
                </div>
              )}
            </div>
            {editingNotes ? (
              <div className="mt-1">
                <MarkdownTextarea value={notesDraft} onChange={setNotesDraft} disabled={saving} autoFocus />
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={saveNotes} disabled={saving} className="flex-1 rounded-[12px] bg-primary py-2.5 font-semibold text-white disabled:opacity-60" style={{ fontSize: 14 }}>
                    {saving ? "Сохраняем…" : "Сохранить тезисы"}
                  </button>
                  <button type="button" onClick={() => setEditingNotes(false)} disabled={saving} className="rounded-[12px] border border-line-2 px-4 py-2.5 font-semibold text-ink-soft disabled:opacity-60" style={{ fontSize: 14 }}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <TezisyBlocks text={m.draft_notes_md} />
            )}
          </div>
        ) : m.summary_status === "failed" ? (
          <p className="text-ink-soft" style={{ fontSize: 13 }}>
            ⚠️ Не удалось обработать запись — попробуй записать заново.
          </p>
        ) : (
          <div>
            <p className="text-ink-mute" style={{ fontSize: 13 }}>Тезисы готовятся…</p>
            {isTakingTooLong && (
              <p className="text-ink-mute mt-1" style={{ fontSize: 13 }}>
                Обработка затянулась — возможно, запись слишком длинная. Можно подождать ещё или переснять покороче.
              </p>
            )}
          </div>
        )}

        {/* Низ: транскрипт — всегда видим (тезисы могут быть пустыми/в работе, а исходный текст нужен). */}
        {hasTranscript && (
          <div className="border-t border-line pt-3">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Транскрипт</SectionLabel>
              <button
                type="button"
                onClick={copyTranscript}
                className="-mt-1.5 inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,border-color] duration-150 hover:scale-[1.03] hover:border-line-2 active:scale-[0.97]"
                style={{ padding: "5px 11px", fontSize: 12 }}
              >
                {copied && <RoyIcon name="check" size={13} strokeWidth={2.2} />}
                {copied ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {segments.map((s, i) => (
                <p
                  key={i}
                  className="text-ink-mute leading-relaxed whitespace-pre-wrap"
                  style={{ fontSize: 13 }}
                >
                  {transcriptLine(s)}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Панель действий (справа) ──────────────────────────────────────────────────

type ActionState = "idle" | "busy" | "done";

function ActionsPanel({
  item,
  onConfirm,
  onReject,
  onReclassify,
}: {
  item: MeetItem;
  onConfirm: (storage: Storage) => Promise<void>;
  onReject: () => Promise<void>;
  onReclassify: () => Promise<void>;
}) {
  const [confirmState, setConfirmState] = useState<ActionState>("idle");
  const [rejectState, setRejectState] = useState<ActionState>("idle");
  const [reclassState, setReclassState] = useState<ActionState>("idle");
  const [storage, setStorage] = useState<Storage>("shared");
  const isAgent = item.kind === "agent";

  // Смена выбранной записи — вернуть хранилище к дефолту.
  useEffect(() => {
    setStorage("shared");
    setConfirmState("idle");
    setRejectState("idle");
    setReclassState("idle");
  }, [item.data.id]);

  const handleConfirm = async () => {
    if (confirmState !== "idle") return;
    setConfirmState("busy");
    try {
      await onConfirm(storage);
      setConfirmState("done");
    } catch {
      setConfirmState("idle");
    }
  };

  const handleReject = async () => {
    if (rejectState !== "idle") return;
    setRejectState("busy");
    try {
      await onReject();
      setRejectState("done");
    } catch {
      setRejectState("idle");
    }
  };

  const handleReclassify = async () => {
    if (reclassState !== "idle") return;
    setReclassState("busy");
    try {
      await onReclassify();
      setReclassState("done");
    } catch {
      setReclassState("idle");
    }
  };

  const confirmLabel = confirmState === "busy" ? "…" : confirmState === "done" ? "Готово" : isAgent ? "Опубликовать" : "Согласовать";
  const rejectLabel = rejectState === "busy" ? "…" : rejectState === "done" ? "Удалено" : "Отклонить";
  const reclassLabel = reclassState === "busy" ? "…" : reclassState === "done" ? "В заметках" : "Не встреча → в заметки";

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <SectionLabel>Решение</SectionLabel>

      {/* Выбор хранилища */}
      <Segmented
        items={[
          { id: "shared", label: "Общее" },
          { id: "personal", label: "Личное" },
        ]}
        value={storage}
        onChange={(id) => setStorage(id as Storage)}
      />

      {/* Кнопка «Согласовать / Опубликовать» */}
      <button
        type="button"
        disabled={confirmState !== "idle"}
        onClick={handleConfirm}
        className="flex w-full items-center justify-center gap-2 rounded-[13px] border-0 font-semibold transition-[transform,opacity,filter] duration-150 hover:scale-[1.02] hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
        style={{
          padding: "10px 14px",
          fontSize: 14,
          background: "var(--accent-ink)",
          color: "var(--card)",
        }}
      >
        <RoyIcon name="check" size={16} strokeWidth={2.1} />
        {confirmLabel}
      </button>

      {/* Кнопка «Отклонить» */}
      <button
        type="button"
        disabled={rejectState !== "idle"}
        onClick={handleReject}
        className="flex w-full items-center justify-center gap-2 rounded-[13px] border border-line bg-surface font-semibold transition-[transform,background,border-color] duration-150 hover:scale-[1.02] hover:border-[var(--pri-high)] active:scale-[0.98] disabled:opacity-50"
        style={{
          padding: "9px 14px",
          fontSize: 14,
          color: "var(--pri-high)",
        }}
      >
        <RoyIcon name="trash" size={15} strokeWidth={1.9} />
        {rejectLabel}
      </button>

      {/* «Не встреча → в заметки» — полноценной кнопкой под «Отклонить» (только entry) */}
      {!isAgent && (
        <button
          type="button"
          disabled={reclassState !== "idle"}
          onClick={handleReclassify}
          className="flex w-full items-center justify-center gap-1.5 rounded-[13px] border border-line bg-surface font-semibold text-ink-soft transition-[transform,background,border-color] duration-150 hover:scale-[1.02] hover:border-line-2 hover:bg-surface-2 active:scale-[0.98] disabled:opacity-50"
          style={{ padding: "9px 14px", fontSize: 13.5 }}
        >
          <RoyIcon name="note" size={15} strokeWidth={1.9} />
          {reclassLabel}
        </button>
      )}

      {/* Сгенерировать задачи из встречи — в правой панели под кнопками решения.
          entry: привязываем к записи (meeting_id). agent-черновик: записи ещё нет (entry_id
          появится при публикации) → задачи автономные; извлекаем из draft_notes_md, когда готовы. */}
      {item.kind === "entry" && (
        <div className="mt-1 border-t border-line pt-3">
          <TasksFromMeeting text={item.data.content} meetingId={item.data.id} resetKey={item.data.id} />
        </div>
      )}
      {item.kind === "agent" && item.data.draft_notes_md && (
        <div className="mt-1 border-t border-line pt-3">
          <TasksFromMeeting text={item.data.draft_notes_md} resetKey={item.data.id} />
        </div>
      )}

      {isAgent && (
        <p className="text-ink-mute leading-snug" style={{ fontSize: 11 }}>
          «Опубликовать» — сохранит тезисы в базу команды или в личное хранилище. Название и тезисы можно поправить прямо здесь (карандаш у заголовка / «Править» у тезисов).
        </p>
      )}
    </div>
  );
}

// ── Главный экран ─────────────────────────────────────────────────────────────

// Область видимости очереди ревью. «Мои» — только загруженные текущим пользователем
// pending-встречи (дефолт для всех, включая админа). «Все» — все pending воркспейса,
// доступно только админу (сервер уважает ?all=true лишь для is_admin).
// Область очереди вычитки: все (личные+командные) / только мои / только команды.
type Scope = "all" | "mine" | "team";

export function MeetAdminScreen() {
  const { pop, toast, me } = useRoyNav();
  const isAdmin = Boolean(me?.is_admin);

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [agentMeetings, setAgentMeetings] = useState<AgentMeeting[] | null>(null);
  const [selected, setSelected] = useState<MeetItem | null>(null);
  const [scope, setScope] = useState<Scope>("all");

  // Админ всегда тянет весь воркспейс (?all=true), а на «Личные/Общие/Все» делит ЛОКАЛЬНО —
  // так видны оба счётчика сразу без перезапроса. Не-админ получает только своё (privacy на бэке).
  const all = isAdmin;

  const load = useCallback(async () => {
    const [ents, agents] = await Promise.allSettled([
      fetchMeetings({ confirmed: false, all }),
      fetchAgentMeetings("awaiting_review", all),
    ]);
    setEntries(ents.status === "fulfilled" ? ents.value : []);
    setAgentMeetings(agents.status === "fulfilled" ? agents.value : []);
  }, [all]);

  // Смена области видимости перезагружает очередь и сбрасывает выбор (он мог исчезнуть из списка).
  useEffect(() => {
    setEntries(null);
    setAgentMeetings(null);
    setSelected(null);
    load();
  }, [load]);

  // Объединяем: черновики агента первыми (аппрув-нужные), потом неподтверждённые встречи
  const items: MeetItem[] = [
    ...(agentMeetings ?? []).map((m): MeetItem => ({ kind: "agent", data: m })),
    ...(entries ?? []).map((e): MeetItem => ({ kind: "entry", data: e })),
  ];

  // Личное vs общее — по ВЛАДЕЛЬЦУ: рекордерный черновик «мой», если я среди записавших;
  // entry (Granola/Read.ai на согласовании) «мой», если owner_id == я (Read.ai без owner → общее).
  const meId = me?.telegram_id ?? null;
  const isMine = (it: MeetItem): boolean =>
    it.kind === "agent"
      ? (it.data.recorders ?? []).some((r) => r.telegram_id === meId)
      : it.data.owner_id === meId;
  const mineItems = items.filter(isMine);
  const teamItems = items.filter((it) => !isMine(it));
  const displayed = scope === "mine" ? mineItems : scope === "team" ? teamItems : items;

  const removeFromList = (id: string) => {
    setEntries((prev) => prev?.filter((e) => e.id !== id) ?? null);
    setAgentMeetings((prev) => prev?.filter((m) => m.id !== id) ?? null);
    setSelected((prev) => (prev && prev.data.id === id ? null : prev));
  };

  // Плавный уход карточки из очереди (согласование/удаление): помечаем removing → CSS-затухание
  // и сворачивание ~280мс → затем реально убираем из списка. Иначе карточка исчезала рывком.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const animateRemove = (id: string): Promise<void> =>
    new Promise((resolve) => {
      setRemovingIds((s) => new Set(s).add(id));
      setTimeout(() => {
        removeFromList(id);
        setRemovingIds((s) => { const n = new Set(s); n.delete(id); return n; });
        resolve();
      }, 280);
    });

  // Иммутабельно заменяет запись в списке встреч и в выбранной (если совпадает id).
  const onEntryUpdated = (updated: Entry) => {
    setEntries((prev) => prev?.map((e) => (e.id === updated.id ? updated : e)) ?? null);
    setSelected((prev) =>
      prev && prev.kind === "entry" && prev.data.id === updated.id
        ? { kind: "entry", data: updated }
        : prev,
    );
  };

  // То же для agent-черновика (правка названия/тезисов на ревью): обновляем список и выбранное.
  const onAgentUpdated = (updated: AgentMeeting) => {
    setAgentMeetings((prev) => prev?.map((mm) => (mm.id === updated.id ? updated : mm)) ?? null);
    setSelected((prev) =>
      prev && prev.kind === "agent" && prev.data.id === updated.id
        ? { kind: "agent", data: updated }
        : prev,
    );
  };

  const handleConfirm = async (item: MeetItem, storage: Storage) => {
    if (item.kind === "entry") {
      // Подтверждение встречи + выбор хранилища (личное/общее)
      await patchMeeting(item.data.id, { confirmed: true, is_private: storage === "personal" });
      toast(storage === "personal" ? "Согласовано в личное" : "Встреча согласована");
      await animateRemove(item.data.id);
    } else {
      // Публикация черновика агента в выбранную базу
      await publishAgentMeeting(item.data.id, storage === "personal" ? "personal" : "workspace");
      toast(storage === "personal" ? "Опубликовано в личное" : "Черновик опубликован");
      await animateRemove(item.data.id);
    }
  };

  const handleReject = async (item: MeetItem) => {
    if (item.kind === "entry") {
      if (typeof window !== "undefined" && !window.confirm(`Удалить встречу «${itemTitle(item)}»? Это удалит и расшифровку.`)) return;
      await deleteMeeting(item.data.id);
      toast("Встреча удалена");
      await animateRemove(item.data.id);
    } else {
      if (typeof window !== "undefined" && !window.confirm(`Удалить черновик «${itemTitle(item)}»? Это удалит расшифровку и тезисы.`)) return;
      await deleteAgentMeeting(item.data.id);
      toast("Черновик удалён");
      await animateRemove(item.data.id);
    }
  };

  // Реклассификация встречи в заметку — убирает её из очереди встреч (entry only).
  const handleReclassify = async (item: MeetItem) => {
    if (item.kind !== "entry") return;
    await patchMeeting(item.data.id, { entry_type: "note" });
    toast("Перемещено в заметки");
    await animateRemove(item.data.id);
  };

  const isLoading = entries === null || agentMeetings === null;

  return (
    // flex-1 + min-h-0 (а не h-full): надёжно занимает высоту flex-родителя без капризов
    // процентной высоты → внутренние overflow-y-auto колонки реально скроллятся.
    <div className="roy-pop flex min-h-0 flex-1 flex-col overflow-hidden">
      <NavHeader onBack={pop} title="Ревью встреч" />

      {/* ── Трёхколоночный master-detail ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Левая колонка: список ──────────────────────────────────────────── */}
        <div
          className="flex flex-col border-r border-line shrink-0 min-h-0"
          style={{ width: 300 }}
        >
          {/* Счётчик-фильтр: личные / общие (объединяет источники Granola/Read.ai/рекордер).
              Админ видит разбивку по владельцу и фильтрует локально; не-админ — только свои. */}
          {isAdmin ? (
            <div className="px-3 py-3">
              <Segmented
                items={[
                  { id: "all", label: "Все", count: items.length },
                  { id: "mine", label: "Личные", count: mineItems.length },
                  { id: "team", label: "Общие", count: teamItems.length },
                ]}
                value={scope}
                onChange={(id) => { setScope(id as Scope); setSelected(null); }}
              />
            </div>
          ) : (
            <div className="flex gap-2 px-3 py-3">
              <StatChip label="требуют решения" value={items.length} accent />
            </div>
          )}

          {/* Метка секции */}
          <div className="px-3 pb-1">
            <SectionLabel>Требуют решения</SectionLabel>
          </div>

          {/* Список */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-16 space-y-2">
            {isLoading && (
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="roy-shim" style={{ height: 66, borderRadius: 18 }} />
                ))}
              </>
            )}
            {!isLoading && displayed.length === 0 && (
              <div className="py-8 text-center text-ink-mute" style={{ fontSize: 13 }}>
                {items.length === 0 ? "Всё согласовано" : "Здесь пусто"}
              </div>
            )}
            {displayed.map((item) => (
              <ListRow
                key={itemId(item)}
                item={item}
                active={selected !== null && itemId(selected) === itemId(item)}
                onClick={() => setSelected(item)}
                removing={removingIds.has(itemId(item))}
              />
            ))}
          </div>
        </div>

        {/* ── Центр: детали ─────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {selected ? (
            <DetailPanel item={selected} onEntryUpdated={onEntryUpdated} onAgentUpdated={onAgentUpdated} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-2">
                <div
                  className="inline-flex items-center justify-center rounded-[16px]"
                  style={{ width: 56, height: 56, background: "var(--meet-soft)", color: "var(--meet-ink)" }}
                >
                  <RoyIcon name="meet" size={28} />
                </div>
                <p className="text-ink-mute font-medium" style={{ fontSize: 13 }}>
                  Выберите встречу
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Правая колонка: действия + задачи из встречи ─────────────────────── */}
        <div
          className="flex flex-col border-l border-line shrink-0 min-h-0"
          style={{ width: 320 }}
        >
          {selected ? (
            <>
              {/* Краткая сводка выбранной */}
              <div className="px-4 py-3 border-b border-line">
                <p className="font-semibold text-ink truncate" style={{ fontSize: 13.5 }}>
                  {itemTitle(selected)}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Avatar size={18}>
                    {itemTitle(selected).slice(0, 2).toUpperCase()}
                  </Avatar>
                  <span className="text-ink-mute" style={{ fontSize: 11 }}>
                    {itemSource(selected)} · {fmtDate(itemDate(selected)) ?? "—"}
                    {itemRecorder(selected) && ` · ${itemRecorder(selected)}`}
                  </span>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ActionsPanel
                  item={selected}
                  onConfirm={(storage) => handleConfirm(selected, storage)}
                  onReject={() => handleReject(selected)}
                  onReclassify={() => handleReclassify(selected)}
                />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-4">
              <p className="text-center text-ink-mute" style={{ fontSize: 12 }}>
                Выберите встречу для действий
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
