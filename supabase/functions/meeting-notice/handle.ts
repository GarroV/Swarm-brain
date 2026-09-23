// Разбор запроса, счёт по журналу и решение — вся логика ручки. index.ts подставляет настоящие
// Supabase и Telegram, тест — поддельные. Так проверяется ровно то, что ломается: кому ушло,
// что ушло, сколько раз позволено и что вернулось вызывающему, когда не ушло.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, type AgentIdentity, resolveActingIdentity } from "../_shared/agent-auth.ts";
import {
  decideDelivery,
  type NoticeKind,
  NoticeError,
  type NoticeLedger,
  type ParsedNotice,
  parseNotice,
  renderNotice,
} from "../_shared/notices.ts";

export interface NoticeDeps {
  supabase: SupabaseClient;
  /** Отправка в Telegram. Обязана БРОСАТЬ, если сообщение не принято: молчаливый успех недопустим. */
  sendTelegram: (chatId: number, text: string) => Promise<void>;
}

/** Таблица-журнал: она же счётчик. Канон схемы — migrations/20260923120000_meeting_notices.sql. */
const JOURNAL = "meeting_notices";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function identify(req: Request, deps: NoticeDeps): Promise<AgentIdentity | Response> {
  try {
    return await resolveActingIdentity(deps.supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) {
      // Причина остаётся в логе: разбор «почему бот молчит» иначе упирается в неотличимые 401.
      console.warn(`meeting-notice: вход отклонён (${e.status}): ${e.message}`);
      return json({ ok: false, error: e.message }, e.status);
    }
    throw e;
  }
}

interface MeetingRow {
  title: string | null;
  group_id: string | null;
}

/**
 * Строка встречи по ключу — если она уже есть.
 *
 * Её может не быть, и это норма: уведомление о двери приходит РАНЬШЕ, чем встреча появляется в
 * базе (строка создаётся на claim, то есть после того, как бота впустили). Когда строка есть,
 * она — источник правды о названии: название из тела запроса приходит из контейнера, и
 * перепутанная сессия отправила бы человеку чужое название, которое сервер не с чем сверить.
 */
async function lookupMeeting(deps: NoticeDeps, meetingKey: string): Promise<MeetingRow | null | "error"> {
  const { data, error } = await deps.supabase
    .from("meetings")
    .select("title, group_id")
    .eq("identity_key", meetingKey)
    .limit(1);
  if (error) {
    console.error(`meeting-notice: встречу ${meetingKey} не прочитать: ${error.message}`);
    return "error";
  }
  const rows = (data ?? []) as MeetingRow[];
  return rows.length > 0 ? rows[0] : null;
}

/** Сколько уведомлений уже ушло этому человеку по этой встрече. Счёт ведёт сервер, не бот. */
async function readLedger(
  deps: NoticeDeps,
  meetingKey: string,
  recipientId: number,
  kind: NoticeKind,
): Promise<NoticeLedger | "error"> {
  const { data, error } = await deps.supabase
    .from(JOURNAL)
    .select("kind")
    .eq("meeting_key", meetingKey)
    .eq("recipient_id", recipientId);
  if (error) {
    // Нечитаемый журнал = неизвестный счёт. Отправлять вслепую нельзя: именно так поток
    // уведомлений и становится неограниченным. Отказ громкий, бот его увидит.
    console.error(`meeting-notice: журнал по ${meetingKey} не прочитать: ${error.message}`);
    return "error";
  }
  const rows = (data ?? []) as { kind: string }[];
  return { kindCount: rows.filter((r) => r.kind === kind).length, totalCount: rows.length };
}

export async function handleNotice(req: Request, deps: NoticeDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only: send {kind, meeting_key, title?, lang?, detail?}" }, 405);
  }

  const identity = await identify(req, deps);
  if (identity instanceof Response) return identity;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }

  let notice: ParsedNotice;
  try {
    notice = parseNotice(raw);
  } catch (e) {
    if (e instanceof NoticeError) {
      console.warn(`meeting-notice: запрос не разобран (${e.status}): ${e.message}`);
      return json({ ok: false, error: e.message }, e.status);
    }
    throw e;
  }

  const meeting = await lookupMeeting(deps, notice.meetingKey);
  if (meeting === "error") {
    return json({ ok: false, delivered: false, error: "meeting lookup failed — notice not sent" }, 503);
  }
  if (meeting !== null && meeting.group_id !== null && meeting.group_id !== identity.groupId) {
    // Изоляция по воркспейсу — та же, что у остальных эндпоинтов. Заодно ловит перепутанную
    // сессию контейнера: чужая встреча не станет уведомлением с чужим названием.
    console.warn(
      `meeting-notice: встреча ${notice.meetingKey} из воркспейса ${meeting.group_id}, ` +
        `а действуем за ${identity.telegramId} из ${identity.groupId}`,
    );
    return json({ ok: false, error: "meeting belongs to another workspace" }, 403);
  }

  const ledger = await readLedger(deps, notice.meetingKey, identity.telegramId, notice.kind);
  if (ledger === "error") {
    return json({ ok: false, delivered: false, error: "notice journal unavailable — notice not sent" }, 503);
  }

  const decision = decideDelivery(notice.kind, ledger);
  if (!decision.allow) {
    console.warn(`meeting-notice: «${notice.kind}» по ${notice.meetingKey} отклонено: ${decision.reason}`);
    return json({ ok: false, delivered: false, error: decision.reason, should_leave: true }, 409);
  }

  // Название из базы сильнее присланного: см. lookupMeeting.
  const title = meeting?.title ?? notice.title;
  const text = renderNotice(notice, title, decision.attempt);
  try {
    await deps.sendTelegram(identity.telegramId, text);
  } catch (e) {
    // Самое дорогое место блока: если проглотить ошибку доставки и вернуть 200, то отказ,
    // ради громкости которого всё и строилось, станет молчаливым — причём дважды.
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`meeting-notice: уведомление «${notice.kind}» НЕ доставлено ${identity.telegramId}: ${reason}`);
    return json({ ok: false, delivered: false, error: `notice not delivered: ${reason}` }, 502);
  }

  // Журнал пополняется ПОСЛЕ доставки: иначе недоставленное уведомление съедало бы квоту и
  // повторить его было бы нельзя — человек остался бы без сигнала навсегда.
  const { error: journalError } = await deps.supabase.from(JOURNAL).insert({
    meeting_key: notice.meetingKey,
    recipient_id: identity.telegramId,
    kind: notice.kind,
  });
  if (journalError) {
    // Сообщение человек получил, но счёт не сдвинулся — следующий вызов может продублировать.
    // Молчать об этом нельзя: вызывающий узнаёт из ответа, лог — из строки ниже.
    console.error(`meeting-notice: «${notice.kind}» доставлено, но в журнал не записано: ${journalError.message}`);
  }

  console.log(
    `meeting-notice: «${notice.kind}» (отправка ${decision.attempt}) доставлено ${identity.telegramId} по ${notice.meetingKey}`,
  );
  return json({
    ok: true,
    delivered: true,
    counted: journalError === null,
    attempt: decision.attempt,
    should_leave: decision.shouldLeave,
    next_reminder_in_s: decision.nextReminderInSeconds,
  });
}
