// Разбор запроса, счёт по журналу и решение — вся логика ручки. index.ts подставляет настоящие
// Supabase и Telegram, тест — поддельные. Так проверяется ровно то, что ломается: кому ушло,
// что ушло, сколько раз позволено и что вернулось вызывающему, когда не ушло.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, type AgentIdentity, resolveActingIdentity } from "../_shared/agent-auth.ts";
import {
  DAY_SECONDS,
  decideDelivery,
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
  /** Часы суточного счёта; подменяются тестом. */
  now?: () => Date;
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

interface JournalRow {
  kind: string;
  meeting_id: string | null;
}

/**
 * Что уже ушло этому человеку: по этой встрече (за всё время) и по всем встречам за сутки.
 * Недоставленное (`failed`) не в счёт — его номер свободен для повтора.
 */
async function readLedger(
  deps: NoticeDeps,
  notice: ParsedNotice,
  recipientId: number,
  now: Date,
): Promise<NoticeLedger | "error"> {
  const scoped = deps.supabase.from(JOURNAL).select("kind, meeting_id").eq("recipient_id", recipientId)
    .neq("status", "failed");
  const inScope = notice.scope.type === "meeting"
    ? scoped.eq("meeting_id", notice.scope.meetingId)
    : scoped.eq("meeting_key", notice.scope.meetingKey);
  const since = new Date(now.getTime() - DAY_SECONDS * 1000).toISOString();
  const [scope, day] = await Promise.all([
    inScope,
    deps.supabase.from(JOURNAL).select("kind, meeting_id").eq("recipient_id", recipientId)
      .neq("status", "failed").gte("sent_at", since),
  ]);
  const error = scope.error ?? day.error;
  if (error) {
    // Нечитаемый журнал = неизвестный счёт. Отправлять вслепую нельзя: именно так поток
    // уведомлений и становится неограниченным. Отказ громкий, бот его увидит.
    console.error(`meeting-notice: журнал не прочитать: ${error.message}`);
    return "error";
  }
  const scopeRows = (scope.data ?? []) as JournalRow[];
  const dayRows = (day.data ?? []) as JournalRow[];
  return {
    kindCount: scopeRows.filter((r) => r.kind === notice.kind).length,
    totalCount: scopeRows.length,
    dayCount: dayRows.length,
    unboundDayCount: dayRows.filter((r) => r.meeting_id === null).length,
  };
}

/** Postgres: нарушение уникальности. Второй вызов с тем же номером отправки упёрся в индекс. */
const UNIQUE_VIOLATION = "23505";

/**
 * Занять номер отправки ДО отправки. Уникальный индекс журнала делает это атомарным: из двух
 * одновременных вызовов человеку уйдёт одно сообщение, второй получит 409.
 */
async function reserve(
  deps: NoticeDeps,
  notice: ParsedNotice,
  recipientId: number,
  attempt: number,
): Promise<number | Response> {
  const { data, error } = await deps.supabase.from(JOURNAL).insert({
    meeting_id: notice.scope.type === "meeting" ? notice.scope.meetingId : null,
    meeting_key: notice.scope.type === "calendar" ? notice.scope.meetingKey : null,
    recipient_id: recipientId,
    kind: notice.kind,
    attempt,
    status: "sending",
  }).select("id").single();
  if (error?.code === UNIQUE_VIOLATION) {
    console.warn(`meeting-notice: «${notice.kind}» #${attempt} уже отправляется параллельным вызовом`);
    return json({ ok: false, delivered: false, error: "this notice is already being sent", should_leave: true }, 409);
  }
  if (error || !data) {
    console.error(`meeting-notice: журнал не принял запись: ${error?.message ?? "no row returned"}`);
    return json({ ok: false, delivered: false, error: "notice journal unavailable — notice not sent" }, 503);
  }
  return (data as { id: number }).id;
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

  const ledger = await readLedger(deps, notice, identity.telegramId, deps.now?.() ?? new Date());
  if (ledger === "error") {
    return json({ ok: false, delivered: false, error: "notice journal unavailable — notice not sent" }, 503);
  }
  const decision = decideDelivery(notice, ledger);
  if (!decision.allow) {
    console.warn(`meeting-notice: «${notice.kind}» по ${describe(notice)} отклонено: ${decision.reason}`);
    return json({ ok: false, delivered: false, error: decision.reason, should_leave: true }, 409);
  }

  const journalId = await reserve(deps, notice, identity.telegramId, decision.attempt);
  if (journalId instanceof Response) return journalId;

  try {
    await deps.sendTelegram(identity.telegramId, renderNotice(notice, title, decision.attempt));
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
    `meeting-notice: «${notice.kind}» (отправка ${decision.attempt}) доставлено ${identity.telegramId} по ${
      describe(notice)
    }`,
  );
  return json({
    ok: true,
    delivered: true,
    attempt: decision.attempt,
    should_leave: decision.shouldLeave,
    next_reminder_in_s: decision.nextReminderInSeconds,
  });
}
