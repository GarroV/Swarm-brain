// Разбор запроса, счёт по журналу и решение — вся логика ручки. index.ts подставляет настоящие
// Supabase и Telegram, тест — поддельные. Так проверяется ровно то, что ломается: кому ушло,
// что ушло, сколько раз позволено и что вернулось вызывающему, когда не ушло.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, type AgentIdentity, resolveActingIdentity } from "../_shared/agent-auth.ts";
import { assertGrantMeeting, GrantScopeError } from "../_shared/agent-grant.ts";
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
  co_owners: number[] | null;
}

type Checked = { title: string | null; coOwners: number[] } | Response;

/**
 * Встречный отказ: встреча обязана существовать, быть из воркспейса агента и принадлежать тому,
 * кому уходит сообщение. Название — из строки встречи: присланное из контейнера сервер не с чем
 * было бы сверить, и перепутанная сессия отправила бы человеку чужое название.
 */
async function checkMeeting(deps: NoticeDeps, meetingId: string, identity: AgentIdentity): Promise<Checked> {
  const { data, error } = await deps.supabase
    .from("meetings")
    .select("title, group_id, claim_owner, co_owners")
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
    // Изоляция по воркспейсу — та же, что у остальных эндпоинтов. Склеенная общая встреча (запись
    // человека из B в строке A, решение 05.11.2026) сюда тоже попадает и уведомления НЕ получает
    // намеренно: расширить, кому уходит сообщение, можно только по «да» владельца на условие.
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
  return { title: meeting.title, coOwners: meeting.co_owners ?? [] };
}

/**
 * Со-получатели встречного уведомления (решение 12.11.2026): остальные участники встречи, у
 * которых есть вход в Swarm, — `meetings.co_owners`, их заполняет meeting-claim ДО захода бота.
 * Список берётся ТОЛЬКО из строки встречи на сервере, не из тела запроса. Отрицательный id — веб-
 * пользователь без Telegram, написать ему нечем. Каждый обязан существовать в `allowed_users`
 * воркспейса встречи (журнал ссылается на эту таблицу). Не прочиталось — уведомление уйдёт одному
 * запустившему, как раньше: ошибка пишется громко, но доставку ему не роняет.
 */
async function coRecipients(
  deps: NoticeDeps,
  groupId: string,
  coOwners: number[],
  launcherId: number,
): Promise<number[]> {
  const candidates = [...new Set(coOwners.filter((id) => Number.isInteger(id) && id > 0 && id !== launcherId))];
  if (candidates.length === 0) return [];
  const { data, error } = await deps.supabase
    .from("allowed_users")
    .select("telegram_id")
    .eq("group_id", groupId)
    .in("telegram_id", candidates);
  if (error) {
    console.error(
      `meeting-notice: участников встречи не прочитать, уведомление уйдёт одному запустившему: ${error.message}`,
    );
    return [];
  }
  const known = new Set((data as Array<{ telegram_id: number }> | null ?? []).map((r) => Number(r.telegram_id)));
  return candidates.filter((id) => known.has(id));
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

/**
 * Бот говорит человеку только о встрече своего пропуска (T165): встречный отказ — о встрече, к
 * которой пропуск привязан, до-встречный — о событии его задания. Название до-встречного отказа
 * у бота берётся из пропуска (из календаря, сервером), а не из тела: текст, который человек видит
 * от бота Swarm, не пишет контейнер. Людям их токен — их личность, им сверять нечего.
 */
function grantScope(identity: AgentIdentity, notice: ParsedNotice): { title: string | null } | Response {
  if (identity.kind !== "bot") return { title: notice.title };
  try {
    if (notice.scope.type === "meeting") {
      assertGrantMeeting(identity, notice.scope.meetingId);
      return { title: null };
    }
    const grant = identity.grant;
    if (!grant || grant.basis !== "calendar" || grant.calendarKey !== notice.scope.meetingKey) {
      throw new GrantScopeError("service agent: the grant does not cover this meeting");
    }
    return { title: grant.title };
  } catch (e) {
    if (!(e instanceof GrantScopeError)) throw e;
    console.warn(`meeting-notice: пропуск не открывает ${describe(notice)}: ${e.message}`);
    return json({ ok: false, delivered: false, error: e.message }, 403);
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

  const granted = grantScope(identity, notice);
  if (granted instanceof Response) return granted;

  let title = granted.title;
  let coOwners: number[] = [];
  if (notice.scope.type === "meeting") {
    const checked = await checkMeeting(deps, notice.scope.meetingId, identity);
    if (checked instanceof Response) return checked;
    title = checked.title;
    coOwners = checked.coOwners;
  }

  // Встречное уведомление видят все участники встречи, а не только тот, от чьего имени бот. Ничего,
  // кроме строк журнала `meeting_notices` и очереди Telegram, это не трогает: другие встречи
  // получателей, их записи и claims остаются как были (встречи самостоятельны).
  const coIds = notice.scope.type === "meeting" && coOwners.length > 0 && identity.groupId !== null
    ? await coRecipients(deps, identity.groupId, coOwners, identity.telegramId)
    : [];
  const coDelivery = Promise.all(coIds.map((id) => deliverToCoRecipient(deps, notice, title, id)));

  const own = await deliverToLauncher(deps, notice, title, identity.telegramId);
  await coDelivery;
  return own;
}

/**
 * Запустившему: отказ или недоставка видны боту (409 с `should_leave` / 502), расписание — по ЕГО
 * номеру отправки. Решение «уходить» от числа со-получателей не зависит.
 */
async function deliverToLauncher(
  deps: NoticeDeps,
  notice: ParsedNotice,
  title: string | null,
  recipientId: number,
): Promise<Response> {
  const slot = await reserve(deps, notice, recipientId);
  if (slot instanceof Response) return slot;
  const journalId = slot.id;
  const schedule = scheduleAfter(notice.kind, slot.attempt);

  try {
    await deps.sendTelegram(recipientId, renderNotice(notice, title, slot.attempt));
  } catch (e) {
    // Самое дорогое место блока: если проглотить ошибку доставки и вернуть 200, то отказ,
    // ради громкости которого всё и строилось, станет молчаливым — причём дважды.
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`meeting-notice: уведомление «${notice.kind}» НЕ доставлено ${recipientId}: ${reason}`);
    // Номер освобождается: сбой Telegram не должен съесть единственный повтор.
    const freed = await markStatus(deps, journalId, "failed");
    return json({ ok: false, delivered: false, retry_allowed: freed, error: `notice not delivered: ${reason}` }, 502);
  }

  // Не записался статус — строка остаётся `sending` и продолжает занимать номер: лишнего
  // сообщения это не даст, а человек своё уже получил. Громко в лог, вызывающему — успех.
  await markStatus(deps, journalId, "sent");
  console.log(
    `meeting-notice: «${notice.kind}» (отправка ${slot.attempt}) доставлено ${recipientId} по ${describe(notice)}`,
  );
  return json({
    ok: true,
    delivered: true,
    attempt: slot.attempt,
    should_leave: schedule.shouldLeave,
    next_reminder_in_s: schedule.nextReminderInSeconds,
  });
}

/**
 * Со-участнику: свой слот в журнале и свои потолки (номер отправки, суточный счёт — на человека).
 * Всё, что пошло не так, — только в лог: боту отвечает запустивший, и чужой сбой (потолок, закрытый
 * чат, Telegram) не должен ни ронять его доставку, ни давать боту ложный 502. Не бросает никогда.
 */
async function deliverToCoRecipient(
  deps: NoticeDeps,
  notice: ParsedNotice,
  title: string | null,
  recipientId: number,
): Promise<void> {
  try {
    const slot = await reserve(deps, notice, recipientId);
    if (slot instanceof Response) {
      console.warn(`meeting-notice: «${notice.kind}» участнику ${recipientId} не отправлено: слот не выдан`);
      return;
    }
    try {
      await deps.sendTelegram(recipientId, renderNotice(notice, title, slot.attempt));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`meeting-notice: «${notice.kind}» участнику ${recipientId} НЕ доставлено: ${reason}`);
      await markStatus(deps, slot.id, "failed");
      return;
    }
    await markStatus(deps, slot.id, "sent");
    console.log(`meeting-notice: «${notice.kind}» (отправка ${slot.attempt}) доставлено участнику ${recipientId}`);
  } catch (e) {
    console.error(`meeting-notice: участнику ${recipientId} — сбой ${e instanceof Error ? e.message : String(e)}`);
  }
}
