"use client";
// Плавающий индикатор записи встречи: маленькая «таблетка» (точка, таймер, «Стоп») вместо
// экрана на весь экран. Нажатие раскрывает небольшую панель с подробностями. Прерывание и
// «Продолжить» видны на самой таблетке (янтарный), ошибка — красный. Состояние — RecorderProvider.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDt, useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { cn } from "@/lib/utils";
import { Banner, errorText, formatClock, formatSpan, LevelBars, RecButton } from "./RecordingParts";
import { useRecorder } from "./RecorderProvider";

const DONE_HIDE_MS = 7000;
const STARTED_TOAST_MS = 3500;

type Tone = "red" | "amber" | "calm";

const TONE_COLOR: Record<Tone, string> = { red: "var(--pri-high)", amber: "var(--pri-med)", calm: "var(--status-done)" };

export function RecordingPill() {
  const dt = useDt();
  const { push } = useRoyNav();
  const rec = useRecorder();
  const { snap, offer, blocked } = rec;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dismissedGaps, setDismissedGaps] = useState(0);
  const [toast, setToast] = useState(false);
  const s = snap.state;

  // Короткая подсказка в первые секунды: запись пошла, экран не погаснет.
  useEffect(() => {
    if (s !== "recording") return;
    setToast(true);
    const id = setTimeout(() => setToast(false), STARTED_TOAST_MS);
    return () => clearTimeout(id);
  }, [s]);

  // «Готово» висит несколько секунд и уходит само (если обработка не провалилась).
  useEffect(() => {
    if (s !== "done" || snap.summaryStatus === "failed") return;
    const id = setTimeout(() => { setOpen(false); rec.dismiss(); }, DONE_HIDE_MS);
    return () => clearTimeout(id);
  }, [s, snap.summaryStatus, rec]);

  // Ошибки до/без записи и «неотправленное» сразу раскрываем: там нужны действия.
  const stuck = s === "stopping" && snap.error !== null;
  const failedStart = s === "error" || blocked !== null;
  useEffect(() => { if (stuck || failedStart) setOpen(true); }, [stuck, failedStart]);
  useEffect(() => { if (s !== "recording" && s !== "interrupted") setConfirming(false); }, [s]);

  const hasOffer = offer !== null && s === "idle";
  if (s === "idle" && !hasOffer && blocked === null) return null;

  const live = s === "recording" || s === "interrupted";
  const gap = snap.lastGapSec !== null && snap.interruptions.length > dismissedGaps ? snap.interruptions[snap.interruptions.length - 1] : null;
  const attention = s === "interrupted" || snap.muted || !snap.online || gap !== null;
  const tone: Tone = snap.error || failedStart || snap.summaryStatus === "failed" ? "red"
    : attention || hasOffer ? "amber" : "calm";
  const color = TONE_COLOR[tone];
  // Идёт запись — точка красная и пульсирует, как у любого диктофона; зелёная читалась как «выключено».
  // Цвет рамки остаётся сигналом состояния: спокойная — нейтральная, внимание — жёлтая, ошибка — красная.
  const dotColor = live && tone === "calm" ? TONE_COLOR.red : color;
  const borderColor = tone === "calm" ? "var(--line-2)" : `color-mix(in srgb, ${color} 55%, var(--line-2))`;
  const errCode = snap.error ?? blocked;
  const canDiscard = stuck && (snap.error === "finished" || snap.error === "not-found");
  const closePanel = () => { setOpen(false); setConfirming(false); setConfirmDiscard(false); if (gap) setDismissedGaps(snap.interruptions.length); };

  const label = (() => {
    if (s === "starting") return dt("Разрешите микрофон…", "Allow the microphone…");
    if (s === "interrupted") return dt("Запись прервалась", "Recording interrupted");
    if (s === "recording" && snap.muted) return dt("Звук не пишется", "Not recording sound");
    if (s === "recording" && !snap.online) return dt("Нет сети", "Offline");
    if (s === "recording" && gap) return dt(`Прерывалась на ${formatSpan(gap.seconds, dt)}`, `Interrupted for ${formatSpan(gap.seconds, dt)}`);
    if (s === "stopping") return snap.error ? dt("Не отправилось", "Not uploaded") : dt("Отправляем…", "Uploading…");
    if (s === "done") return snap.summaryStatus === "failed" ? dt("Не удалось обработать", "Couldn't process") : dt("Готово — встреча на вычитке", "Done — meeting is in review");
    if (failedStart) return dt("Запись не началась", "Recording didn't start");
    if (hasOffer) return dt("Незавершённая запись", "Unfinished recording");
    return "";
  })();

  const body = (
    <div
      className="fixed left-3 z-40 flex max-w-[calc(100vw-24px)] flex-col items-start gap-2 bottom-[calc(80px+env(safe-area-inset-bottom))] lg:bottom-5 lg:left-auto lg:right-5 lg:items-end"
      data-recording-pill
    >
      {toast && s === "recording" && !open && (
        <div role="status" className="roy-pop rounded-[10px] bg-ink px-3 py-2 text-surface shadow-[0_10px_30px_rgba(0,0,0,.3)]" style={{ fontSize: 12.5 }}>
          {dt("Запись началась — экран не погаснет", "Recording started — the screen stays on")}
        </div>
      )}

      {open && (
        <div role="dialog" aria-label={dt("Запись встречи", "Meeting recording")}
          className="roy-pop flex w-[min(340px,calc(100vw-104px))] lg:w-[340px] flex-col gap-3 rounded-[14px] border border-line bg-[var(--popover)] p-3.5 text-ink shadow-[0_14px_36px_-12px_rgba(0,0,0,.4)]">
          {live && (
            <>
              <LevelBars levels={snap.levels} muted={snap.muted || s === "interrupted"} heightClass="h-10" label={dt("Уровень звука с микрофона", "Live microphone level")} />
              <div className="flex items-center justify-between text-ink-soft" style={{ fontSize: 12.5 }}>
                <span>{snap.wakeLock ? dt("Экран не гаснет", "Screen stays on") : dt("Экран может погаснуть", "The screen may sleep")}</span>
                <span>
                  {snap.segmentsUploaded > 0 && dt(`Сохранено частей: ${snap.segmentsUploaded}`, `Parts saved: ${snap.segmentsUploaded}`)}
                  {snap.segmentsPending > 0 && ` · ${dt(`${snap.segmentsPending} ждёт отправки`, `${snap.segmentsPending} waiting`)}`}
                </span>
              </div>
              {!snap.online && <Banner tone="warn">{dt("Нет сети — запись копится на телефоне и уйдёт, когда сеть вернётся", "Offline — the recording is kept on the device and sent when the network is back")}</Banner>}
              {snap.muted && s === "recording" && <Banner tone="warn">{dt("Экран заблокирован или микрофон занят — звук сейчас не пишется. Вернитесь на экран.", "The screen is locked or the mic is busy — no sound is being recorded right now. Come back to the screen.")}</Banner>}
              {s === "interrupted" && <Banner tone="bad">{dt("Микрофон отключился (звонок или другое приложение). Нажмите «Продолжить» — пропавшие секунды останутся тишиной.", "The microphone was cut off (a call or another app). Tap Continue — the lost seconds stay silent.")}</Banner>}
              {gap && s === "recording" && !snap.muted && (
                <Banner tone="warn" onClose={() => setDismissedGaps(snap.interruptions.length)}>
                  {dt(`Запись прерывалась на ${formatSpan(gap.seconds, dt)}, пока экран был заблокирован`, `Recording was interrupted for ${formatSpan(gap.seconds, dt)} while the screen was locked`)}
                </Banner>
              )}
              {s === "interrupted" && <RecButton tone="primary" className="min-h-11" onClick={rec.continueRecording}>{dt("Продолжить запись", "Continue recording")}</RecButton>}
              {!confirming ? (
                <RecButton className="min-h-11" onClick={() => setConfirming(true)}>{dt("Остановить запись", "Stop recording")}</RecButton>
              ) : (
                <div role="group" aria-label={dt("Закончить запись?", "End the recording?")} className="flex flex-col gap-2">
                  <div className="font-semibold" style={{ fontSize: 14 }}>{dt("Закончить запись?", "End the recording?")}</div>
                  <div className="flex gap-2">
                    <RecButton className="min-h-11 flex-1" onClick={() => setConfirming(false)}>{dt("Продолжить", "Keep going")}</RecButton>
                    <RecButton tone="danger" className="min-h-11 flex-1" onClick={() => { setConfirming(false); rec.stop(); }}>{dt("Закончить", "End")}</RecButton>
                  </div>
                </div>
              )}
            </>
          )}

          {s === "stopping" && !snap.error && (
            <p className="text-ink-soft" style={{ fontSize: 13, lineHeight: 1.45 }}>
              {!snap.online
                ? dt("Нет сети. Запись сохранена на телефоне — отправится, как только сеть вернётся.", "No network. The recording is saved on the phone and uploads when the network is back.")
                : snap.segmentsPending > 0
                  ? dt(`Осталось отправить частей: ${snap.segmentsPending}. Не закрывайте вкладку.`, `Parts left to send: ${snap.segmentsPending}. Keep this tab open.`)
                  : dt("Заканчиваем запись на сервере. Не закрывайте вкладку.", "Finishing the recording on the server. Keep this tab open.")}
            </p>
          )}

          {s === "done" && (
            <p className="text-ink-soft" style={{ fontSize: 13, lineHeight: 1.45 }}>
              {snap.summaryStatus === "failed"
                ? dt("Звук дошёл, но обработать запись не удалось. Попробуйте записать ещё раз.", "The audio arrived but couldn't be processed. Try recording again.")
                : dt("Расшифровка появится на вычитке через несколько минут.", "The transcript will show up in the review queue in a few minutes.")}
            </p>
          )}

          {hasOffer && offer && (
            <>
              <p className="text-ink-soft" style={{ fontSize: 13, lineHeight: 1.45 }}>
                {offer.hasLocalData
                  ? dt("На телефоне остались неотправленные части записи. Загрузим их и завершим запись.", "Some parts of a recording never left this device. We'll upload them and finish the recording.")
                  : dt("Запись осталась открытой на сервере. Завершим её с тем, что дошло.", "The recording is still open on the server. We'll finish it with what arrived.")}
              </p>
              <div className="flex gap-2">
                <RecButton tone="primary" className="min-h-11 flex-1 px-4" onClick={() => { closePanel(); rec.recover(); }}>{dt("Загрузить и завершить", "Upload and finish")}</RecButton>
                <RecButton className="min-h-11 px-4" onClick={() => { closePanel(); rec.dismiss(); }}>{dt("Не сейчас", "Not now")}</RecButton>
              </div>
            </>
          )}

          {errCode && <Banner tone="bad">{errorText(errCode, dt)}</Banner>}

          {(stuck || failedStart) && (
            <div className="flex flex-col gap-2">
              <RecButton tone="primary" className="min-h-11" onClick={() => { closePanel(); rec.dismiss(); }}>
                {stuck ? dt("Закрыть — запись останется на телефоне", "Close — the recording stays on the phone") : dt("Закрыть", "Close")}
              </RecButton>
              {canDiscard && !confirmDiscard && <RecButton className="min-h-11" onClick={() => setConfirmDiscard(true)}>{dt("Удалить запись с телефона", "Delete the recording from the phone")}</RecButton>}
              {canDiscard && confirmDiscard && (
                <div role="group" aria-label={dt("Удалить безвозвратно?", "Delete permanently?")} className="flex flex-col gap-2">
                  <div className="font-semibold" style={{ fontSize: 14 }}>{dt("Звук пропадёт безвозвратно. Удалить?", "The audio will be lost for good. Delete?")}</div>
                  <div className="flex gap-2">
                    <RecButton className="min-h-11 flex-1" onClick={() => setConfirmDiscard(false)}>{dt("Отмена", "Cancel")}</RecButton>
                    <RecButton tone="danger" className="min-h-11 flex-1" onClick={() => { setConfirmDiscard(false); closePanel(); rec.discardLocal(); }}>{dt("Удалить", "Delete")}</RecButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div
        className="flex items-center rounded-full border bg-surface pl-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,.4)]"
        style={{ borderColor }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={dt("Запись встречи: показать подробности", "Meeting recording: show details")}
          onClick={() => (open ? closePanel() : setOpen(true))}
          className="flex min-h-11 items-center gap-2 rounded-full pl-2.5 pr-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {s === "stopping" && !snap.error ? (
            <span className="roy-spin size-3.5 rounded-full border-2 border-line-2" style={{ borderTopColor: "var(--primary)" }} aria-hidden />
          ) : s === "done" && tone === "calm" ? (
            <RoyIcon name="check" size={15} strokeWidth={2.2} style={{ color }} />
          ) : (
            <span className={cn("size-2.5 shrink-0 rounded-full", live && tone !== "amber" && "rec-dot")} style={{ background: dotColor }} aria-hidden />
          )}
          {live && <span role="timer" className="font-semibold" style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{formatClock(snap.elapsedSec)}</span>}
          {label && <span className={cn("truncate", live ? "text-ink-soft" : "font-semibold")} style={{ fontSize: 12.5, maxWidth: 190 }}>{label}</span>}
        </button>
        {s === "recording" && (
          <button type="button" aria-label={dt("Остановить запись", "Stop recording")}
            onClick={() => { setOpen(true); setConfirming(true); }}
            className="mr-1 grid size-9 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            <span className="size-3.5 rounded-[3px]" style={{ background: "var(--pri-high)" }} />
          </button>
        )}
        {s === "interrupted" && (
          <button type="button" onClick={rec.continueRecording}
            className="mr-1 min-h-9 rounded-full px-3 font-semibold text-white" style={{ fontSize: 12.5, background: "var(--pri-med)" }}>
            {dt("Продолжить", "Continue")}
          </button>
        )}
        {s === "done" && snap.meetingId && (
          <button type="button" onClick={() => { rec.dismiss(); push({ view: "meetingReview", params: { id: snap.meetingId as string } }); }}
            className="mr-1 min-h-9 rounded-full px-3 font-semibold text-accent-ink hover:underline" style={{ fontSize: 12.5 }}>
            {dt("Открыть", "Open")}
          </button>
        )}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
