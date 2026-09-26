// Сторож оборванной записи: писатель записывал встречу (recording=true) и замолчал.
// При штатной остановке пришёл бы heartbeat recording=false, поэтому застрявший true — это
// смерть писателя посреди записи, и человек должен об этом узнать.
//
// Писателей два, и живут они в РАЗНЫХ таблицах (решение D007):
//   • рекордер человека (bumblebee) — allowed_users.recorder_last_*, heartbeat раз в 15 мин;
//   • служебный агент (бот scriba)  — meetings.agent_last_* САМОЙ встречи (D018), heartbeat раз
//     в 2 мин изнутри контейнера (bot/src/orchestrator/run-meeting.ts). Контейнер, убитый посреди
//     встречи, финального recording:false не шлёт — последний удар так и остаётся recording:true.
// Смешать их нельзя: heartbeat бота в строке человека выглядел бы как живой рекордер и гасил
// настоящий сигнал «запись оборвалась».
//
// Кому алерт. Рекордер — самому человеку (это его строка). Бот — claim_owner той же встречи:
// recording=true бот шлёт только с решением «transcribe», meeting-claim ставит claim_owner =
// человек из X-On-Behalf-Of, а meeting-heartbeat пускает удар только в такую встречу.
//
// Тишина считается по каждой встрече отдельно: два контейнера на двух встречах бьют в разные
// строки, и живой больше не прячет замолчавший (до D018 строка была одна на агента).
//
// Сбросы флага — дедуп, а не удаление данных: так сторож не повторяет алерт каждый час.
// Решение «жив/мёртв» принимает код (isSilent), а не SQL — чтобы его держали тесты.
import { NO_TITLE } from "../../_shared/notice-texts.ts";

/** Рекордер бьёт раз в 15 мин → живой всегда свежее 20. */
export const RECORDER_STALE_MIN = 20;
/** Бот бьёт раз в 2 мин → 10 мин тишины это пять пропущенных ударов, а не сетевой всплеск. */
export const AGENT_STALE_MIN = 10;

export interface HumanBeat {
  telegram_id: number;
  recorder_last_seen: string | null;
}

/** Встреча, которую бот пишет: её строка meetings с последним ударом бота. */
export interface AgentMeetingBeat {
  id: string;
  title: string | null;
  claim_owner: number | null;
  agent_last_seen_at: string | null;
}

/** Узкая граница к базе. Реализация на supabase-js — recording-watchdog-store.ts. */
export interface WatchdogStore {
  /** allowed_users с recorder_last_recording = true. */
  recordingHumans(): Promise<HumanBeat[]>;
  clearHumanRecording(telegramId: number): Promise<void>;
  /** meetings с agent_last_recording = true. */
  recordingAgentMeetings(): Promise<AgentMeetingBeat[]>;
  /**
   * Сбросить agent_last_recording, только если agent_last_seen_at всё ещё равен прочитанному.
   * false — между чтением и сбросом пришёл свежий удар: бот жив, алерт не нужен.
   */
  clearAgentRecording(meetingId: string, seenAt: string): Promise<boolean>;
  /** Оркестратор уже сказал этому человеку container_died по этой встрече. */
  containerDiedNoticeSent(meetingId: string, recipient: number): Promise<boolean>;
}

export interface WatchdogDeps {
  store: WatchdogStore;
  send: (telegramId: number, html: string) => Promise<unknown>;
  nowMs: number;
  logError: (message: string) => void;
}

export interface WatchdogResult {
  humanAlerts: number;
  agentAlerts: number;
  agentAlreadyNotified: number;
  agentUnresolved: number;
}

export function isSilent(lastSeen: string | null, nowMs: number, staleMin: number): boolean {
  if (!lastSeen) return false;
  const seenMs = Date.parse(lastSeen);
  if (Number.isNaN(seenMs)) return false;
  return seenMs < nowMs - staleMin * 60_000;
}

const HUMAN_ALERT = "⚠️ <b>Похоже, запись встречи прервалась</b> — bumblebee писал встречу, но перестал отвечать " +
  "(возможно, приложение закрылось). Проверь, что bumblebee запущен, и при необходимости запиши заново.";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Язык человека сервер не знает — поэтому оба, английский первым (правило проекта). */
export function agentAlertText(title: string | null): string {
  const en = escapeHtml(title ?? NO_TITLE.en);
  const ru = escapeHtml(title ?? NO_TITLE.ru);
  return (
    `⚠️ <b>${en}</b>: scriba stopped responding in the middle of the meeting — it was recording ` +
    `and then went silent, most likely its container crashed. The recording may be incomplete ` +
    `or missing; check the meeting in Swarm.\n\n` +
    `⚠️ «<b>${ru}</b>»: scriba перестал отвечать посреди встречи — он вёл запись и замолчал, ` +
    `скорее всего упал его контейнер. Запись может быть неполной или не дойти вовсе; проверьте ` +
    `встречу в Swarm.`
  );
}

async function checkHumans(deps: WatchdogDeps): Promise<number> {
  let alerts = 0;
  for (const u of await deps.store.recordingHumans()) {
    if (!isSilent(u.recorder_last_seen, deps.nowMs, RECORDER_STALE_MIN)) continue;
    await deps.store.clearHumanRecording(u.telegram_id);
    try {
      await deps.send(u.telegram_id, HUMAN_ALERT);
      alerts++;
    } catch (e) {
      deps.logError(`checkRecorderHealth signal1 ${u.telegram_id}: ${e}`);
    }
  }
  return alerts;
}

type AgentOutcome = "alerted" | "notified" | "unresolved" | "alive" | "send_failed";

async function checkAgent(deps: WatchdogDeps, meeting: AgentMeetingBeat): Promise<AgentOutcome> {
  const seenAt = meeting.agent_last_seen_at;
  if (!seenAt || !isSilent(seenAt, deps.nowMs, AGENT_STALE_MIN)) return "alive";
  if (!(await deps.store.clearAgentRecording(meeting.id, seenAt))) return "alive";
  if (meeting.claim_owner === null) {
    deps.logError(
      `checkRecorderHealth meeting ${meeting.id}: бот замолчал на записи, но claim_owner нет — адресата нет`,
    );
    return "unresolved";
  }
  if (await deps.store.containerDiedNoticeSent(meeting.id, meeting.claim_owner)) return "notified";
  try {
    await deps.send(meeting.claim_owner, agentAlertText(meeting.title));
    return "alerted";
  } catch (e) {
    deps.logError(`checkRecorderHealth meeting ${meeting.id} → ${meeting.claim_owner}: ${e}`);
    return "send_failed";
  }
}

export async function checkRecordingWatchdog(deps: WatchdogDeps): Promise<WatchdogResult> {
  const result: WatchdogResult = {
    humanAlerts: await checkHumans(deps),
    agentAlerts: 0,
    agentAlreadyNotified: 0,
    agentUnresolved: 0,
  };
  for (const meeting of await deps.store.recordingAgentMeetings()) {
    const outcome = await checkAgent(deps, meeting);
    if (outcome === "alerted") result.agentAlerts++;
    if (outcome === "notified") result.agentAlreadyNotified++;
    if (outcome === "unresolved") result.agentUnresolved++;
  }
  return result;
}
