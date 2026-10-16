"use client";
// Экран записи встречи из браузера: на весь экран, «студия» — таймер и живая дорожка громкости
// главные, всё остальное тихо. Тексты двуязычные (useDt). Механика — lib/webRecorder.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDt, useIsDemo } from "../nav";
import { RoyIcon } from "../icons";
import { isRecordingSupported, type RecorderErrorCode, type RecoverableRecording } from "@/lib/webRecorder";
import { formatClock, formatSpan, LevelBars, RecButton } from "./RecordingParts";
import { useWebRecorder } from "./useWebRecorder";

type Dt = (ru: string, en: string) => string;

function errorText(code: RecorderErrorCode, dt: Dt): string {
  switch (code) {
    case "unsupported":
      return dt(
        "Этот браузер не умеет записывать звук (или страница открыта не по защищённому адресу). Откройте Swarm в Safari или Chrome.",
        "This browser can't record audio (or the page isn't served securely). Open Swarm in Safari or Chrome.",
      );
    case "permission-denied":
      return dt(
        "Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера и попробуйте снова.",
        "Microphone access is blocked. Allow it for this site in the browser settings and try again.",
      );
    case "no-mic":
      return dt("Микрофон не найден. Подключите его и попробуйте снова.", "No microphone found. Plug one in and try again.");
    case "mic-failed":
      return dt("Не удалось включить микрофон. Закройте другие приложения, которые его используют, и попробуйте снова.", "Couldn't start the microphone. Close other apps that use it and try again.");
    case "not-found":
      return dt("Сервер не нашёл эту запись или она не ваша — досылать некуда. Звук остался на телефоне: его можно закрыть до лучших времён или удалить.", "The server doesn't know this recording or it isn't yours, so there's nowhere to send it. The audio is still on the phone: keep it for later or delete it.");
    case "finished":
      return dt("Эта запись уже завершена на сервере, новые части не принимаются. Звук остался на телефоне.", "This recording was already finished on the server and no longer accepts parts. The audio is still on the phone.");
    case "too-many-open":
      return dt(
        "У вас уже три незавершённые записи. Эта запись сохраняется на телефоне и не потеряется: закончите её, затем откройте «Записать встречу» и выберите «Загрузить и завершить» у старых записей.",
        "You already have three unfinished recordings. This one is kept on the phone and won't be lost: end it, then open Record meeting and choose Upload and finish for the old ones.",
      );
    case "demo":
      return dt("В демо запись встречи недоступна.", "Meeting recording isn't available in the demo.");
    case "rejected":
      return dt("Сервер не принял одну из частей записи.", "The server rejected one of the recording parts.");
    case "too-large":
      return dt("Одна из частей записи слишком большая, сервер её не принял.", "One of the parts was too large for the server.");
    default:
      return dt("Что-то пошло не так.", "Something went wrong.");
  }
}

function Banner({ tone, children, onClose }: { tone: "warn" | "bad"; children: React.ReactNode; onClose?: () => void }) {
  const dt = useDt();
  const color = tone === "bad" ? "var(--pri-high)" : "var(--pri-med)";
  return (
    <div role={tone === "bad" ? "alert" : "status"} className="flex w-full items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-ink"
      style={{ fontSize: 13.5, lineHeight: 1.4, borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, background: `color-mix(in srgb, ${color} 12%, var(--background))` }}>
      <RoyIcon name="warn" size={16} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" aria-label={dt("Скрыть", "Dismiss")} onClick={onClose} className="shrink-0 text-ink-mute hover:text-ink">
          <RoyIcon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function RecordingOverlay({ recoverable, onClose }: { recoverable: RecoverableRecording | null; onClose: () => void }) {
  const dt = useDt();
  const { engine, snap } = useWebRecorder();
  const [confirming, setConfirming] = useState(false);
  const [offer, setOffer] = useState(recoverable);
  const [dismissedAt, setDismissedAt] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const s = snap.state;
  const isLive = s === "recording" || s === "interrupted";
  const stuck = s === "stopping" && snap.error !== null; // досылать некуда: звук остаётся на телефоне
  const canClose = s === "idle" || s === "error" || s === "done" || stuck;
  const canDiscard = stuck && (snap.error === "finished" || snap.error === "not-found");
  const isDemo = useIsDemo();
  const supported = isRecordingSupported() && !isDemo;

  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  useEffect(() => { if (!isLive) setConfirming(false); }, [isLive]);

  const stop = () => { setConfirming(false); void engine.stop(); };
  const offerDate = offer
    ? new Date(offer.startedAt).toLocaleString(dt("ru-RU", "en-GB"), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  const gap = snap.lastGapSec !== null && snap.interruptions.length > dismissedAt ? snap.interruptions[snap.interruptions.length - 1] : null;
  const totalGap = snap.interruptions.reduce((a, i) => a + i.seconds, 0);

  const statusLine = (() => {
    if (!snap.online) return dt("Нет сети — запись копится на телефоне и уйдёт, когда сеть вернётся", "Offline — the recording is kept on the device and sent when the network is back");
    const parts: string[] = [];
    if (snap.segmentsUploaded > 0) parts.push(dt(`Сохранено частей: ${snap.segmentsUploaded}`, `Parts saved: ${snap.segmentsUploaded}`));
    if (snap.segmentsPending > 0) parts.push(dt(`${snap.segmentsPending} ждёт отправки`, `${snap.segmentsPending} waiting to upload`));
    return parts.join(" · ");
  })();

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dt("Запись встречи", "Meeting recording")}
      className="roy-pop fixed inset-0 z-[200] flex flex-col overflow-y-auto bg-background text-ink"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(20px, env(safe-area-inset-bottom))",
        paddingLeft: "max(20px, env(safe-area-inset-left))",
        paddingRight: "max(20px, env(safe-area-inset-right))",
        backgroundImage: isLive
          ? "radial-gradient(70% 45% at 50% 38%, color-mix(in srgb, var(--pri-high) 9%, transparent), transparent 75%)"
          : undefined,
      }}
    >
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col">
        <header className="flex h-10 items-center justify-between">
          <div className="flex items-center gap-2 font-mono font-semibold uppercase text-ink-mute" style={{ fontSize: 11, letterSpacing: "0.08em" }}>
            {isLive && s === "recording" && <span className="rec-dot size-2.5 rounded-full" style={{ background: "var(--pri-high)" }} aria-hidden />}
            {isLive
              ? (s === "interrupted" ? dt("Запись прервалась", "Recording interrupted") : dt("Идёт запись · экран не гаснет", "Recording · screen stays on"))
              : s === "stopping" ? dt("Отправляем", "Uploading")
              : dt("Офлайн-встреча", "In-person meeting")}
          </div>
          {canClose && (
            <button type="button" aria-label={dt("Закрыть", "Close")} onClick={onClose}
              className="-mr-2 grid size-10 place-items-center rounded-full text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              <RoyIcon name="x" size={18} />
            </button>
          )}
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
          {(s === "idle" || s === "starting" || s === "error") && (
            <>
              <div className="grid size-20 place-items-center rounded-full border border-line-2 bg-surface text-ink-soft">
                <RoyIcon name="mic" size={34} strokeWidth={1.5} />
              </div>
              <div className="max-w-[360px]">
                <h2 className="font-semibold" style={{ fontSize: 22, lineHeight: 1.2 }}>{dt("Записать офлайн-встречу", "Record an in-person meeting")}</h2>
                <p className="mt-2 text-ink-soft" style={{ fontSize: 14, lineHeight: 1.5 }}>
                  {dt(
                    "Положите телефон на стол микрофоном к участникам и не блокируйте экран: пока идёт запись, он не гаснет. Участников программа не определяет — запись идёт одной дорожкой.",
                    "Put the phone on the table, microphone towards the participants, and don't lock the screen — it stays on while recording. Participants aren't identified; it's a single track.",
                  )}
                </p>
              </div>
              {offer && s === "idle" && (
                <div className="w-full rounded-[12px] border border-line-2 bg-surface px-4 py-3.5 text-left">
                  <div className="font-semibold" style={{ fontSize: 14 }}>{dt("Незавершённая запись", "Unfinished recording")} · {offerDate}</div>
                  <p className="mt-1 text-ink-soft" style={{ fontSize: 13, lineHeight: 1.4 }}>
                    {offer.hasLocalData
                      ? dt("На телефоне осталась неотправленная часть записи. Загрузим её и завершим запись.", "Part of the recording never left this device. We'll upload them and finish the recording.")
                      : dt("Запись осталась открытой на сервере. Завершим её с тем, что дошло.", "The recording is still open on the server. We'll finish it with what arrived.")}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <RecButton tone="primary" className="min-h-10 flex-1 px-4" onClick={() => { void engine.recover(offer); setOffer(null); }}>
                      {dt("Загрузить и завершить", "Upload and finish")}
                    </RecButton>
                    <RecButton className="min-h-10 px-4" onClick={() => setOffer(null)}>{dt("Не сейчас", "Not now")}</RecButton>
                  </div>
                </div>
              )}
              {!supported && <Banner tone="bad">{errorText(isDemo ? "demo" : "unsupported", dt)}</Banner>}
              {snap.error && <Banner tone="bad">{errorText(snap.error, dt)}</Banner>}
            </>
          )}

          {isLive && (
            <>
              <div role="timer" className="font-light" style={{ fontSize: "clamp(64px, 22vw, 112px)", lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                {formatClock(snap.elapsedSec)}
              </div>
              <LevelBars levels={snap.levels} muted={snap.muted || s === "interrupted"} label={dt("Уровень звука с микрофона", "Live microphone level")} />
              {statusLine && <p className="text-ink-soft" style={{ fontSize: 13 }}>{statusLine}</p>}
              {snap.muted && s === "recording" && (
                <Banner tone="warn">{dt("Экран заблокирован или микрофон занят — звук сейчас не пишется. Вернитесь на экран.", "The screen is locked or the mic is busy — no sound is being recorded right now. Come back to the screen.")}</Banner>
              )}
              {s === "interrupted" && (
                <Banner tone="bad">{dt("Микрофон отключился (звонок или другое приложение). Нажмите «Продолжить» — запись пойдёт дальше, пропавшие секунды останутся тишиной.", "The microphone was cut off (a call or another app). Tap Continue — recording resumes and the lost seconds stay silent.")}</Banner>
              )}
              {gap && s === "recording" && !snap.muted && (
                <Banner tone="warn" onClose={() => setDismissedAt(snap.interruptions.length)}>
                  {dt(`Запись прерывалась на ${formatSpan(gap.seconds, dt)}, пока экран был заблокирован`, `Recording was interrupted for ${formatSpan(gap.seconds, dt)} while the screen was locked`)}
                  {snap.interruptions.length > 1 && (
                    <span className="text-ink-soft"> · {dt(`всего пауз: ${snap.interruptions.length} (${formatSpan(totalGap, dt)})`, `${snap.interruptions.length} gaps in total (${formatSpan(totalGap, dt)})`)}</span>
                  )}
                </Banner>
              )}
              {snap.error && <Banner tone="bad">{errorText(snap.error, dt)}</Banner>}
            </>
          )}

          {s === "stopping" && (
            <>
              {!snap.error && <div className="roy-spin size-10 rounded-full border-2 border-line-2" style={{ borderTopColor: "var(--primary)" }} aria-hidden />}
              <h2 className="font-semibold" style={{ fontSize: 22 }}>{dt("Отправляем…", "Uploading…")}</h2>
              <p className="max-w-[340px] text-ink-soft" style={{ fontSize: 14, lineHeight: 1.5 }}>
                {!snap.online
                  ? dt("Нет сети. Запись сохранена на телефоне — отправится, как только сеть вернётся.", "No network. The recording is saved on the phone and uploads when the network is back.")
                  : snap.segmentsPending > 0
                    ? dt(`Осталось отправить частей: ${snap.segmentsPending}. Не закрывайте вкладку.`, `Parts left to send: ${snap.segmentsPending}. Keep this tab open.`)
                    : dt("Заканчиваем запись на сервере. Не закрывайте вкладку.", "Finishing the recording on the server. Keep this tab open.")}
              </p>
              {snap.error && <Banner tone="bad">{errorText(snap.error, dt)}</Banner>}
            </>
          )}

          {s === "done" && (
            <>
              <div className="grid size-16 place-items-center rounded-full" style={{ background: "color-mix(in srgb, var(--status-done) 16%, transparent)", color: "var(--status-done)" }}>
                <RoyIcon name="check" size={30} strokeWidth={2} />
              </div>
              <h2 className="font-semibold" style={{ fontSize: 22 }}>{dt("Готово", "Done")}</h2>
              <p className="max-w-[340px] text-ink-soft" style={{ fontSize: 14, lineHeight: 1.5 }}>
                {dt("Расшифровка появится на вычитке через несколько минут.", "The transcript will show up in the review queue in a few minutes.")}
              </p>
              {snap.summaryStatus === "failed" && (
                <Banner tone="bad">{dt("Звук дошёл, но обработать запись не удалось. Попробуйте записать ещё раз.", "The audio arrived but couldn't be processed. Try recording again.")}</Banner>
              )}
              {snap.segmentsFailed > 0 && <Banner tone="warn">{errorText("rejected", dt)}</Banner>}
            </>
          )}
        </main>

        <footer className="flex flex-col items-center gap-3 pt-2">
          {(s === "idle" || s === "error") && (
            <RecButton tone="primary" autoFocus disabled={!supported} className="w-full max-w-[360px] min-h-14" onClick={() => engine.start()}>
              <RoyIcon name="mic" size={18} />
              {dt("Начать запись", "Start recording")}
            </RecButton>
          )}
          {s === "starting" && <RecButton tone="primary" disabled className="w-full max-w-[360px] min-h-14">{dt("Разрешите микрофон…", "Allow the microphone…")}</RecButton>}

          {s === "interrupted" && (
            <RecButton tone="primary" autoFocus className="w-full max-w-[360px] min-h-14" onClick={() => engine.continueRecording()}>
              {dt("Продолжить запись", "Continue recording")}
            </RecButton>
          )}

          {isLive && !confirming && (
            <button
              type="button"
              aria-label={dt("Остановить запись", "Stop recording")}
              onClick={() => setConfirming(true)}
              className="grid size-[88px] place-items-center rounded-full border-[3px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-95"
              style={{ borderColor: "var(--pri-high)" }}
            >
              <span className="size-8 rounded-[8px]" style={{ background: "var(--pri-high)" }} />
            </button>
          )}
          {isLive && confirming && (
            <div role="group" aria-label={dt("Закончить запись?", "End the recording?")} className="flex w-full max-w-[360px] flex-col items-center gap-3">
              <div className="font-semibold" style={{ fontSize: 17 }}>{dt("Закончить запись?", "End the recording?")}</div>
              <div className="flex w-full gap-2.5">
                <RecButton className="flex-1" autoFocus onClick={() => setConfirming(false)}>{dt("Продолжить", "Keep going")}</RecButton>
                <RecButton tone="danger" className="flex-1" onClick={stop}>{dt("Закончить", "End")}</RecButton>
              </div>
            </div>
          )}
          {stuck && (
            <div className="flex w-full max-w-[360px] flex-col gap-2.5">
              <RecButton tone="primary" onClick={onClose}>{dt("Закрыть — запись останется на телефоне", "Close — the recording stays on the phone")}</RecButton>
              {canDiscard && !confirmDiscard && (
                <RecButton onClick={() => setConfirmDiscard(true)}>{dt("Удалить запись с телефона", "Delete the recording from the phone")}</RecButton>
              )}
              {canDiscard && confirmDiscard && (
                <div role="group" aria-label={dt("Удалить безвозвратно?", "Delete permanently?")} className="flex flex-col items-center gap-2">
                  <div className="font-semibold" style={{ fontSize: 15 }}>{dt("Звук пропадёт безвозвратно. Удалить?", "The audio will be lost for good. Delete?")}</div>
                  <div className="flex w-full gap-2.5">
                    <RecButton className="flex-1" onClick={() => setConfirmDiscard(false)}>{dt("Отмена", "Cancel")}</RecButton>
                    <RecButton tone="danger" className="flex-1" onClick={() => { setConfirmDiscard(false); void engine.discardLocal(); }}>{dt("Удалить", "Delete")}</RecButton>
                  </div>
                </div>
              )}
            </div>
          )}
          {s === "done" && <RecButton tone="primary" autoFocus className="w-full max-w-[360px] min-h-14" onClick={onClose}>{dt("Закрыть", "Close")}</RecButton>}
        </footer>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
