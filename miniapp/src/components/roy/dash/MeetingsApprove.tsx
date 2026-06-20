"use client";
import { useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { Market } from "../ui";
import { deriveEntryTitle } from "../entry";
import { sourceLabel } from "../screens/RoyMeetingsScreen";
import { DashBlock, Row, AccentBadge, fmtDate } from "./shared";
import type { DashboardData } from "./useDashboardData";
import type { Entry } from "@/types";

// Право-верх главного экрана: встречи на согласование. Неподтверждённые идут первыми
// (sortMeetingsApprovalFirst). Бейдж «N на согласовании» = неподтв. встречи + черновики
// desktop-agent на вычитке. Шапка → экран ревью (meetAdmin). Тап по строке → деталь встречи.

const isConfirmed = (e: Entry) => e.metadata?.confirmed === true;

function MeetingRow({ e, onOpen }: { e: Entry; onOpen: () => void }) {
  const pending = !isConfirmed(e);
  return (
    <Row onClick={onOpen}>
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[10px]"
        style={{ width: 32, height: 32, background: "var(--meet-soft)", color: "var(--meet-ink)" }}
      >
        <RoyIcon name="meet" size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}>
          {deriveEntryTitle(e)}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {pending && (
            <span
              className="inline-flex items-center font-semibold"
              style={{ fontSize: 10.5, color: "var(--status-open)", background: "color-mix(in srgb, var(--status-open) 12%, transparent)", borderRadius: 6, padding: "1px 6px" }}
            >
              На согласовании
            </span>
          )}
          <span className="font-semibold" style={{ fontSize: 11, color: "var(--meet-ink)" }}>
            {sourceLabel(e.source)}
          </span>
          <Market code={e.countries?.[0]} />
          {fmtDate(e.entry_date || e.created_at) && (
            <span className="text-ink-mute" style={{ fontSize: 11 }}>{fmtDate(e.entry_date || e.created_at)}</span>
          )}
        </div>
      </div>
    </Row>
  );
}

export function MeetingsApprove({ data, className }: { data: DashboardData; className?: string }) {
  const { push, setTab } = useRoyNav();
  const { loading, meetingsApprovalFirst, pendingMeetings, reviewCount } = data;
  const approvalCount = pendingMeetings + reviewCount;

  return (
    <DashBlock
      title="Встречи"
      icon="cal"
      tint="var(--meet-ink)"
      badge={approvalCount > 0 ? <AccentBadge>{approvalCount} на согласовании</AccentBadge> : undefined}
      headAction="Ревью"
      loading={loading}
      empty={meetingsApprovalFirst.length === 0}
      emptyText="Встреч нет"
      onHead={() => push({ view: "meetAdmin" })}
      className={className}
    >
      {meetingsApprovalFirst.map((e) => (
        <MeetingRow key={e.id} e={e} onOpen={() => push({ view: "meetingDetail", params: { id: e.id } })} />
      ))}
      {/* Полный список встреч (Все/Ожидают/Подтверждены) — на desktop сайдбара нет, поэтому
          вход во вкладку «Встречи» здесь. Шапка панели ведёт в ревью (meetAdmin). */}
      <button
        type="button"
        onClick={() => setTab("cal")}
        className="mt-1 block w-full rounded-[10px] py-2 text-center font-semibold text-ink-mute transition-colors hover:bg-surface-2 hover:text-primary"
        style={{ fontSize: 12 }}
      >
        Все встречи →
      </button>
    </DashBlock>
  );
}
