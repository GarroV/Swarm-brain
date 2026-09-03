"use client";
import { useRoyNav, useDt } from "../nav";
import { RoyIcon } from "../icons";
import { Market } from "../ui";
import { deriveEntryTitle } from "../entry";
import { sourceLabel } from "../screens/RoyMeetingsScreen";
import { DashBlock, Row, AccentBadge, SubHead, fmtDate } from "./shared";
import type { DashboardData } from "./useDashboardData";
import type { Entry } from "@/types";

// Право-НИЗ главного экрана (под «Встречами сегодня», порядок задан владельцем 03.09.2026):
// записанные встречи, и ТОЛЬКО те, что на вычитке — «в блоке записанных встреч показываем
// только встречи на вычитке». Ярус «Недавние» (опубликованные) убран: опубликованное
// действия не требует, а место в колонке нужно живой очереди.
//
// Оба источника вычитки в ОДНОМ ярусе (issue #220): неподтверждённые записи (`entries`) и
// черновики рекордера (`awaiting_review`). Раньше рисовались только первые, а бейдж считал
// оба — на проде это давало «27 на согласовании» при трёх видимых строках, то есть 24
// черновика были невидимы с главной и доехать до них можно было только через доску встреч.
// Шапка → экран ревью (meetAdmin). Тап по строке → деталь встречи.

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
            {(() => { const s = sourceLabel(e.source); return dt(s, s === "Встреча" ? "Meeting" : s); })()}
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
  const { meetingsState, pendingList, pendingMeetings, reviewCount, reviewList } = data;
  const approvalCount = pendingMeetings + reviewCount;
  // Бейдж и список считаются по ОДНОМУ набору: расхождение цифры и строк — это и был #220.
  const pendingShown = pendingList.slice(0, 4);
  const reviewShown = reviewList.slice(0, 4);
  const open = (id: string) => push({ view: "meetingDetail", params: { id } });

  return (
    <DashBlock
      title={dt("Встречи", "Meetings")}
      icon="cal"
      tint="var(--meet-ink)"
      badge={approvalCount > 0 ? <AccentBadge>{approvalCount} {dt("на согласовании", "pending")}</AccentBadge> : undefined}
      headAction={dt("Доска встреч", "Board")}
      loading={meetingsState.loading}
      failed={meetingsState.failed}
      onRetry={meetingsState.retry}
      errorText={dt("Не загрузилось", "Failed to load")}
      retryText={dt("Повторить", "Retry")}
      empty={pendingList.length === 0 && reviewList.length === 0}
      emptyText={dt("Всё вычитано", "All reviewed")}
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
      {/* Черновики рекордера — тот же ярус вычитки, просто другой источник. Ведут на экран
          ревью: страницы «деталь черновика» у них нет, а `entries`-строки открываются как встреча. */}
      {reviewShown.length > 0 && (
        <>
          <SubHead count={reviewCount}>{dt("Черновики записей", "Recorded drafts")}</SubHead>
          {reviewShown.map((m) => (
            <Row key={m.id} onClick={() => push({ view: "meetAdmin" })}>
              <span
                className="inline-flex shrink-0 items-center justify-center rounded-[10px]"
                style={{ width: 32, height: 32, background: "var(--meet-soft)", color: "var(--meet-ink)" }}
              >
                <RoyIcon name="mic" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}>
                  {m.title ?? dt("Запись без названия", "Untitled recording")}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span
                    className="inline-flex items-center font-semibold"
                    style={{ fontSize: 10.5, color: "var(--status-open)", background: "color-mix(in srgb, var(--status-open) 12%, transparent)", borderRadius: 6, padding: "1px 6px" }}
                  >
                    {dt("На вычитке", "Awaiting review")}
                  </span>
                  {fmtDate(m.started_at ?? "", dt("ru-RU", "en-US")) && (
                    <span className="text-ink-mute" style={{ fontSize: 11 }}>
                      {fmtDate(m.started_at ?? "", dt("ru-RU", "en-US"))}
                    </span>
                  )}
                </div>
              </div>
            </Row>
          ))}
        </>
      )}
    </DashBlock>
  );
}
