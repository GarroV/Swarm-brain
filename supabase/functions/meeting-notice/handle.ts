// Разбор запроса и решение — без сети. index.ts подставляет настоящие Supabase и Telegram,
// тест — поддельные. Так проверяется ровно то, что ломается: кому ушло, что ушло и что
// вернулось вызывающему, когда не ушло.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, type AgentIdentity, resolveActingIdentity } from "../_shared/agent-auth.ts";
import { doorPolicy, NoticeError, parseNotice, renderNotice } from "../_shared/notices.ts";

export interface NoticeDeps {
  supabase: SupabaseClient;
  /** Отправка в Telegram. Обязана БРОСАТЬ, если сообщение не принято: молчаливый успех здесь недопустим. */
  sendTelegram: (chatId: number, text: string) => Promise<void>;
}

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

export async function handleNotice(req: Request, deps: NoticeDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only: send {kind, title?, attempt?, lang?, detail?}" }, 405);
  }

  const identity = await identify(req, deps);
  if (identity instanceof Response) return identity;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }

  let notice;
  try {
    notice = parseNotice(raw);
  } catch (e) {
    if (e instanceof NoticeError) {
      console.warn(`meeting-notice: запрос не разобран (${e.status}): ${e.message}`);
      // 409 — потолок двери. Боту всё равно нужно сказать «уходи», иначе он останется висеть
      // под дверью до конца встречи, и человек про это не узнает ничего нового.
      return json({ ok: false, error: e.message, ...(e.status === 409 ? { should_leave: true } : {}) }, e.status);
    }
    throw e;
  }

  const decision = doorPolicy(notice);
  const text = renderNotice(notice);
  try {
    await deps.sendTelegram(identity.telegramId, text);
  } catch (e) {
    // Самое дорогое место блока: если проглотить ошибку доставки и вернуть 200, то отказ,
    // ради громкости которого всё и строилось, станет молчаливым — причём дважды.
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`meeting-notice: уведомление «${notice.kind}» НЕ доставлено ${identity.telegramId}: ${reason}`);
    return json({ ok: false, delivered: false, error: `notice not delivered: ${reason}` }, 502);
  }

  console.log(`meeting-notice: «${notice.kind}» (попытка ${notice.attempt}) доставлено ${identity.telegramId}`);
  return json({
    ok: true,
    delivered: true,
    should_leave: decision.shouldLeave,
    next_reminder_in_s: decision.nextReminderInSeconds,
  });
}
