"use client";
import { PILL_GROUP_CLS, pillSegmentCls } from "@/components/ui/PropertyPill";
import { useState, useEffect, useCallback, useContext } from "react";
import { askMeeting, fetchAgentMeeting, fetchAgentMeetingNotes, patchAgentMeetingDraft, renameAgentMeeting, publishAgentMeeting, resummarizeAgentMeeting, deleteAgentMeeting } from "@/lib/api";
import type { AgentMeeting, MeetingLiveNote } from "@/types";
import { DetailPanelContext, NavHeader, SectionLabel } from "@/components/roy/ui";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { TezisyEditor } from "@/components/roy/tezisy/TezisyEditor";
import { TezisyReader } from "@/components/roy/tezisy/TezisyReader";
import type { AskApply } from "@/components/roy/tezisy/AskPopover";
import { applyAskAnswerToText } from "@/lib/tezisyLines";
import { useDt, useLang, useRoyNav } from "@/components/roy/nav";
import { speakerLabelAt } from "@/lib/transcriptSpeaker";
import { useConfirm } from "@/components/ui/confirm";
import { hasSeveralOwners, canDeleteDraft } from "@/lib/draftOwners";
import { recordedByOf } from "@/lib/agentMeeting";
import { TasksFromMeeting } from "@/components/roy/TasksFromMeeting";

type Props = { id: string; onClose: () => void; onChanged?: () => void };

// Вычитка встречи из рекордера. Выглядит как карточка встречи (MeetingDetail): чип источника,
// статус, заголовок, видимые действия, тезисы «Кратко от ИИ», внизу — куда сохранить. На
// десктопе открывается правой панелью (PANEL_VIEWS в RoyApp) и раскладывается вкладками
// Тезисы · Пометки · Транскрипт (решение владельца 2026-09-25: «сделай также окно что и по
// стандарту»). Транскрипт — только пока встреча не в базе.

// Все кнопки экрана — одна форма: круглые, высота 40px (решение владельца 01.10.2026: «почему у
// нас везде все круглое, а тут квадраты? … давай приводить к одному стилю везде»).
const btnOutline =
  "inline-flex min-h-[40px] items-center justify-center rounded-full border border-line bg-surface px-4 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

function fmtTs(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// Время суток сегмента = старт записи + смещение сегмента (сек). started_at в UTC →
// toLocaleTimeString переводит в локальную зону браузера. Фолбэк на MM:SS, если старта нет.
function fmtClock(startISO: string | null, sec: number, locale: string): string {
  if (!startISO) return fmtTs(sec);
  const base = Date.parse(startISO);
  if (Number.isNaN(base)) return fmtTs(sec);
  return new Date(base + Math.max(0, sec) * 1000).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Дата вычитки — тем же форматом, что в списках встреч и в очереди черновиков («12 июн.»).
// ISO-срез на этом экране был третьим форматом даты в одном разделе.
function fmtDay(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function MeetingReview({ id, onClose, onChanged }: Props) {
  const dt = useDt();
  const lang = useLang();
  const panel = useContext(DetailPanelContext);
  const { toast, me } = useRoyNav();
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const [meeting, setMeeting] = useState<AgentMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [base, setBase] = useState<"workspace" | "personal">("workspace");
  const [view, setView] = useState<"tez" | "tasks" | "notes" | "tr">("tez");
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

  // Точечный вопрос по выделенному в тезисах: ответ из режима чтения открывает правку уже со
  // вставленным ответом — сохраняет человек, как любую правку.
  const askDraft = (fragment: string, question: string) => askMeeting("draft", id, fragment, question);
  const applyFromReading = (answer: string, mode: AskApply, fragment: string) => {
    setDraft(applyAskAnswerToText(meeting?.draft_notes_md ?? "", fragment, answer, mode));
    setEditing(true);
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      // Черновик нескольких владельцев — только в общую базу (сервер иначе ответит 409).
      // Исключение — встреча 1-1: «Личное» сохранит одну запись на двоих (#641).
      const teamOnly = !!meeting && hasSeveralOwners(meeting) && !meeting.one_on_one;
      await publishAgentMeeting(id, teamOnly ? "workspace" : base);
      onChanged?.();
      onClose();
    } finally { setPublishing(false); }
  };

  // Удалить черновик с вычитки. Право — только у записавшего (как в админке встреч): у
  // совладельца черновика кнопки нет, сервер отбивает и сам.
  const handleDelete = async () => {
    if (!meeting) return;
    const ok = await confirm({
      title: dt(`Удалить черновик «${meeting.title ?? ""}»?`, `Delete the draft “${meeting.title ?? ""}”?`),
      description: dt("Расшифровка и тезисы будут удалены без возможности восстановления.", "The transcript and summary will be deleted for good."),
      confirmText: dt("Удалить", "Delete"),
      cancelText: dt("Отмена", "Cancel"),
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteAgentMeeting(id);
      toast(dt("Черновик удалён", "Draft deleted"));
      onChanged?.();
      onClose();
    } catch {
      toast(dt("Не удалось удалить", "Could not delete"));
    } finally { setDeleting(false); }
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
  // Встреча 1-1 (#641): двое владельцев, но «Личное» доступно — запись увидят только они двое.
  const oneOnOne = meeting.one_on_one ?? null;
  const teamOnly = hasSeveralOwners(meeting) && !oneOnOne;
  const recorders = meeting.recorders ?? [];
  const segments = meeting.transcript?.segments ?? [];
  const hasTranscript = segments.length > 0;
  // Пустая строка тезисов = НЕ готово (модель вернула пусто). Раньше `!== null` считал "" готовым → голый «—».
  const notesReady = !!meeting.draft_notes_md;
  const summaryTerminal = meeting.summary_status === "done" || meeting.summary_status === "failed";
  // Транскрипт — инструмент вычитки: по нему сверяют тезисы. Встреча в базе его не показывает —
  // он дублирует тезисы (решение владельца 2026-09-25).
  const showTranscript = hasTranscript && !published;
  // Задачи из черновика — как на доске вычитки (MeetAdminScreen): из тезисов, а без них из
  // транскрипта. Записи в базе ещё нет, поэтому задачи без привязки к встрече. Опубликованная
  // встреча ведёт задачи в своей карточке (MeetingDetail), здесь блок не нужен.
  const taskText = published ? "" : (meeting.draft_notes_md?.trim() || segments.map((s) => s.text).join("\n"));
  const showTasks = taskText.trim().length > 0;
  const who = meeting.recorder_names?.length ? meeting.recorder_names.join(", ") : recorders.length ? String(recorders.length) : "";

  const tezBlock = notesReady ? (
    editing ? (
      <TezisyEditor value={draft} onChange={setDraft} onSave={handleSave} busy={saving}
        onCancel={() => { setDraft(meeting.draft_notes_md ?? ""); setEditing(false); }}
        label={dt("Тезисы встречи", "Meeting summary")} ask={hasTranscript && !published ? askDraft : undefined} />
    ) : (
      <div className="mb-4 px-4 py-3.5" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 10 }}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="font-bold uppercase text-accent-ink" style={{ fontSize: 11, letterSpacing: "0.05em" }}>{dt("Кратко от ИИ", "AI summary")}</span>
          {!published && hasTranscript && (
            <button type="button" onClick={reprocess} disabled={reprocessing}
              title={dt("Пересобрать тезисы из транскрипта", "Rebuild the summary from the transcript")}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-card/60 font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
              style={{ padding: "3px 9px", fontSize: 11 }}>
              <RoyIcon name="spark" size={12} strokeWidth={1.9} /> {reprocessing ? dt("Обрабатываю…", "Processing…") : dt("Переобработать", "Reprocess")}
            </button>
          )}
        </div>
        <TezisyReader text={meeting.draft_notes_md ?? ""} copyMeta={{ title: meeting.title, date: meeting.started_at }}
          ask={hasTranscript && !published ? askDraft : undefined} onApply={applyFromReading} />
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

  // «я» в транскрипте рекордера — тот, кто записывал; имя подставляем, только если он один (#819).
  const meName = meeting.recorder_names?.length === 1 ? meeting.recorder_names[0] : null;
  const transcriptBlock = showTranscript && (
    <div className="mb-4">
      {!panel && <SectionLabel>{dt("Транскрипт", "Transcript")}</SectionLabel>}
      <div className="space-y-1">
        {segments.map((sg, i) => {
          const speaker = speakerLabelAt(segments, i, { meName: meName, lang });
          return (
            <div key={i}>
              {speaker && <div className={`text-xs font-medium text-ink-soft ${i > 0 ? "mt-2" : ""}`}>{speaker}</div>}
              <div className="flex gap-2 text-sm">
                <span className="w-16 shrink-0 font-mono text-xs text-ink-mute">{fmtClock(meeting.started_at, sg.start, dt("ru-RU", "en-GB"))}</span>
                <span className="flex-1 text-ink">{sg.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const tasksBlock = showTasks ? (
    <div className="mb-4">
      <TasksFromMeeting text={taskText} resetKey={meeting.id} onAdded={onChanged} />
    </div>
  ) : null;

  const tabs = ([
    ["tez", "Тезисы", "Summary", null],
    ...(showTasks ? [["tasks", "Задачи", "Tasks", null] as const] : []),
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
            <RoyIcon name="meet" size={12} strokeWidth={1.9} /> {recordedByOf(meeting) ?? "bumblebee"}
          </span>
          {published
            ? <span className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 12, color: "var(--status-done)" }}><RoyIcon name="check" size={12} strokeWidth={2.2} /> {dt("В базе", "In the base")}</span>
            : <span className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 12, color: "var(--status-open)" }}><RoyIcon name="clock" size={12} strokeWidth={1.9} /> {dt("На вычитке", "In review")}</span>}
          {meeting.started_at && <span className="text-ink-mute" style={{ fontSize: 12 }}>{fmtDay(meeting.started_at, dt("ru-RU", "en-GB"))}</span>}
          {who && <span className="truncate text-ink-mute" style={{ fontSize: 12 }}>· {dt("записали", "recorded by")}: {who}</span>}
        </div>

        {editingTitle ? (
          <div className="mb-4">
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} autoFocus data-panel-edit
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
              placeholder={dt("Название встречи", "Meeting title")}
              className="w-full rounded-full border border-line-2 bg-surface px-4 py-2.5 font-bold text-ink outline-none focus:border-primary"
              style={{ fontSize: 20, letterSpacing: "-0.01em" }} />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={saveTitle} disabled={savingTitle} className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 font-semibold text-primary-foreground transition-transform active:scale-[0.96] disabled:opacity-60" style={{ fontSize: 14 }} aria-busy={savingTitle}>
                {savingTitle && <Spinner />}
                {savingTitle ? dt("Сохраняю…", "Saving…") : dt("Сохранить", "Save")}
              </button>
              <button type="button" onClick={() => setEditingTitle(false)} className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-line-2 px-4 font-semibold text-ink-soft transition-transform active:scale-[0.96]" style={{ fontSize: 14 }}>{dt("Отмена", "Cancel")}</button>
            </div>
          </div>
        ) : (
          <h1 className="mb-3 font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {meeting.title ?? dt("Встреча", "Meeting")}
          </h1>
        )}

        {!published && !editing && !editingTitle && (
          // Публикация и правка — одним рядом над текстом (решение владельца 2026-09-30). Размеры —
          // норма витрины (30px на десктопе, 40px тач-цель на телефоне), вид — как охват задач (LensToggle), ничего не меняет ширину при
          // переключении «Команда/Личное», а подсказка о видимости — своей строкой под рядом.
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {notesReady && (
                <>
                  {teamOnly ? (
                    // Не кнопка: выбора нет — это факт о встрече, поэтому без рамки и мелким текстом.
                    <span className="inline-flex items-center gap-1.5 text-ink-soft" style={{ fontSize: 12.5 }}
                      title={dt("На встрече были другие участники SWARM, поэтому она уходит в базу команды.", "Other SWARM members attended, so it goes to the team base.")}>
                      <RoyIcon name="team" size={14} strokeWidth={1.9} />
                      {dt("Общая · в команду", "Shared · team")}
                    </span>
                  ) : (
                    <BasePill value={base} onChange={setBase} />
                  )}
                  <button type="button" onClick={handlePublish} disabled={publishing} aria-busy={publishing}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap h-10 rounded-full border border-transparent bg-primary px-3.5 lg:h-[30px] font-semibold text-primary-foreground transition-transform active:scale-[0.96] disabled:opacity-60"
                    style={{ fontSize: 12.5 }}>
                    {publishing ? <Spinner /> : <RoyIcon name="check" size={14} strokeWidth={2.2} />}
                    {publishing ? dt("Сохраняю…", "Saving…") : dt("Сохранить", "Save")}
                  </button>
                </>
              )}
              {canRename && <Chip icon="pencil" label={dt("Название", "Title")} onClick={() => { setTitleDraft(meeting.title ?? ""); setEditingTitle(true); }} />}
              {notesReady && <Chip icon="pencil" label={dt("Тезисы", "Summary")} onClick={() => { setEditing(true); setView("tez"); }} />}
              {canDeleteDraft(meeting, me?.telegram_id) && !deleting && (
                <button type="button" onClick={handleDelete} aria-label={dt("Удалить черновик", "Delete draft")} title={dt("Удалить черновик", "Delete draft")}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors lg:h-[30px] lg:w-[30px] hover:bg-surface-2 active:scale-[0.94]"
                  style={{ color: "var(--pri-high)" }}>
                  <RoyIcon name="trash" size={16} strokeWidth={1.9} />
                </button>
              )}
            </div>
            {notesReady && !teamOnly && (
              <p className="mt-1.5 text-ink-mute" style={{ fontSize: 12 }}>
                {base === "workspace"
                  ? dt("Увидит вся команда", "The whole team will see it")
                  : oneOnOne?.partner_name
                    ? dt(`Видно только вам и ${oneOnOne.partner_name}`, `Visible only to you and ${oneOnOne.partner_name}`)
                    : oneOnOne
                      ? dt("Видно только вам и второму участнику", "Visible only to you and the other participant")
                      : dt("Видно только вам", "Visible only to you")}
              </p>
            )}
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
            {tab === "tasks" && tasksBlock}
            {tab === "notes" && notesBlock}
            {tab === "tr" && transcriptBlock}
          </>
        ) : (
          <>
            {tasksBlock}
            {tezBlock}
            {notesBlock}
            {transcriptBlock}
          </>
        )}
      </div>

      {published && (
        <div className="shrink-0 border-t border-line px-5 py-3">
          <p className="text-center text-xs text-ink-soft">{dt("Уже в базе. Правки — через раздел «База».", "Already in the base. Edit it in the Base section.")}</p>
        </div>
      )}
    </div>
  );
}

// Куда сохранить черновик: пилюля из двух половин. Segmented из ui.tsx — прямоугольный и на всю
// ширину, а здесь переключатель стоит в ряду с кнопками и должен быть компактным.
function BasePill({ value, onChange }: { value: "workspace" | "personal"; onChange: (v: "workspace" | "personal") => void }) {
  const dt = useDt();
  const items = [
    { id: "workspace", label: dt("Команда", "Team") },
    { id: "personal", label: dt("Личное", "Personal") },
  ] as const;
  return (
    <div role="radiogroup" aria-label={dt("Куда сохранить", "Save to")} className={PILL_GROUP_CLS}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button key={it.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(it.id)}
            // Мягкий сегмент, как статус в карточке задачи (владелец 05.10.2026).
            className={`${pillSegmentCls(on)} px-3.5`}
            style={{ fontSize: 13, minHeight: 36 }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// Кнопка-чип верхнего ряда — та же форма, что «Сохранить»: круглая, 40px.
function Chip({ icon, label, onClick }: { icon: RoyIconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap h-10 rounded-full border border-line bg-surface-2 px-3 lg:h-[30px] font-semibold transition-colors hover:bg-surface active:scale-[0.96]"
      style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>
      <RoyIcon name={icon} size={14} strokeWidth={1.9} />
      {label}
    </button>
  );
}

function Spinner() {
  return <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
