"use client";
// Точки входа в запись встречи из браузера: кнопка в панели «Встреч» (десктоп) и компактная
// карточка на мобильном экране. Обе сразу начинают запись; о ходе говорит плавающий индикатор
// (RecordingPill), запись живёт в RecorderProvider и не зависит от экрана.
import { useDt } from "../nav";
import { RoyCard, SectionLabel } from "../ui";
import { RoyIcon } from "../icons";
import { ToolbarButton } from "@/components/tasks/table/Menu";
import { useRecorder } from "./RecorderProvider";

/** Десктоп: кнопка рядом с «Позвать бота». */
export function RecordMeetingButton() {
  const dt = useDt();
  const { start, busy } = useRecorder();
  return (
    <ToolbarButton on={busy} disabled={busy} onClick={start}>
      <RoyIcon name="mic" size={13} />
      {busy ? dt("Идёт запись", "Recording") : dt("Записать встречу", "Record meeting")}
    </ToolbarButton>
  );
}

/** Мобайл: карточка над приглашением бота. */
export function RecordMeetingCard() {
  const dt = useDt();
  const { start, busy } = useRecorder();
  return (
    <RoyCard className="px-3 py-2.5">
      <SectionLabel className="!mb-1">{dt("Записать встречу", "Record a meeting")}</SectionLabel>
      <p className="mx-1 mb-2 text-ink-soft" style={{ fontSize: 12, lineHeight: 1.4 }}>
        {dt("Офлайн-встреча: положите телефон на стол, экран не гаснет", "In-person meeting: put the phone on the table, the screen stays on")}
      </p>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-50"
        style={{ fontSize: 13.5 }}
      >
        <RoyIcon name="mic" size={15} />
        {busy ? dt("Идёт запись", "Recording") : dt("Записать встречу", "Record meeting")}
      </button>
    </RoyCard>
  );
}
