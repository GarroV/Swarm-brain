"use client";
import { useState, useEffect, useCallback, useContext } from "react";
import { fetchAgentMeeting, fetchAgentMeetingNotes, patchAgentMeetingDraft, renameAgentMeeting, publishAgentMeeting, resummarizeAgentMeeting } from "@/lib/api";
import type { AgentMeeting, MeetingLiveNote } from "@/types";
import { DetailPanelContext, NavHeader, SectionLabel, TezisyBlocks, Segmented } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";
import { ActionChip } from "@/components/roy/screens/MeetingDetail";
import { PanelEditor } from "@/components/roy/PanelEditor";
import { useDt } from "@/components/roy/nav";
import { hasSeveralOwners } from "@/lib/draftOwners";

type Props = { id: string; onClose: () => void; onChanged?: () => void };

// Вычитка встречи из рекордера. Выглядит как карточка встречи (MeetingDetail): чип источника,
// статус, заголовок, видимые действия, тезисы «Кратко от ИИ», внизу — куда сохранить. На
// десктопе открывается правой панелью (PANEL_VIEWS в RoyApp) и раскладывается вкладками
// Тезисы · Пометки · Транскрипт (решение владельца 2026-09-25: «сделай также окно что и по
// стандарту»). Транскрипт — только пока встреча не в базе.

const btnOutline =
  "rounded-[8px] border border-line bg-surface px-4 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

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

// Дата вычитки — тем же форматом, что в списках встреч и в очереди черновиков («12 июн.»).
// ISO-срез на этом экране был третьим форматом даты в одном разделе.
function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function MeetingReview({ id, onClose, onChanged }: Props) {
  const dt = useDt();
  const panel = useContext(DetailPanelContext);
  const [meeting, setMeeting] = useState<AgentMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [base, setBase] = useState<"workspace" | "personal">("workspace");
  const [view, setView] = useState<"tez" | "notes" | "tr">("tez");
  const [liveNotes, setLiveNotes] = useState<MeetingLiveNote[]>([]);
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

  // Живые пометки «на полях» из виджета рекордера — отдельным запросом (в GET /:id не входят).
  useEffect(() => {
    let alive = true;
    fetchAgentMeetingNotes(id)
      .then((notes) => { if (alive) setLiveNotes(notes); })
      .catch(() => { /* пометки не критичны — при ошибке секцию не показываем */ });
    return () => { alive = false; };
  }, [id]);

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
      // Черновик нескольких владельцев — только в общую базу (сервер иначе ответит 409).
      await publishAgentMeeting(id, meeting && hasSeveralOwners(meeting) ? "workspace" : base);
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
  const header = <NavHeader onBack={onClose} title={dt("Вычитка", "Review")} />;

  if (loading) {
    return (
      <div className="flex h-full flex-col">{header}
        <div className="space-y-2 px-5 pt-2">{[28, 22, 160].map((h, i) => <div key={i} className="roy-shim" style={{ height: h, borderRadius: 8 }} />)}</div>
      </div>
    );
  }
  if (error || !meeting) {
    return <div className="flex h-full flex-col">{header}<p className="py-8 text-center text-sm" style={{ color: "var(--pri-high)" }}>{error ?? dt("Не найдено", "Not found")}</p></div>;
  }

  const published = meeting.status === "in_base";
  const sharedOwners = hasSeveralOwners(meeting);
  const effectiveBase = sharedOwners ? "workspace" : base;
  const recorders = meeting.recorders ?? [];
  const segments = meeting.transcript?.segments ?? [];
  const hasTranscript = segments.length > 0;
  // Пустая строка тезисов = НЕ готово (модель вернула пусто). Раньше `!== null` считал "" готовым → голый «—».
  const notesReady = !!meeting.draft_notes_md;
  const summaryTerminal = meeting.summary_status === "done" || meeting.summary_status === "failed";
  // Транскрипт — инструмент вычитки: по нему сверяют тезисы. Встреча в базе его не показывает —
  // он дублирует тезисы (решение владельца 2026-09-25).
  const showTranscript = hasTranscript && !published;
  const who = meeting.recorder_names?.length ? meeting.recorder_names.join(", ") : recorders.length ? String(recorders.length) : "";

  const tezBlock = notesReady ? (
    editing ? (
      <PanelEditor value={draft} onChange={setDraft} onSave={handleSave} busy={saving}
        onCancel={() => { setDraft(meeting.draft_notes_md ?? ""); setEditing(false); }}
        label={dt("Тезисы встречи", "Meeting summary")} />
    ) : (
      <div className="mb-4 px-4 py-3.5" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 10 }}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="font-bold uppercase text-accent-ink" style={{ fontSize: 11, letterSpacing: "0.05em" }}>{dt("Кратко от ИИ", "AI summary")}</span>
          {!published && hasTranscript && (
            <button type="button" onClick={reprocess} disabled={reprocessing}
              title={dt("Пересобрать тезисы из транскрипта", "Rebuild the summary from the transcript")}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-accent-line bg-card/60 font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
              style={{ padding: "3px 9px", fontSize: 11 }}>
              <RoyIcon name="spark" size={12} strokeWidth={1.9} /> {reprocessing ? dt("Обрабатываю…", "Processing…") : dt("Переобработать", "Reprocess")}
            </button>
          )}
        </div>
        <TezisyBlocks text={meeting.draft_notes_md ?? ""} copyMeta={{ title: meeting.title, date: meeting.started_at }} />
      </div>
    )
  ) : summaryTerminal ? (
    // Обработка завершена, но тезисов нет (пусто/сбой) — даём «Переобработать» из транскрипта,
    // а не молчаливый «—» без выхода.
    <div className="mb-4 space-y-2">
      <p className="text-sm text-ink-soft">
        {meeting.summary_status === "failed"
          ? dt("⚠️ Не удалось обработать запись. Переобработай из транскрипта или переснимай.", "⚠️ The recording failed to process. Reprocess it from the transcript or record again.")
          : dt("Тезисы не сформированы — модель не нашла содержательных пунктов. Можно переобработать из транскрипта.", "No summary — the model found nothing substantial. You can reprocess it from the transcript.")}
      </p>
      {hasTranscript && (
        <button onClick={reprocess} disabled={reprocessing} className={btnOutline} style={{ fontSize: 14 }}>
          <span className="inline-flex items-center gap-1.5"><RoyIcon name="spark" size={13} strokeWidth={1.9} /> {reprocessing ? dt("Обрабатываю…", "Processing…") : dt("Переобработать", "Reprocess")}</span>
        </button>
      )}
    </div>
  ) : (
    <p className="mb-4 text-sm text-ink-soft">{dt("Готовим тезисы…", "Preparing the summary…")}</p>
  );

  const notesBlock = liveNotes.length > 0 && (
    <div className="mb-4">
      {!panel && <SectionLabel>{dt("Пометки на полях", "Margin notes")}</SectionLabel>}
      <div className="space-y-1.5">
        {liveNotes.map((n) => (
          <div key={n.id} className="flex gap-2.5 text-sm">
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-mute">{fmtTs(n.offset_sec)}</span>
            <span className="flex-1 whitespace-pre-wrap text-ink">{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const transcriptBlock = showTranscript && (
    <div className="mb-4">
      {!panel && <SectionLabel>{dt("Транскрипт", "Transcript")}</SectionLabel>}
      <div className="space-y-1">
        {segments.map((sg, i) => (
          <div key={i} className="flex gap-2 text-sm">
            <span className="w-16 shrink-0 font-mono text-xs text-ink-mute">{fmtClock(meeting.started_at, sg.start)}</span>
            <span className="flex-1 text-ink">{sg.text}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const tabs = ([
    ["tez", "Тезисы", "Summary", null],
    ...(liveNotes.length ? [["notes", "Пометки", "Notes", liveNotes.length] as const] : []),
    ...(showTranscript ? [["tr", "Транскрипт", "Transcript", segments.length] as const] : []),
  ] as const);
  const tab = tabs.some(([id]) => id === view) ? view : "tez";

  return (
    <div className="roy-pop flex h-full flex-col">
      {header}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 font-semibold" style={{ fontSize: 12, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 8, padding: "3px 9px" }}>
            <RoyIcon name="meet" size={12} strokeWidth={1.9} /> bumblebee
          </span>
          {published
            ? <span className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 12, color: "var(--status-done)" }}><RoyIcon name="check" size={12} strokeWidth={2.2} /> {dt("В базе", "In the base")}</span>
            : <span className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 12, color: "var(--status-open)" }}><RoyIcon name="clock" size={12} strokeWidth={1.9} /> {dt("На вычитке", "In review")}</span>}
          {meeting.started_at && <span className="text-ink-mute" style={{ fontSize: 12 }}>{fmtDay(meeting.started_at)}</span>}
          {who && <span className="truncate text-ink-mute" style={{ fontSize: 12 }}>· {dt("записали", "recorded by")}: {who}</span>}
        </div>

        {editingTitle ? (
          <div className="mb-4">
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} autoFocus data-panel-edit
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
              placeholder={dt("Название встречи", "Meeting title")}
              className="w-full rounded-[8px] border border-line-2 bg-surface px-3.5 py-2.5 font-bold text-ink outline-none focus:border-primary"
              style={{ fontSize: 20, letterSpacing: "-0.01em" }} />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={saveTitle} disabled={savingTitle} className="flex-1 rounded-[8px] bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-60" style={{ fontSize: 14 }}>{dt("Сохранить", "Save")}</button>
              <button type="button" onClick={() => setEditingTitle(false)} className="rounded-[8px] border border-line-2 px-4 py-2.5 font-semibold text-ink-soft" style={{ fontSize: 14 }}>{dt("Отмена", "Cancel")}</button>
            </div>
          </div>
        ) : (
          <h1 className="mb-3 font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {meeting.title ?? dt("Встреча", "Meeting")}
          </h1>
        )}

        {!published && !editing && !editingTitle && (
          <div className="mb-4 flex flex-wrap gap-2">
            {canRename && <ActionChip icon="pencil" label={dt("Название", "Title")} onClick={() => { setTitleDraft(meeting.title ?? ""); setEditingTitle(true); }} />}
            {notesReady && <ActionChip icon="pencil" label={dt("Тезисы", "Summary")} onClick={() => { setEditing(true); setView("tez"); }} />}
          </div>
        )}

        {panel ? (
          <>
            {/* В панели — вкладками, как карточка встречи (MeetingDetail); на мобайле — лентой. */}
            {tabs.length > 1 && (
              <div role="tablist" className="mb-3 flex items-end gap-4 border-b border-line">
                {tabs.map(([id, ru, en, n]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setView(id)}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 font-medium transition-colors ${tab === id ? "border-primary font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
                    style={{ fontSize: 13 }}>
                    {dt(ru, en)}
                    {n != null && <span className="text-ink-mute" style={{ fontSize: 11 }}>{n}</span>}
                  </button>
                ))}
              </div>
            )}
            {tab === "tez" && tezBlock}
            {tab === "notes" && notesBlock}
            {tab === "tr" && transcriptBlock}
          </>
        ) : (
          <>
            {tezBlock}
            {notesBlock}
            {transcriptBlock}
          </>
        )}
      </div>

      {!published && notesReady && !editing && !editingTitle && (
        <div className="shrink-0 border-t border-line bg-background px-5 pt-3 dark:bg-[var(--surface)]" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          {sharedOwners ? (
            <p className="mb-2.5 text-xs text-ink-soft">
              {dt("Встреча общая: на ней были другие участники SWARM, поэтому она уходит в базу команды.", "A shared meeting: other SWARM members attended, so it goes to the team base.")}
            </p>
          ) : (
            <div className="mb-2.5">
              <Segmented
                items={[{ id: "workspace", label: dt("В команду", "Team") }, { id: "personal", label: dt("В личное", "Personal") }]}
                value={base}
                onChange={(v) => setBase(v as "workspace" | "personal")}
              />
            </div>
          )}
          <button onClick={handlePublish} disabled={publishing} className="w-full rounded-[8px] bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60" style={{ fontSize: 15 }}>
            {publishing ? dt("Публикуем…", "Publishing…") : effectiveBase === "workspace" ? dt("Сохранить в базу команды", "Save to the team base") : dt("Сохранить в личное", "Save to personal")}
          </button>
        </div>
      )}
      {published && (
        <div className="shrink-0 border-t border-line px-5 py-3">
          <p className="text-center text-xs text-ink-soft">{dt("Уже в базе. Правки — через раздел «База».", "Already in the base. Edit it in the Base section.")}</p>
        </div>
      )}
    </div>
  );
}
