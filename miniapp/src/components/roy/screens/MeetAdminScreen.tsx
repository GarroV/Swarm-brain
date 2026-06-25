"use client";
import { useCallback, useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, RoyCard, SectionLabel, Avatar, Segmented } from "../ui";
import { RoyIcon } from "../icons";
import { deriveEntryTitle } from "../entry";
import {
  fetchMeetings,
  fetchAgentMeetings,
  fetchAgentMeeting,
  patchMeeting,
  deleteMeeting,
  deleteAgentMeeting,
  publishAgentMeeting,
  extractTasksPreview,
  createTask,
} from "@/lib/api";
import type { ProposedTask } from "@/lib/api";
import type { Entry, AgentMeeting } from "@/types";
import { sourceLabel } from "./RoyMeetingsScreen";

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
}: {
  item: MeetItem;
  active: boolean;
  onClick: () => void;
}) {
  const isAgent = item.kind === "agent";
  const title = itemTitle(item);
  const date = fmtDate(itemDate(item));
  const src = itemSource(item);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left"
    >
      <RoyCard
        className="px-3.5 py-3 transition-colors"
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
              {item.kind === "entry" && item.data.added_by && (
                <span className="text-ink-mute" style={{ fontSize: 11 }}>· {item.data.added_by}</span>
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

// ── Область «Задачи из встречи» (entry) ───────────────────────────────────────

type DraftTask = ProposedTask & { _key: string };
type TaskTarget = "personal" | "shared";

function TasksFromMeeting({ entry }: { entry: Entry }) {
  const { toast } = useRoyNav();
  const [tasks, setTasks] = useState<DraftTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);

  // Смена выбранной записи сбрасывает локальный список предложенных задач.
  useEffect(() => {
    setTasks(null);
    setLoading(false);
    setAddingKey(null);
  }, [entry.id]);

  const extract = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const proposed = await extractTasksPreview(entry.content);
      setTasks(proposed.map((p, i) => ({ ...p, _key: `${Date.now()}-${i}` })));
    } catch {
      toast("Не удалось вычленить задачи");
    } finally {
      setLoading(false);
    }
  };

  const setTitle = (key: string, title: string) => {
    setTasks((prev) => prev?.map((t) => (t._key === key ? { ...t, title } : t)) ?? null);
  };

  const removeRow = (key: string) => {
    setTasks((prev) => prev?.filter((t) => t._key !== key) ?? null);
  };

  const addTask = async (task: DraftTask, target: TaskTarget) => {
    if (addingKey) return;
    const title = task.title.trim();
    if (!title) return;
    setAddingKey(task._key);
    try {
      await createTask({
        title,
        description: task.description ?? null,
        country: task.country ?? null,
        due_date: task.due_date ?? null,
        is_private: target === "personal",
      });
      removeRow(task._key);
      toast("Задача добавлена");
    } catch {
      toast("Не удалось добавить задачу");
    } finally {
      setAddingKey(null);
    }
  };

  const hasContent = Boolean(entry.content?.trim());

  return (
    <div>
      <div className="flex items-center justify-between" style={{ margin: "0 4px 9px" }}>
        <span className="font-bold uppercase text-ink-mute" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
          Задачи из встречи
        </span>
        <button
          type="button"
          disabled={loading || !hasContent}
          onClick={extract}
          className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-surface font-semibold text-ink-soft transition-opacity disabled:opacity-50"
          style={{ padding: "6px 12px", fontSize: 12 }}
        >
          <RoyIcon name="spark" size={13} strokeWidth={1.9} />
          {loading ? "Извлекаем…" : "Вычленить задачи"}
        </button>
      </div>

      {!hasContent && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>Нет содержания для извлечения.</p>
      )}

      {hasContent && tasks !== null && tasks.length === 0 && !loading && (
        <p className="text-ink-mute" style={{ fontSize: 12.5 }}>Задач не найдено.</p>
      )}

      {tasks && tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => {
            const busy = addingKey === t._key;
            return (
              <RoyCard key={t._key} className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <input
                    value={t.title}
                    onChange={(e) => setTitle(t._key, e.target.value)}
                    disabled={busy}
                    className="min-w-0 flex-1 rounded-[9px] border border-line bg-surface text-ink font-medium outline-none focus:border-[var(--accent-ink)] disabled:opacity-50"
                    style={{ fontSize: 13, padding: "6px 9px" }}
                  />
                  <button
                    type="button"
                    aria-label="Удалить предложенную задачу"
                    disabled={busy}
                    onClick={() => removeRow(t._key)}
                    className="inline-flex shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface text-ink-mute transition-opacity disabled:opacity-50"
                    style={{ width: 30, height: 30 }}
                  >
                    <RoyIcon name="x" size={14} strokeWidth={1.9} />
                  </button>
                </div>
                {(t.country || t.due_date) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-0.5">
                    {t.country && (
                      <span
                        className="inline-flex items-center font-semibold text-ink-soft bg-surface-2 border border-line-2"
                        style={{ fontSize: 10.5, borderRadius: 6, padding: "1px 6px" }}
                      >
                        {t.country}
                      </span>
                    )}
                    {t.due_date && (
                      <span className="text-ink-mute" style={{ fontSize: 11 }}>
                        до {fmtDate(t.due_date) ?? t.due_date}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addTask(t, "personal")}
                    className="flex-1 rounded-[10px] border border-line bg-surface font-semibold text-ink transition-opacity disabled:opacity-50"
                    style={{ padding: "6px 10px", fontSize: 12.5 }}
                  >
                    Себе
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addTask(t, "shared")}
                    className="flex-1 rounded-[10px] border-0 font-semibold transition-opacity disabled:opacity-50"
                    style={{ padding: "7px 10px", fontSize: 12.5, background: "var(--accent-ink)", color: "var(--card)" }}
                  >
                    В общие
                  </button>
                </div>
              </RoyCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Панель деталей (центр) ────────────────────────────────────────────────────

function DetailPanel({
  item,
  onEntryUpdated,
}: {
  item: MeetItem;
  onEntryUpdated: (updated: Entry) => void;
}) {
  const title = itemTitle(item);
  const date = fmtDate(itemDate(item));
  const src = itemSource(item);

  if (item.kind === "entry") {
    const e = item.data;
    return (
      <div className="flex flex-col gap-4 min-h-0 overflow-y-auto px-5 py-4">
        <div>
          <h2 className="font-bold text-ink leading-tight" style={{ fontSize: 22, letterSpacing: "-0.015em" }}>
            {title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center font-semibold"
              style={{ fontSize: 11, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 7, padding: "2px 8px" }}
            >
              {src}
            </span>
            {date && <span className="text-ink-mute" style={{ fontSize: 12 }}>{date}</span>}
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
            <p className="text-ink leading-relaxed" style={{ fontSize: 14 }}>{e.summary}</p>
          </div>
        )}

        <ContentEditor entry={e} onSaved={onEntryUpdated} />

        <TasksFromMeeting entry={e} />
      </div>
    );
  }

  // AgentMeeting — вынесено в отдельный компонент: там живёт поллинг тезисов.
  return <AgentMeetingDetail meeting={item.data} title={title} date={date} src={src} />;
}

// ── Деталь черновика агента (с поллингом тезисов) ─────────────────────────────

const AGENT_POLL_MS = 10_000;

function AgentMeetingDetail({
  meeting,
  title,
  date,
  src,
}: {
  meeting: AgentMeeting;
  title: string;
  date: string | null;
  src: string;
}) {
  // Локальная копия: поллинг подменяет её свежими данными по мере готовности тезисов.
  const [m, setM] = useState<AgentMeeting>(meeting);

  // Смена выбранной встречи — сразу показать её, а не устаревшую.
  useEffect(() => {
    setM(meeting);
  }, [meeting]);

  // Поллинг, пока тезисы готовятся (нет draft_notes_md) и обработка не упала.
  useEffect(() => {
    if (m.draft_notes_md || m.summary_status === "failed") return;
    const id = setInterval(() => {
      fetchAgentMeeting(m.id)
        .then(setM)
        .catch(() => {
          /* сохраняем текущее при ошибке поллинга */
        });
    }, AGENT_POLL_MS);
    return () => clearInterval(id);
  }, [m.id, m.draft_notes_md, m.summary_status]);

  return (
    <div className="flex flex-col gap-4 min-h-0 overflow-y-auto px-5 py-4">
      <div>
        <h2 className="font-bold text-ink leading-tight" style={{ fontSize: 22, letterSpacing: "-0.015em" }}>
          {title}
        </h2>
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
          {m.recorders && m.recorders.length > 0 && (
            <span className="text-ink-mute" style={{ fontSize: 12 }}>
              {m.recorders.length} записи
            </span>
          )}
        </div>
      </div>

      {m.draft_notes_md ? (
        <div>
          <SectionLabel>Тезисы</SectionLabel>
          <p className="text-ink leading-relaxed whitespace-pre-wrap" style={{ fontSize: 14 }}>
            {m.draft_notes_md.slice(0, 1000)}{m.draft_notes_md.length > 1000 ? "…" : ""}
          </p>
        </div>
      ) : m.summary_status === "failed" ? (
        <p className="text-ink-soft" style={{ fontSize: 13 }}>
          ⚠️ Не удалось обработать запись — попробуй записать заново.
        </p>
      ) : (
        <p className="text-ink-mute" style={{ fontSize: 13 }}>Тезисы готовятся…</p>
      )}
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
        className="flex w-full items-center justify-center gap-2 rounded-[13px] border-0 font-semibold transition-opacity disabled:opacity-50"
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
        className="flex w-full items-center justify-center gap-2 rounded-[13px] border border-line bg-surface font-semibold transition-opacity disabled:opacity-50"
        style={{
          padding: "9px 14px",
          fontSize: 14,
          color: "var(--pri-high)",
        }}
      >
        <RoyIcon name="trash" size={15} strokeWidth={1.9} />
        {rejectLabel}
      </button>

      {/* Реклассификация в заметки — только для entry */}
      {!isAgent && (
        <button
          type="button"
          disabled={reclassState !== "idle"}
          onClick={handleReclassify}
          className="flex w-full items-center justify-center gap-1.5 bg-transparent border-0 font-semibold text-ink-mute transition-opacity disabled:opacity-50 hover:opacity-70"
          style={{ padding: "4px 8px", fontSize: 12.5 }}
        >
          <RoyIcon name="note" size={14} strokeWidth={1.9} />
          {reclassLabel}
        </button>
      )}

      {isAgent && (
        <p className="text-ink-mute leading-snug" style={{ fontSize: 11 }}>
          «Опубликовать» — сохранит тезисы в базу команды или в личное хранилище. Для полного редактирования — откройте встречу на вкладке «Встречи».
        </p>
      )}
    </div>
  );
}

// ── Главный экран ─────────────────────────────────────────────────────────────

export function MeetAdminScreen() {
  const { pop, toast } = useRoyNav();

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [agentMeetings, setAgentMeetings] = useState<AgentMeeting[] | null>(null);
  const [selected, setSelected] = useState<MeetItem | null>(null);

  const load = useCallback(async () => {
    const [ents, agents] = await Promise.allSettled([
      fetchMeetings({ confirmed: false }),
      fetchAgentMeetings("awaiting_review"),
    ]);
    setEntries(ents.status === "fulfilled" ? ents.value : []);
    setAgentMeetings(agents.status === "fulfilled" ? agents.value : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Объединяем: черновики агента первыми (аппрув-нужные), потом неподтверждённые встречи
  const items: MeetItem[] = [
    ...(agentMeetings ?? []).map((m): MeetItem => ({ kind: "agent", data: m })),
    ...(entries ?? []).map((e): MeetItem => ({ kind: "entry", data: e })),
  ];

  const pendingCount = items.length;
  const agentCount = agentMeetings?.length ?? 0;

  const removeFromList = (id: string) => {
    setEntries((prev) => prev?.filter((e) => e.id !== id) ?? null);
    setAgentMeetings((prev) => prev?.filter((m) => m.id !== id) ?? null);
    setSelected((prev) => (prev && prev.data.id === id ? null : prev));
  };

  // Иммутабельно заменяет запись в списке встреч и в выбранной (если совпадает id).
  const onEntryUpdated = (updated: Entry) => {
    setEntries((prev) => prev?.map((e) => (e.id === updated.id ? updated : e)) ?? null);
    setSelected((prev) =>
      prev && prev.kind === "entry" && prev.data.id === updated.id
        ? { kind: "entry", data: updated }
        : prev,
    );
  };

  const handleConfirm = async (item: MeetItem, storage: Storage) => {
    if (item.kind === "entry") {
      // Подтверждение встречи + выбор хранилища (личное/общее)
      await patchMeeting(item.data.id, { confirmed: true, is_private: storage === "personal" });
      removeFromList(item.data.id);
      toast(storage === "personal" ? "Согласовано в личное" : "Встреча согласована");
    } else {
      // Публикация черновика агента в выбранную базу
      await publishAgentMeeting(item.data.id, storage === "personal" ? "personal" : "workspace");
      removeFromList(item.data.id);
      toast(storage === "personal" ? "Опубликовано в личное" : "Черновик опубликован");
    }
  };

  const handleReject = async (item: MeetItem) => {
    if (item.kind === "entry") {
      if (typeof window !== "undefined" && !window.confirm(`Удалить встречу «${itemTitle(item)}»? Это удалит и расшифровку.`)) return;
      await deleteMeeting(item.data.id);
      removeFromList(item.data.id);
      toast("Встреча удалена");
    } else {
      if (typeof window !== "undefined" && !window.confirm(`Удалить черновик «${itemTitle(item)}»? Это удалит расшифровку и тезисы.`)) return;
      await deleteAgentMeeting(item.data.id);
      removeFromList(item.data.id);
      toast("Черновик удалён");
    }
  };

  // Реклассификация встречи в заметку — убирает её из очереди встреч (entry only).
  const handleReclassify = async (item: MeetItem) => {
    if (item.kind !== "entry") return;
    await patchMeeting(item.data.id, { entry_type: "note" });
    removeFromList(item.data.id);
    toast("Перемещено в заметки");
  };

  const isLoading = entries === null || agentMeetings === null;

  return (
    <div className="roy-pop flex h-full flex-col overflow-hidden">
      <NavHeader onBack={pop} title="Ревью встреч" />

      {/* ── Трёхколоночный master-detail ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Левая колонка: список ──────────────────────────────────────────── */}
        <div
          className="flex flex-col border-r border-line shrink-0 min-h-0"
          style={{ width: 300 }}
        >
          {/* Стат-плашки */}
          <div className="flex gap-2 px-3 py-3">
            <StatChip label="на согласовании" value={pendingCount} accent />
            <StatChip label="черновиков" value={agentCount} />
          </div>

          {/* Метка секции */}
          <div className="px-3 pb-1">
            <SectionLabel>Требуют решения</SectionLabel>
          </div>

          {/* Список */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 space-y-2">
            {isLoading && (
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="roy-shim" style={{ height: 66, borderRadius: 18 }} />
                ))}
              </>
            )}
            {!isLoading && items.length === 0 && (
              <div className="py-8 text-center text-ink-mute" style={{ fontSize: 13 }}>
                Всё согласовано
              </div>
            )}
            {items.map((item) => (
              <ListRow
                key={itemId(item)}
                item={item}
                active={selected !== null && itemId(selected) === itemId(item)}
                onClick={() => setSelected(item)}
              />
            ))}
          </div>
        </div>

        {/* ── Центр: детали ─────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {selected ? (
            <DetailPanel item={selected} onEntryUpdated={onEntryUpdated} />
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

        {/* ── Правая колонка: действия ───────────────────────────────────────── */}
        <div
          className="flex flex-col border-l border-line shrink-0 min-h-0"
          style={{ width: 220 }}
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
