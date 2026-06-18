"use client";
import { useCallback, useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, RoyCard, SectionLabel, Avatar } from "../ui";
import { RoyIcon } from "../icons";
import { deriveEntryTitle } from "../entry";
import {
  fetchMeetings,
  fetchAgentMeetings,
  patchMeeting,
  deleteMeeting,
  deleteAgentMeeting,
  publishAgentMeeting,
} from "@/lib/api";
import type { Entry, AgentMeeting } from "@/types";
import { sourceLabel } from "./RoyMeetingsScreen";

// ── Типы объединённого списка ────────────────────────────────────────────────

type MeetItem =
  | { kind: "entry"; data: Entry }
  | { kind: "agent"; data: AgentMeeting };

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
  if (it.kind === "entry") return sourceLabel(it.data.source);
  return "Запись";
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
                  background: isAgent ? "var(--status-open)1A" : "var(--meet-soft)",
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
            </div>
          </div>
        </div>
      </RoyCard>
    </button>
  );
}

// ── Панель деталей (центр) ────────────────────────────────────────────────────

function DetailPanel({ item }: { item: MeetItem }) {
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

        {e.content && (
          <div>
            <SectionLabel>Содержание</SectionLabel>
            <p className="text-ink-soft leading-relaxed whitespace-pre-wrap" style={{ fontSize: 13 }}>
              {e.content.slice(0, 800)}{e.content.length > 800 ? "…" : ""}
            </p>
          </div>
        )}
      </div>
    );
  }

  // AgentMeeting
  const m = item.data;
  return (
    <div className="flex flex-col gap-4 min-h-0 overflow-y-auto px-5 py-4">
      <div>
        <h2 className="font-bold text-ink leading-tight" style={{ fontSize: 22, letterSpacing: "-0.015em" }}>
          {title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center font-semibold"
            style={{ fontSize: 11, color: "var(--status-open)", background: "var(--status-open)1A", borderRadius: 7, padding: "2px 8px" }}
          >
            На вычитке
          </span>
          <span
            className="inline-flex items-center font-semibold"
            style={{ fontSize: 11, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 7, padding: "2px 8px" }}
          >
            desktop-agent
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
}: {
  item: MeetItem;
  onConfirm: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [confirmState, setConfirmState] = useState<ActionState>("idle");
  const [rejectState, setRejectState] = useState<ActionState>("idle");
  const isAgent = item.kind === "agent";

  const handleConfirm = async () => {
    if (confirmState !== "idle") return;
    setConfirmState("busy");
    try {
      await onConfirm();
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

  const confirmLabel = confirmState === "busy" ? "…" : confirmState === "done" ? "Готово" : isAgent ? "Опубликовать" : "Согласовать";
  const rejectLabel = rejectState === "busy" ? "…" : rejectState === "done" ? "Удалено" : "Отклонить";

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <SectionLabel>Решение</SectionLabel>

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
          color: "#fff",
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

      {isAgent && (
        <p className="text-ink-mute leading-snug" style={{ fontSize: 11 }}>
          «Опубликовать» — сохранит тезисы в базу команды. Для полного редактирования — откройте встречу на вкладке «Встречи».
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

  const handleConfirm = async (item: MeetItem) => {
    if (item.kind === "entry") {
      // Подтверждение встречи: patchMeeting(id, { confirmed: true })
      await patchMeeting(item.data.id, { confirmed: true });
      removeFromList(item.data.id);
      toast("Встреча согласована");
    } else {
      // Публикация черновика агента в базу команды: publishAgentMeeting
      await publishAgentMeeting(item.data.id, "workspace");
      removeFromList(item.data.id);
      toast("Черновик опубликован");
    }
  };

  const handleReject = async (item: MeetItem) => {
    if (item.kind === "entry") {
      await deleteMeeting(item.data.id);
      removeFromList(item.data.id);
      toast("Встреча удалена");
    } else {
      await deleteAgentMeeting(item.data.id);
      removeFromList(item.data.id);
      toast("Черновик удалён");
    }
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
            <DetailPanel item={selected} />
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
                  onConfirm={() => handleConfirm(selected)}
                  onReject={() => handleReject(selected)}
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
