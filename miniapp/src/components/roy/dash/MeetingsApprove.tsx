"use client";
import { useRoyNav, useDt } from "../nav";
import { RoyIcon } from "../icons";
import { Market } from "../ui";
import { deriveEntryTitle } from "../entry";
import { sourceLabel } from "../screens/RoyMeetingsScreen";
import { DashBlock, Row, AccentBadge, SubHead, fmtDate } from "./shared";
import type { DashboardData } from "./useDashboardData";
import type { Entry } from "@/types";

// Право-верх главного экрана: встречи на согласование. Неподтверждённые идут первыми
// (sortMeetingsApprovalFirst). Бейдж «N на согласовании» = неподтв. встречи + черновики
// desktop-agent на вычитке. Шапка → экран ревью (meetAdmin). Тап по строке → деталь встречи.

const isConfirmed = (e: Entry) => e.metadata?.confirmed === true;

function MeetingRow({ e, onOpen }: { e: Entry; onOpen: () => void }) {
  const dt = useDt();
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
              {dt("На согласовании", "Pending review")}
            </span>
          )}
          <span className="font-semibold" style={{ fontSize: 11, color: "var(--meet-ink)" }}>
            {(() => { const s = sourceLabel(e.source); return dt(s, s === "Рекордер" ? "Recorder" : s === "Встреча" ? "Meeting" : s); })()}
          </span>
          <Market code={e.countries?.[0]} />
          {fmtDate(e.entry_date || e.created_at, dt("ru-RU", "en-US")) && (
            <span className="text-ink-mute" style={{ fontSize: 11 }}>{fmtDate(e.entry_date || e.created_at, dt("ru-RU", "en-US"))}</span>
          )}
        </div>
      </div>
    </Row>
  );
}

export function MeetingsApprove({ data, className }: { data: DashboardData; className?: string }) {
  const { push } = useRoyNav();
  const dt = useDt();
  const { loading, pendingList, recentMeetings, pendingMeetings, reviewCount } = data;
  const approvalCount = pendingMeetings + reviewCount;
  // Превью в карточке: pending — что требует решения, recent — недавно опубликованные.
  // Полные списки за «Ревью» (шапка → meetAdmin) и «Все встречи» (вкладка cal).
  const pendingShown = pendingList.slice(0, 6);
  const recentShown = recentMeetings.slice(0, 4);
  const open = (id: string) => push({ view: "meetingDetail", params: { id } });

  return (
    <DashBlock
      title={dt("Встречи", "Meetings")}
      icon="cal"
      tint="var(--meet-ink)"
      badge={approvalCount > 0 ? <AccentBadge>{approvalCount} {dt("на согласовании", "pending")}</AccentBadge> : undefined}
      headAction={dt("Ревью", "Review")}
      loading={loading}
      empty={pendingList.length === 0 && recentMeetings.length === 0}
      emptyText={dt("Встреч нет", "No meetings")}
      onHead={() => push({ view: "meetAdmin" })}
      className={className}
    >
      {pendingShown.length > 0 && (
        <>
          <SubHead count={pendingMeetings}>{dt("Требуют решения", "Need a decision")}</SubHead>
          {pendingShown.map((e) => (
            <MeetingRow key={e.id} e={e} onOpen={() => open(e.id)} />
          ))}
        </>
      )}
      {recentShown.length > 0 && (
        <>
          <SubHead>{dt("Недавние", "Recent")}</SubHead>
          {recentShown.map((e) => (
            <MeetingRow key={e.id} e={e} onOpen={() => open(e.id)} />
          ))}
        </>
      )}
      {/* Обе кнопки ведут на доску встреч (meetAdmin), как у задач: шапка «Ревью» — очередь на
          решение, футер «Все встречи» — весь доступный список (переключатель слева на доске). */}
      <button
        type="button"
        onClick={() => push({ view: "meetAdmin", params: { mode: "all" } })}
        className="mt-1 block w-full rounded-[10px] py-2 text-center font-semibold text-ink-mute transition-colors hover:bg-surface-2 hover:text-primary"
        style={{ fontSize: 12 }}
      >
        {dt("Все встречи →", "All meetings →")}
      </button>
    </DashBlock>
  );
}
