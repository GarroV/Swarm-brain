"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchAgentMeeting, patchAgentMeetingDraft, renameAgentMeeting, publishAgentMeeting } from "@/lib/api";
import type { AgentMeeting } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { TezisyBlocks } from "@/components/roy/ui";
import { ChevronLeft, ChevronDown, ChevronRight, Clock, CheckCircle, Pencil, Check, X } from "lucide-react";

type Props = { id: string; onClose: () => void; onChanged?: () => void };

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
    <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-border shrink-0">
      <button onClick={onClose} aria-label="Назад" className="text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-5 h-5" />
      </button>
      {editingTitle ? (
        <div className="flex flex-1 items-center gap-1.5">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
            autoFocus
            placeholder="Название встречи"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-base font-semibold outline-none focus:border-primary"
          />
          <button onClick={saveTitle} disabled={savingTitle} aria-label="Сохранить название" className="text-primary disabled:opacity-50"><Check className="w-5 h-5" /></button>
          <button onClick={() => setEditingTitle(false)} aria-label="Отмена" className="text-muted-foreground"><X className="w-5 h-5" /></button>
        </div>
      ) : (
        <>
          <h1 className="text-base font-semibold flex-1 truncate">{meeting?.title ?? "Встреча"}</h1>
          {canRename && (
            <button onClick={() => { setTitleDraft(meeting!.title ?? ""); setEditingTitle(true); }} aria-label="Переименовать" className="text-muted-foreground hover:text-foreground">
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </>
      )}
    </div>
  );

  if (loading) {
    return <div className="flex flex-col h-full">{header}<p className="text-center text-muted-foreground py-8 text-sm">Загрузка…</p></div>;
  }
  if (error || !meeting) {
    return <div className="flex flex-col h-full">{header}<p className="text-center text-destructive py-8 text-sm">{error ?? "Не найдено"}</p></div>;
  }

  const published = meeting.status === "in_base";
  const recorders = meeting.recorders ?? [];
  const segments = meeting.transcript?.segments ?? [];
  const notesReady = meeting.draft_notes_md !== null;

  return (
    <div className="flex flex-col h-full">
      {header}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">desktop-agent</Badge>
          {meeting.started_at && <span>{meeting.started_at.slice(0, 10)}</span>}
          {published
            ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle className="w-3.5 h-3.5" /> В базе</span>
            : <span className="inline-flex items-center gap-1 text-amber-600"><Clock className="w-3.5 h-3.5" /> На вычитке</span>}
          {recorders.length > 0 && <span>· записали: {recorders.length}</span>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground">Тезисы</p>
            {!published && notesReady && !editing && (
              <button onClick={() => setEditing(true)} className="text-xs text-primary">Редактировать</button>
            )}
          </div>
          {!notesReady ? (
            <p className="text-sm text-muted-foreground">Готовим тезисы…</p>
          ) : editing ? (
            <div className="space-y-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[220px] text-sm" />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">{saving ? "…" : "Сохранить"}</Button>
                <Button size="sm" variant="outline" onClick={() => { setDraft(meeting.draft_notes_md ?? ""); setEditing(false); }}>Отмена</Button>
              </div>
            </div>
          ) : meeting.draft_notes_md ? (
            <TezisyBlocks text={meeting.draft_notes_md} />
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>

        {segments.length > 0 && (
          <div>
            <button onClick={() => setShowTranscript((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground">
              {showTranscript ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Транскрипт ({segments.length})
            </button>
            {showTranscript && (
              <div className="mt-2 space-y-1">
                {segments.map((s, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground shrink-0 w-16">{fmtClock(meeting.started_at, s.start)}</span>
                    <span className="flex-1">{s.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!published && notesReady && !editing && (
        <div className="border-t border-border px-4 py-3 space-y-2 shrink-0">
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setBase("workspace")}
              className={`flex-1 py-1.5 rounded-md border transition-colors ${base === "workspace" ? "border-primary text-primary font-medium" : "border-border text-muted-foreground"}`}
            >
              В команду
            </button>
            <button
              onClick={() => setBase("personal")}
              className={`flex-1 py-1.5 rounded-md border transition-colors ${base === "personal" ? "border-primary text-primary font-medium" : "border-border text-muted-foreground"}`}
            >
              В личное
            </button>
          </div>
          <Button onClick={handlePublish} disabled={publishing} className="w-full">
            {publishing ? "Публикуем…" : base === "workspace" ? "Сохранить в базу команды" : "Сохранить в личное"}
          </Button>
        </div>
      )}
      {published && (
        <div className="border-t border-border px-4 py-3 shrink-0">
          <p className="text-xs text-center text-muted-foreground">Уже в базе. Правки — через раздел «База».</p>
        </div>
      )}
    </div>
  );
}
