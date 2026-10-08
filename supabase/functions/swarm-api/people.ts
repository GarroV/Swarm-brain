import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { resolvePersonNames } from "../_shared/users/display-name.ts";

// Справочник людей воркспейса (#874). Канон: docs/decisions/2026-10-08-people-stickers-ratings-mail.md.
//
// Роуты: GET /people, POST /people. Возвращает null, если путь не про людей.
//
// Человек с аккаунтом и без — одна сущность `people`. Аккаунтам запись заводит триггер базы
// (people_sync_account), поэтому здесь создаются только люди без входа — прямо из поля
// «Исполнитель»/«Соисполнители» в задаче: «он соответственно утекает в базу и в будущем уже
// можно подставить по списку» (владелец, 08.10).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 120;
const COASSIGNEES_MAX = 20;

export type PersonView = {
  id: string;
  name: string;
  email: string | null;
  /** null — человек без входа в Swarm */
  telegram_id: number | null;
};

type PersonRow = {
  id: string;
  display_name: string;
  email: string | null;
  account: { telegram_id: number | null } | null;
};

const PERSON_SELECT = "id, display_name, email, account:allowed_users(telegram_id)";

// Имя аккаунта берётся из профиля — оно меняется, а display_name записан один раз при заведении.
async function toViews(supabase: SupabaseClient, rows: PersonRow[]): Promise<PersonView[]> {
  const names = await resolvePersonNames(supabase, rows.map((r) => r.account?.telegram_id));
  return rows.map((r) => {
    const tg = r.account?.telegram_id ?? null;
    return {
      id: r.id,
      name: (tg != null ? names.get(tg) : null) ?? r.display_name,
      email: r.email,
      telegram_id: tg,
    };
  });
}

async function loadPeople(
  supabase: SupabaseClient,
  groupId: string,
  ids?: string[],
): Promise<PersonView[]> {
  let q = supabase.from("people").select(PERSON_SELECT).eq("group_id", groupId).is(
    "archived_at",
    null,
  );
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.order("display_name");
  if (error) throw new Error(`people: ${error.message}`);
  return toViews(supabase, (data ?? []) as unknown as PersonRow[]);
}

function parseNewPerson(body: Record<string, unknown>): { name: string; email: string | null } | string {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > NAME_MAX) return `Имя обязательно, до ${NAME_MAX} символов`;
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (rawEmail && !EMAIL_RE.test(rawEmail)) return "Почта указана неверно";
  return { name, email: rawEmail || null };
}

export async function handlePeopleRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string | null,
  origin: string,
): Promise<Response | null> {
  if (routePath !== "/people") return null;
  if (!groupId) return apiErr(403, "Нет воркспейса", origin);

  if (req.method === "GET") {
    return json(await loadPeople(supabase, groupId), 200, origin);
  }

  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return apiErr(400, "Invalid JSON", origin);
    }
    const parsed = parseNewPerson(body);
    if (typeof parsed === "string") return apiErr(400, parsed, origin);

    // Почта уже есть в воркспейсе — это тот же человек, второй записи не заводим.
    if (parsed.email) {
      const { data: found } = await supabase.from("people").select("id")
        .eq("group_id", groupId).eq("email", parsed.email).is("archived_at", null).maybeSingle();
      if (found) {
        const [view] = await loadPeople(supabase, groupId, [(found as { id: string }).id]);
        return json(view, 200, origin);
      }
    }
    const { data, error } = await supabase.from("people").insert({
      group_id: groupId,
      display_name: parsed.name,
      email: parsed.email,
      source: "manual",
      created_by: telegramId,
    }).select("id").single();
    if (error) return apiErr(500, "Не удалось добавить человека", origin);
    const [view] = await loadPeople(supabase, groupId, [(data as { id: string }).id]);
    return json(view, 201, origin);
  }

  return apiErr(405, "Method not allowed", origin);
}

// ── Поля задачи: исполнитель из справочника и соисполнители ─────────────────────────────────

export type TaskPeopleFields = {
  assignees?: string[];
  assignee_telegram_ids?: number[];
  assignee_person_id?: string | null;
  coassignee_person_ids?: string[];
};

/**
 * Разбирает `assignee_person_id` и `coassignee_person_ids` из тела запроса задачи.
 * Каждый id обязан быть человеком ЭТОГО воркспейса — чужой uuid не пройдёт.
 *
 * Исполнитель с аккаунтом пишется по-старому (assignee_telegram_ids + имя), чтобы бот, MCP,
 * напоминания и права продолжали работать без правок; без аккаунта — в assignee_person_id.
 */
export async function resolveTaskPeople(
  supabase: SupabaseClient,
  groupId: string,
  body: Record<string, unknown>,
): Promise<TaskPeopleFields | string> {
  const out: TaskPeopleFields = {};
  const wanted: string[] = [];

  if ("assignee_person_id" in body) {
    const v = body.assignee_person_id;
    if (v === null || v === "") {
      Object.assign(out, { assignees: [], assignee_telegram_ids: [], assignee_person_id: null });
    } else if (typeof v === "string" && UUID_RE.test(v)) {
      wanted.push(v);
    } else {
      return "assignee_person_id: ожидается id человека или null";
    }
  }

  let coIds: string[] | undefined;
  if ("coassignee_person_ids" in body) {
    const v = body.coassignee_person_ids;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !UUID_RE.test(x))) {
      return "coassignee_person_ids: ожидается список id людей";
    }
    coIds = [...new Set(v as string[])];
    if (coIds.length > COASSIGNEES_MAX) return `Соисполнителей — не больше ${COASSIGNEES_MAX}`;
    wanted.push(...coIds);
  }

  if (wanted.length === 0) {
    if (coIds) out.coassignee_person_ids = [];
    return out;
  }

  const people = await loadPeople(supabase, groupId, [...new Set(wanted)]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const missing = wanted.find((id) => !byId.has(id));
  if (missing) return "Человек не найден в этом воркспейсе";

  const assigneeId = typeof body.assignee_person_id === "string" ? body.assignee_person_id : null;
  if (assigneeId) {
    const p = byId.get(assigneeId)!;
    Object.assign(out, p.telegram_id != null
      ? { assignees: [p.name], assignee_telegram_ids: [p.telegram_id], assignee_person_id: null }
      : { assignees: [p.name], assignee_telegram_ids: [], assignee_person_id: p.id });
  }
  if (coIds) out.coassignee_person_ids = coIds;
  return out;
}
