// Разбор запроса, счёт по журналу и решение — вся логика ручки. index.ts подставляет настоящие
// Supabase и Telegram, тест — поддельные. Так проверяется ровно то, что ломается: кому ушло,
// что ушло, сколько раз позволено и что вернулось вызывающему, когда не ушло.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, type AgentIdentity, resolveActingIdentity } from "../_shared/agent-auth.ts";
import {
  NOTICE_LIMITS,
  NoticeError,
  type ParsedNotice,
  parseNotice,
  renderNotice,
  scheduleAfter,
} from "../_shared/notices.ts";

export interface NoticeDeps {
  supabase: SupabaseClient;
  /** Отправка в Telegram. Обязана БРОСАТЬ, если сообщение не принято: молчаливый успех недопустим. */
  sendTelegram: (chatId: number, text: string) => Promise<void>;
}

/** Таблица-журнал: она же счётчик. Канон схемы — migrations/20260926080446_meeting_notices.sql. */
const JOURNAL = "meeting_notices";
/** Функция резерва в базе — она решает, можно ли слать (та же миграция). */
const RESERVE_FN = "meeting_notice_reserve";

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
  claim_owner: number | null;
}

type Checked = { title: string | null } | Response;

/**
 * Встречный отказ: встреча обязана существовать, быть из воркспейса агента и принадлежать тому,
 * кому уходит сообщение. Название — из строки встречи: присланное из контейнера сервер не с чем
 * было бы сверить, и перепутанная сессия отправила бы человеку чужое название.
 */
async function checkMeeting(deps: NoticeDeps, meetingId: string, identity: AgentIdentity): Promise<Checked> {
  const { data, error } = await deps.supabase
    .from("meetings")
    .select("title, group_id, claim_owner")
    .eq("id", meetingId)
    .maybeSingle();
  if (error) {
    console.error(`meeting-notice: встречу ${meetingId} не прочитать: ${error.message}`);
    return json({ ok: false, delivered: false, error: "meeting lookup failed — notice not sent" }, 503);
  }
  const meeting = data as MeetingRow | null;
  if (meeting === null) {
    console.warn(`meeting-notice: встречи ${meetingId} нет`);
    return json({ ok: false, delivered: false, error: "meeting not found — claim it first" }, 404);
  }
  if (meeting.group_id !== identity.groupId) {
    // Изоляция по воркспейсу — та же, что у остальных эндпоинтов.
    console.warn(`meeting-notice: встреча ${meetingId} из ${meeting.group_id}, агент действует в ${identity.groupId}`);
    return json({ ok: false, delivered: false, error: "meeting belongs to another workspace" }, 403);
  }
  if (meeting.claim_owner !== identity.telegramId) {
    // Уведомляемый обязан быть владельцем встречи: иначе токен бота рассылал бы сообщения о
    // чужих встречах. Перехватил запись другой участник — сказать этому человеку нечего.
    console.warn(
      `meeting-notice: встреча ${meetingId} принадлежит ${meeting.claim_owner}, а не ${identity.telegramId}`,
    );
    return json({ ok: false, delivered: false, error: "the person is not the owner of this meeting" }, 403);
  }
  return { title: meeting.title };
}

/** Postgres: нарушение уникальности — страховочный индекс журнала поймал одинаковый кортеж. */
const UNIQUE_VIOLATION = "23505";

type Reserved = { id: number; attempt: number } | Response;

/**
 * Занять слот отправки. Решение принимает БАЗА (`meeting_notice_reserve`): под блокировкой
 * получателя она считает журнал, сверяет потолки и заводит строку `sending` — одной транзакцией.
 * Счёт в коде и вставка отдельным запросом пропускали параллельные вызовы по разным встречам и
 * разным видам: каждый видел журнал до вставок соседей, и потолок на сутки не держал ничего.
 */
async function reserve(deps: NoticeDeps, notice: ParsedNotice, recipientId: number): Promise<Reserved> {
  const { data, error } = await deps.supabase.rpc(RESERVE_FN, {
    p_recipient: recipientId,
    p_meeting_id: notice.scope.type === "meeting" ? notice.scope.meetingId : null,
    p_meeting_key: notice.scope.type === "calendar" ? notice.scope.meetingKey : null,
    p_kind: notice.kind,
    p_limits: NOTICE_LIMITS,
  });
  if (error?.code === UNIQUE_VIOLATION) {
    console.warn(`meeting-notice: «${notice.kind}» уже отправляется параллельным вызовом`);
    return json({ ok: false, delivered: false, error: "this notice is already being sent", should_leave: true }, 409);
  }
  const answer = data as { id?: unknown; attempt?: unknown; refused?: unknown } | null;
  if (error || answer === null) {
    // Нечитаемый журнал = неизвестный счёт. Отправлять вслепую нельзя: именно так поток
    // уведомлений и становится неограниченным. Отказ громкий, бот его увидит.
    console.error(`meeting-notice: журнал не принял резерв: ${error?.message ?? "empty answer"}`);
    return json({ ok: false, delivered: false, error: "notice journal unavailable — notice not sent" }, 503);
  }
  if (typeof answer.refused === "string") {
    console.warn(`meeting-notice: «${notice.kind}» по ${describe(notice)} отклонено: ${answer.refused}`);
    return json({ ok: false, delivered: false, error: answer.refused, should_leave: true }, 409);
  }
  if (typeof answer.id !== "number" || typeof answer.attempt !== "number") {
    console.error(`meeting-notice: резерв вернул непонятное: ${JSON.stringify(answer)}`);
    return json({ ok: false, delivered: false, error: "notice journal answered garbage — notice not sent" }, 503);
  }
  return { id: answer.id, attempt: answer.attempt };
}

async function markStatus(deps: NoticeDeps, id: number, status: "sent" | "failed"): Promise<boolean> {
  const { error } = await deps.supabase.from(JOURNAL).update({ status }).eq("id", id);
  if (error) console.error(`meeting-notice: статус ${status} для записи журнала ${id} не записан: ${error.message}`);
  return !error;
}

function describe(notice: ParsedNotice): string {
  return notice.scope.type === "meeting" ? `встрече ${notice.scope.meetingId}` : `ключу ${notice.scope.meetingKey}`;
}

async function parse(req: Request): Promise<ParsedNotice | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  try {
    return parseNotice(raw);
  } catch (e) {
    if (e instanceof NoticeError) {
      console.warn(`meeting-notice: запрос не разобран (${e.status}): ${e.message}`);
      return json({ ok: false, error: e.message }, e.status);
    }
    throw e;
  }
}

export async function handleNotice(req: Request, deps: NoticeDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only: send {kind, meeting_id | meeting_key, lang?, detail?}" }, 405);
  }

  const identity = await identify(req, deps);
  if (identity instanceof Response) return identity;
  const notice = await parse(req);
  if (notice instanceof Response) return notice;

  let title = notice.title;
  if (notice.scope.type === "meeting") {
    const checked = await checkMeeting(deps, notice.scope.meetingId, identity);
    if (checked instanceof Response) return checked;
    title = checked.title;
  }

  const slot = await reserve(deps, notice, identity.telegramId);
  if (slot instanceof Response) return slot;
  const journalId = slot.id;
  const schedule = scheduleAfter(notice.kind, slot.attempt);

  try {
    await deps.sendTelegram(identity.telegramId, renderNotice(notice, title, slot.attempt));
  } catch (e) {
    // Самое дорогое место блока: если проглотить ошибку доставки и вернуть 200, то отказ,
    // ради громкости которого всё и строилось, станет молчаливым — причём дважды.
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`meeting-notice: уведомление «${notice.kind}» НЕ доставлено ${identity.telegramId}: ${reason}`);
    // Номер освобождается: сбой Telegram не должен съесть единственный повтор.
    const freed = await markStatus(deps, journalId, "failed");
    return json({ ok: false, delivered: false, retry_allowed: freed, error: `notice not delivered: ${reason}` }, 502);
  }

  // Не записался статус — строка остаётся `sending` и продолжает занимать номер: лишнего
  // сообщения это не даст, а человек своё уже получил. Громко в лог, вызывающему — успех.
  await markStatus(deps, journalId, "sent");
  console.log(
    `meeting-notice: «${notice.kind}» (отправка ${slot.attempt}) доставлено ${identity.telegramId} по ${
      describe(notice)
    }`,
  );
  return json({
    ok: true,
    delivered: true,
    attempt: slot.attempt,
    should_leave: schedule.shouldLeave,
    next_reminder_in_s: schedule.nextReminderInSeconds,
  });
}
