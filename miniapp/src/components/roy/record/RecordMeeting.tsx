"use client";
// Точки входа в запись встречи из браузера: кнопка в панели «Встреч» (десктоп) и компактная
// карточка на мобильном экране. Обе открывают один и тот же экран записи (RecordingOverlay);
// при открытии экрана встреч проверяем, нет ли незавершённой записи после сбоя.
import { useCallback, useEffect, useState } from "react";
import { useDt } from "../nav";
import { RoyCard, SectionLabel } from "../ui";
import { RoyIcon } from "../icons";
import { ToolbarButton } from "@/components/tasks/table/Menu";
import { findRecoverable, type RecoverableRecording } from "@/lib/webRecorder";
import { RecordingOverlay } from "./RecordingOverlay";

/** Незавершённую запись предлагаем один раз за сессию вкладки: «Не сейчас» не должно возвращаться. */
let offeredThisSession = false;

function useRecordLauncher() {
  const [open, setOpen] = useState(false);
  const [recoverable, setRecoverable] = useState<RecoverableRecording | null>(null);

  useEffect(() => {
    if (offeredThisSession) return;
    let alive = true;
    void findRecoverable().then((found) => {
      if (!alive || !found) return;
      offeredThisSession = true;
      setRecoverable(found);
      setOpen(true);
    });
    return () => { alive = false; };
  }, []);

  const close = useCallback(() => { setOpen(false); setRecoverable(null); }, []);
  const overlay = open ? <RecordingOverlay recoverable={recoverable} onClose={close} /> : null;
  return { setOpen, overlay };
}

/** Десктоп: кнопка рядом с «Позвать бота». */
export function RecordMeetingButton() {
  const dt = useDt();
  const { setOpen, overlay } = useRecordLauncher();
  return (
    <>
      <ToolbarButton onClick={() => setOpen(true)}>
        <RoyIcon name="mic" size={13} />
        {dt("Записать встречу", "Record meeting")}
      </ToolbarButton>
      {overlay}
    </>
  );
}

/** Мобайл: карточка над приглашением бота. */
export function RecordMeetingCard() {
  const dt = useDt();
  const { setOpen, overlay } = useRecordLauncher();
  return (
    <>
      <RoyCard className="px-3 py-2.5">
        <SectionLabel className="!mb-1">{dt("Офлайн-встреча", "In-person meeting")}</SectionLabel>
        <p className="mx-1 mb-2 text-ink-soft" style={{ fontSize: 12, lineHeight: 1.4 }}>
          {dt("Положите телефон на стол экраном вверх — Swarm запишет разговор, экран не погаснет", "Put the phone on the table screen up — Swarm records the conversation, the screen stays on")}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 font-semibold text-primary-foreground transition-opacity active:opacity-80"
          style={{ fontSize: 13.5 }}
        >
          <RoyIcon name="mic" size={15} />
          {dt("Записать встречу", "Record meeting")}
        </button>
      </RoyCard>
      {overlay}
    </>
  );
}
