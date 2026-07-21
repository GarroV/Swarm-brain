"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchAgentMeeting, patchAgentMeetingDraft, renameAgentMeeting, publishAgentMeeting, resummarizeAgentMeeting } from "@/lib/api";
import type { AgentMeeting } from "@/types";
import { TezisyBlocks, Segmented } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";

type Props = { id: string; onClose: () => void; onChanged?: () => void };

// Roy-кнопки/поля (без shadcn).
const btnPrimary =
  "w-full rounded-[12px] bg-primary px-4 py-2.5 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const btnOutline =
  "rounded-[12px] border border-line bg-surface px-4 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

function fmtTs(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// Время суток сегмента = старт записи + смещение сегмента (сек). started_at в UTC →
// toLocaleTimeString переводит в локальную зону браузера. Фолбэк на MM:SS, если старта нет.
function fmtClock(startISO: string | null, sec: number): string {
  if (!startISO) return fmtTs(sec);
  const base = Date.parse(startISO);
  if (Number.isNaN(base)) return fmtTs(sec);
  return new Date(base + Math.max(0, sec) * 1000).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function MeetingReview({ id, onClose, onChanged }: Props) {
  const [meeting, setMeeting] = useState<AgentMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [base, setBase] = useState<"workspace" | "personal">("workspace");
  const [showTranscript, setShowTranscript] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await fetchAgentMeeting(id);
      setMeeting(m);
      setDraft(m.draft_notes_md ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить встречу");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const reprocess = async () => {
    if (reprocessing) return;
    setReprocessing(true);
    try {
      const m = await resummarizeAgentMeeting(id);
      setMeeting(m);
      setDraft(m.draft_notes_md ?? "");
      onChanged?.();
    } catch {
      /* оставляем текущее состояние при ошибке */
    } finally {
      setReprocessing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const m = await patchAgentMeetingDraft(id, draft);
      setMeeting(m);
      setEditing(false);
      onChanged?.();
    } finally { setSaving(false); }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await publishAgentMeeting(id, base);
      onChanged?.();
      onClose();
    } finally { setPublishing(false); }
  };

  const saveTitle = async () => {
    const t = titleDraft.trim();
    if (!t) { setEditingTitle(false); return; }
    setSavingTitle(true);
    try {
      const m = await renameAgentMeeting(id, t);
      setMeeting(m);
      setEditingTitle(false);
      onChanged?.();
    } finally {
      setSavingTitle(false);
    }
  };

  const canRename = !!meeting && meeting.status !== "in_base";
  const header = (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-line shrink-0 bg-background dark:bg-[var(--surface)] dark:backdrop-blur-lg">
      <button onClick={onClose} aria-label="Назад" className="text-ink-soft transition-colors hover:text-ink">
        <RoyIcon name="cleft" size={20} strokeWidth={2.2} />
      </button>
      {editingTitle ? (
        <div className="flex flex-1 items-center gap-1.5">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
            autoFocus
            placeholder="Название встречи"
            className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-base font-semibold text-ink outline-none focus:border-[var(--accent-ink)]"
          />
          <button onClick={saveTitle} disabled={savingTitle} aria-label="Сохранить название" className="disabled:opacity-50" style={{ color: "var(--status-done)" }}><RoyIcon name="check" size={20} strokeWidth={2.2} /></button>
          <button onClick={() => setEditingTitle(false)} aria-label="Отмена" className="text-ink-soft"><RoyIcon name="x" size={20} /></button>
        </div>
      ) : (
        <>
          <h1 className="font-bold flex-1 truncate text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>{meeting?.title ?? "Встреча"}</h1>
          {canRename && (
            <button onClick={() => { setTitleDraft(meeting!.title ?? ""); setEditingTitle(true); }} aria-label="Переименовать" className="transition-colors hover:opacity-80" style={{ color: "var(--accent-ink)" }}>
              <RoyIcon name="pencil" size={17} strokeWidth={1.9} />
            </button>
          )}
        </>
      )}
    </div>
  );

  if (loading) {
    return <div className="flex flex-col h-full">{header}<p className="text-center text-ink-soft py-8 text-sm">Загрузка…</p></div>;
  }
  if (error || !meeting) {
    return <div className="flex flex-col h-full">{header}<p className="text-center py-8 text-sm" style={{ color: "var(--pri-high)" }}>{error ?? "Не найдено"}</p></div>;
  }

  const published = meeting.status === "in_base";
  const recorders = meeting.recorders ?? [];
  const segments = meeting.transcript?.segments ?? [];
  const hasTranscript = segments.length > 0;
  // Пустая строка тезисов = НЕ готово (модель вернула пусто). Раньше `!== null` считал "" готовым → голый «—».
  const notesReady = !!meeting.draft_notes_md;
  const summaryTerminal = meeting.summary_status === "done" || meeting.summary_status === "failed";

  return (
    <div className="flex flex-col h-full">
      {header}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <span className="rounded-[7px] px-2 py-0.5 font-semibold" style={{ fontSize: 11, color: "var(--meet-ink)", background: "var(--meet-soft)" }}>Рекордер</span>
          {meeting.started_at && <span className="font-mono">{meeting.started_at.slice(0, 10)}</span>}
          {published
            ? <span className="inline-flex items-center gap-1" style={{ color: "var(--status-done)" }}><RoyIcon name="check" size={13} strokeWidth={2.2} /> В базе</span>
            : <span className="inline-flex items-center gap-1" style={{ color: "var(--status-open)" }}><RoyIcon name="clock" size={13} strokeWidth={1.9} /> На вычитке</span>}
          {meeting.recorder_names?.length
            ? <span>· Записал: {meeting.recorder_names.join(", ")}</span>
            : recorders.length > 0 && <span>· записали: {recorders.length}</span>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-ink-soft">Тезисы</p>
            {!published && notesReady && !editing && (
              <button onClick={() => setEditing(true)} className="text-xs font-semibold text-primary">Редактировать</button>
            )}
          </div>
          {notesReady ? (
            editing ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full min-h-[220px] resize-none rounded-[12px] border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)]"
                />
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving} className={`${btnPrimary} flex-1`} style={{ fontSize: 14 }}>{saving ? "…" : "Сохранить"}</button>
                  <button onClick={() => { setDraft(meeting.draft_notes_md ?? ""); setEditing(false); }} className={btnOutline} style={{ fontSize: 14 }}>Отмена</button>
                </div>
              </div>
            ) : (
              <TezisyBlocks text={meeting.draft_notes_md ?? ""} />
            )
          ) : summaryTerminal ? (
            // Обработка завершена, но тезисов нет (пусто/сбой) — даём «Переобработать» из транскрипта,
            // а не молчаливый «—» без выхода.
            <div className="space-y-2">
              <p className="text-sm text-ink-soft">
                {meeting.summary_status === "failed"
                  ? "⚠️ Не удалось обработать запись. Переобработай из транскрипта ниже или переснимай."
                  : "Тезисы не сформированы — модель не нашла содержательных пунктов. Можно переобработать из транскрипта ниже."}
              </p>
              {hasTranscript && (
                <button onClick={reprocess} disabled={reprocessing} className={btnOutline} style={{ fontSize: 14 }}>
                  <span className="inline-flex items-center gap-1.5"><RoyIcon name="spark" size={13} strokeWidth={1.9} /> {reprocessing ? "Обрабатываю…" : "Переобработать"}</span>
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Готовим тезисы…</p>
          )}
        </div>

        {segments.length > 0 && (
          <div>
            <button onClick={() => setShowTranscript((v) => !v)} className="flex items-center gap-1.5 text-xs text-ink-soft transition-colors hover:text-ink">
              <RoyIcon name="cright" size={13} strokeWidth={2} className={showTranscript ? "rotate-90 transition-transform" : "transition-transform"} />
              Транскрипт ({segments.length})
            </button>
            {showTranscript && (
              <div className="mt-2 space-y-1">
                {segments.map((s, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs text-ink-mute shrink-0 w-16">{fmtClock(meeting.started_at, s.start)}</span>
                    <span className="flex-1 text-ink">{s.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!published && notesReady && !editing && (
        <div className="border-t border-line px-4 py-3 space-y-2.5 shrink-0 bg-background dark:bg-[var(--surface)] dark:backdrop-blur-lg">
          <Segmented
            items={[{ id: "workspace", label: "В команду" }, { id: "personal", label: "В личное" }]}
            value={base}
            onChange={(v) => setBase(v as "workspace" | "personal")}
          />
          <button onClick={handlePublish} disabled={publishing} className={btnPrimary} style={{ fontSize: 14.5 }}>
            {publishing ? "Публикуем…" : base === "workspace" ? "Сохранить в базу команды" : "Сохранить в личное"}
          </button>
        </div>
      )}
      {published && (
        <div className="border-t border-line px-4 py-3 shrink-0">
          <p className="text-xs text-center text-ink-soft">Уже в базе. Правки — через раздел «База».</p>
        </div>
      )}
    </div>
  );
}
