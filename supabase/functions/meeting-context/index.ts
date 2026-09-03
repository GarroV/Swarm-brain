// «Что было в прошлый раз» для панели заметок рекордера (issue #226).
//
// Рекордер начал запись → спрашивает контекст → показывает в панели блок «С прошлого раза»:
// тезисы ПОСЛЕДНЕЙ встречи с этой стороной и задачи, привязанные к той встрече. LLM здесь нет:
// тезисы и задачи уже лежат в базе, поэтому это обычная выборка, а не анализ.
//
// Решения владельца 03.09.2026: «эта сторона = эта страна», «тезисы последней встречи»,
// «функционал нужен именно к регулярным встречам» (созвон с Болгарией → тезисы прошлого
// созвона с Болгарией, чтобы по ним пройтись). И отдельно: задачи с тезисами «никак и не
// должны соприкасаться — это разные вещи». Поэтому две НЕЗАВИСИМЫЕ выборки: тезисы у
// последней встречи этой страны, задачи — у самой страны, безотносительно той встречи.
//
// Деплой: supabase functions deploy meeting-context --no-verify-jwt (хитит рекордер с Bearer smcp_).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";
import { contextCountry, tezisyPreview, PREVIEW_LIMITS } from "../_shared/meeting-context.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** Сколько задач отдаём. Свёрнуто панель показывает 2, раскрытая — весь список.
 *  По стране их бывает больше десятка (на проде RS 15, SI 13), полный список — в вебе. */
const TASK_LIMIT = 10;
/** Статусы, которых в панели быть не должно. */
//  • done/cancelled — закрытые;
//  • pending — задачи, извлечённые из встреч и НЕ подтверждённые человеком (issue #208):
//    на проде их 32, с 30.06, и в вебе они не видны вообще. Показать их как «висят за этой
//    стороной» = вывалить полтора месяца необработанного импорта;
//  • backlog — колонка доски спринта, а спринтами не пользуются (решение владельца, issue #216).
const HIDDEN_TASK_STATUSES = ["done", "cancelled", "pending", "backlog"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Body = {
  /** Название текущей встречи — ЕДИНСТВЕННЫЙ сигнал страны («Dodo Pizza Bulgaria»). */
  title?: string | null;
  /** Запись текущей встречи, если она уже создана — её саму в «прошлый раз» не берём. */
  exclude_entry_id?: string | null;
};

// Заголовок записи: у entries отдельной колонки нет — он живёт в metadata.title, иначе
// берём первую строку содержимого (тот же порядок, что в вебе у deriveEntryTitle).
function entryTitle(meta: Record<string, unknown> | null, content: string | null): string | null {
  const t = (meta?.title as string | undefined)?.trim();
  if (t) return t;
  const first = (content ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  return first ? first.replace(/^#+\s*/, "").slice(0, 120) : null;
}

Deno.serve(async (req: Request) => {
  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ error: e.message }, 401);
    throw e;
  }

  const body = (req.method === "POST" ? await req.json().catch(() => ({})) : {}) as Body;
  const viewerId = identity.telegramId;

  // Воркспейс смотрящего: контекст не пересекает границу воркспейса, как и всё остальное.
  const { data: userRow } = await supabase
    .from("allowed_users").select("group_id").eq("telegram_id", viewerId).maybeSingle();
  const groupId = (userRow as { group_id?: string | null } | null)?.group_id ?? null;

  // Только явное указание в названии — требование владельца «максимальное совпадение».
  // Не определили (или кросс-маркет) → блока нет: тезисы чужой страны хуже пустоты.
  const country = contextCountry(body.title ?? null);
  if (!country) return json({ country: null, meeting: null, tasks: [], reason: "no_country" });

  // Последняя ОПУБЛИКОВАННАЯ встреча этой страны, видимая смотрящему.
  // Приватная запись видна только владельцу (issue #15) — иначе рекордер покажет коллеге чужое.
  let q = supabase
    .from("entries")
    .select("id, content, metadata, entry_date, created_at, is_private, owner_id")
    .eq("entry_type", "meeting")
    .contains("countries", [country])
    .eq("metadata->>confirmed", "true")
    .or(`is_private.eq.false,owner_id.eq.${viewerId}`)
    .order("entry_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (groupId) q = q.eq("group_id", groupId);
  if (body.exclude_entry_id) q = q.neq("id", body.exclude_entry_id);

  const { data: rows, error } = await q;
  if (error) return json({ error: "lookup_failed", detail: error.message }, 500);
  const entry = (rows ?? [])[0] as
    | { id: string; content: string | null; metadata: Record<string, unknown> | null; entry_date: string | null; created_at: string }
    | undefined;
  if (!entry) return json({ country, meeting: null, tasks: [], reason: "no_previous_meeting" });

  const preview = tezisyPreview(entry.content);

  // Задачи СТОРОНЫ (страны) текущего созвона — независимо от того, какая запись нашлась
  // для тезисов: «задачи и тезисы никак и не должны соприкасаться, это разные вещи»
  // (владелец 03.09.2026). Поэтому здесь нет ни meeting_id, ни ссылки на entry выше.
  let tq = supabase
    .from("tasks")
    .select("id, title, due_date, assignees, status")
    .eq("country", country)
    .not("status", "in", `(${HIDDEN_TASK_STATUSES.join(",")})`)
    .eq("confirmed", true)
    .or(`is_private.eq.false,owner_id.eq.${viewerId}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(TASK_LIMIT);
  if (groupId) tq = tq.eq("group_id", groupId);
  const { data: taskRows } = await tq;
  type TaskRow = { id: string; title: string; due_date: string | null; assignees: string[] | null; status: string };

  return json({
    country,
    meeting: {
      entry_id: entry.id,
      title: entryTitle(entry.metadata, entry.content),
      date: entry.entry_date ?? entry.created_at.slice(0, 10),
      sections: preview.sections,
      bullets: preview.bullets,
      total_bullets: preview.totalBullets,
      full_text: preview.fullText,
      truncated: preview.truncated,
      limits: { full_chars: PREVIEW_LIMITS.fullChars },
    },
    tasks: ((taskRows ?? []) as TaskRow[]).map((t) => ({
      id: t.id,
      title: t.title,
      due_date: t.due_date,
      assignees: t.assignees ?? [],
      status: t.status,
    })),
  });
});
