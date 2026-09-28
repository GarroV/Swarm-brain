// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Пропуск автозапуска по календарю → сообщение человеку (T102, решение D015). Чистые функции: что
// сообщать, кому, под каким ключом журнала и каким текстом. Отправку делает meeting-calendar/missed.ts
// через журнал meeting_notices и его потолки (meeting_notice_reserve).
//
// Какие причины будят человека. Правило одно: сообщаем, когда человек ЖДЁТ бота и может что-то
// сделать, пока встреча не прошла.
//   громко: unsupported_platform (встреча не в Meet — записать рекордером), unrecognized_link (ссылку
//           не разобрали — позвать руками), calendar_not_connected и calendar_token_dead (бот не видит
//           НИ ОДНОЙ встречи — переподключить, пока звать руками), бот не дошёл (not_arrived);
//   тихо:   no_conference_link — событие без ссылки обычно не созвон (обед, фокус, встреча вживую):
//           сообщение о каждом из них научило бы человека не читать сигналы бота вообще;
//           declined — человек сам не идёт; manual_invite_exists — бот уже идёт по ручному приглашению;
//           calendar_unavailable — Google моргнул, следующий опрос через минуту, окно встречи 12 минут.
//
// Сколько раз. Причина встречи — одно сообщение на встречу и причину (ключ журнала = ключ встречи,
// вид = причина). Причина человека встречи не имеет — раз в сутки по дате Белграда и только днём:
// о «календарь протух» в три ночи будить незачем, встречи мы всё равно не видим.
//
// Язык человека сервер не знает — поэтому оба, английский первым (как у сторожа записи,
// swarm-bot/lib/recording-watchdog.ts).
import type { DispatchSkip, SkipReason } from "./calendar-dispatch.ts";
import { NO_TITLE } from "./notice-texts.ts";

/** Через сколько после забора задания бот обязан подать признак жизни или сам сказать об отказе. */
export const ARRIVAL_GRACE_MS = 6 * 60_000;

/** Часовой пояс команды: по нему сутки и «день» для причин уровня человека. */
export const TEAM_TIME_ZONE = "Europe/Belgrade";
/** Причины уровня человека шлются с этого часа (включительно)… */
export const PERSON_NOTICE_FROM_HOUR = 8;
/** …и до этого часа (не включая). */
export const PERSON_NOTICE_UNTIL_HOUR = 20;

/** Что отправить: кому, под каким ключом и видом журнала, каким текстом (HTML для Telegram). */
export interface MissedNotice {
  recipient: number;
  meetingKey: string;
  kind: string;
  html: string;
}

type Lang = "en" | "ru";
type Loud = "unsupported_platform" | "unrecognized_link" | "calendar_not_connected" | "calendar_token_dead";

const PERSON_LEVEL: ReadonlySet<SkipReason> = new Set(["calendar_not_connected", "calendar_token_dead"]);
const LOUD: ReadonlySet<SkipReason> = new Set([
  "unsupported_platform",
  "unrecognized_link",
  "calendar_not_connected",
  "calendar_token_dead",
]);

const PLATFORM_NAME: Readonly<Record<string, string>> = { zoom: "Zoom", kontur: "Kontur.Talk", meet: "Google Meet" };

const MANUAL: Record<Lang, string> = {
  en: "To record it anyway, open Meetings in Swarm → «Invite the bot to a call» and paste the call link.",
  ru: "Чтобы всё-таки записать, откройте в Swarm «Встречи» → «Позвать бота на созвон» и вставьте ссылку на звонок.",
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function shownTitle(title: string | null, lang: Lang): string {
  return escapeHtml(title ?? NO_TITLE[lang]);
}

function platformName(platform: string | null | undefined): Record<Lang, string> {
  const name = typeof platform === "string" ? PLATFORM_NAME[platform] : undefined;
  return name === undefined ? { en: "another service", ru: "другом сервисе" } : { en: name, ru: name };
}

function skipText(reason: Loud, skip: DispatchSkip): Record<Lang, string> {
  const t = { en: shownTitle(skip.title, "en"), ru: shownTitle(skip.title, "ru") };
  switch (reason) {
    case "unsupported_platform": {
      const p = platformName(skip.platform);
      return {
        en:
          `⚠️ <b>${t.en}</b> is on ${p.en}, and scriba only joins Google Meet calls — it won't come to this meeting. If you need a recording, record it with bumblebee.`,
        ru:
          `⚠️ «<b>${t.ru}</b>» идёт в ${p.ru}, а scriba ходит только в Google Meet — на эту встречу он не придёт. Если запись нужна, запишите её через bumblebee.`,
      };
    }
    case "unrecognized_link":
      return {
        en:
          `⚠️ <b>${t.en}</b>: scriba couldn't read the Google Meet link in the calendar event, so it won't join on its own. ${MANUAL.en}`,
        ru:
          `⚠️ «<b>${t.ru}</b>»: scriba не смог разобрать ссылку на Google Meet в событии календаря и сам не придёт. ${MANUAL.ru}`,
      };
    case "calendar_not_connected":
      return {
        en:
          "⚠️ scriba autostart is on for you, but no Google Calendar is connected — the bot can't see your meetings and won't come to any of them. Connect the calendar in your Swarm profile → Connections. " +
          MANUAL.en,
        ru:
          "⚠️ У вас включён автозапуск scriba, но Google-календарь не подключён — бот не видит ваших встреч и не придёт ни на одну. Подключите календарь в профиле Swarm → «Подключения». " +
          MANUAL.ru,
      };
    case "calendar_token_dead":
      return {
        en:
          "⚠️ scriba lost access to your Google Calendar (it expired or was revoked) — until you reconnect it, the bot won't come to your meetings on its own. Reconnect it in your Swarm profile → Connections. " +
          MANUAL.en,
        ru:
          "⚠️ scriba потерял доступ к вашему Google-календарю (истёк или отозван) — пока его не переподключить, бот сам на встречи не придёт. Переподключите календарь в профиле Swarm → «Подключения». " +
          MANUAL.ru,
      };
  }
}

function both(text: Record<Lang, string>): string {
  return `${text.en}\n\n${text.ru}`;
}

/** Дата и час в часовом поясе команды. */
function teamClock(nowMs: number): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

function isLoud(reason: SkipReason): reason is Loud {
  return LOUD.has(reason);
}

/** Пропуск из прохода по календарю → сообщение, или null, если будить не о чем. */
export function skipNotice(skip: DispatchSkip, nowMs: number): MissedNotice | null {
  if (!isLoud(skip.reason)) return null;
  const html = both(skipText(skip.reason, skip));
  const kind = `autojoin_${skip.reason}`;
  if (PERSON_LEVEL.has(skip.reason)) {
    const clock = teamClock(nowMs);
    if (clock.hour < PERSON_NOTICE_FROM_HOUR || clock.hour >= PERSON_NOTICE_UNTIL_HOUR) return null;
    return { recipient: skip.invited_by, meetingKey: `autojoin:${clock.date}`, kind, html };
  }
  // Причина встречи без ключа встречи — сбой отбора, а не повод слать без счёта.
  if (skip.calendar_key === null) return null;
  return { recipient: skip.invited_by, meetingKey: skip.calendar_key, kind, html };
}

/** Забранное задание, как его видит проверка «дошёл ли бот». */
export interface ArrivalJob {
  calendar_key: string;
  invited_by: number;
  title: string | null;
  join_url: string;
  taken_at: string | null;
  ends_at: string;
}

/** Что известно о встрече: бот подал heartbeat · человеку по встрече уже ушла нотиса бота. */
export interface ArrivalEvidence {
  botSeen: boolean;
  noticeSent: boolean;
}

/** Пора ли спрашивать, дошёл ли бот: запас после забора прошёл, встреча ещё идёт. */
export function arrivalCheckDue(job: ArrivalJob, nowMs: number): boolean {
  if (job.taken_at === null) return false;
  const taken = Date.parse(job.taken_at);
  const ends = Date.parse(job.ends_at);
  if (Number.isNaN(taken) || Number.isNaN(ends)) return false;
  return taken + ARRIVAL_GRACE_MS <= nowMs && nowMs < ends;
}

/**
 * Бот забрал задание и не подал признака жизни, а сам человеку ничего не сказал (контейнер упал до
 * двери, оркестратор умер после забора) → сообщение. Иначе null: бот пишет, или уже объяснил отказ.
 */
export function notArrivedNotice(job: ArrivalJob, evidence: ArrivalEvidence): MissedNotice | null {
  if (evidence.botSeen || evidence.noticeSent) return null;
  const url = escapeHtml(job.join_url);
  const html = both({
    en: `⚠️ <b>${
      shownTitle(job.title, "en")
    }</b>: scriba was due to join from your calendar but hasn't made it into the call — the meeting is not being recorded. ${MANUAL.en}\n<code>${url}</code>`,
    ru: `⚠️ «<b>${
      shownTitle(job.title, "ru")
    }</b>»: scriba должен был прийти по календарю, но в звонок так и не попал — встреча не записывается. ${MANUAL.ru}\n<code>${url}</code>`,
  });
  return { recipient: job.invited_by, meetingKey: job.calendar_key, kind: "autojoin_not_arrived", html };
}
