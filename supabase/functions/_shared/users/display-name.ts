// Единое правило «как назвать человека» на сервере (issue #537). Раньше каждая поверхность
// собирала имя сама, и у вошедших через Google (у них нет ни имени из Telegram, ни @username —
// только e-mail) на экран выходил внутренний номер: «#-30» или голое «-30».
//
// Порядок: «Имя Фамилия» → «@username» → e-mail → null. null означает «назвать нечем» —
// что показать вместо имени, решает вызывающий (обычно personLabel с «#id»).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PersonNameParts = {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email?: string | null;
};

export type PersonNameOptions = {
  // У части старых ответов (/users, /me) username отдаётся без «@», и экран на это рассчитан.
  usernamePrefix?: string;
};

const clean = (s: string | null | undefined): string => (typeof s === "string" ? s.trim() : "");

export function personName(
  p: PersonNameParts | null | undefined,
  opts: PersonNameOptions = {},
): string | null {
  if (!p) return null;
  const full = [clean(p.first_name), clean(p.last_name)].filter(Boolean).join(" ");
  if (full) return full;
  const username = clean(p.username).replace(/^@+/, "");
  if (username) return `${opts.usernamePrefix ?? "@"}${username}`;
  const email = clean(p.email);
  return email || null;
}

// Последний фолбэк, когда назвать нечем: «#id». Только для служебных мест — в норме у участника
// воркспейса есть хотя бы e-mail.
export function personLabel(
  p: PersonNameParts | null | undefined,
  id: number,
  opts: PersonNameOptions = {},
): string {
  return personName(p, opts) ?? `#${id}`;
}

// Минимум клиента, который нужен резолву: так его легко подменить в тесте.
type NamesClient = Pick<SupabaseClient, "from">;

type ProfileNameRow = { telegram_id: number; first_name?: string | null; last_name?: string | null };
type MemberNameRow = { telegram_id: number; username?: string | null; email?: string | null };

/**
 * Имена по telegram_id одним батчем — общий резолв для swarm-api и swarm-mcp (раньше у каждого
 * была своя копия, и половина брала только user_profiles: вошедший через Google без имени
 * становился номером). Имя — в user_profiles, username и e-mail — в allowed_users.
 * Кого назвать нечем, в карте нет — фолбэк выбирает вызывающий (обычно personLabel).
 * Ошибка любого из запросов пишется в лог, а имена из уцелевшего всё равно отдаются.
 */
export async function resolvePersonNames(
  supabase: NamesClient,
  rawIds: ReadonlyArray<number | null | undefined>,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  // Один null в `.in(...)` превращает весь запрос в ошибку — и без имён остаются все.
  const ids = [...new Set(rawIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id)))];
  if (ids.length === 0) return out;
  const [profRes, auRes] = await Promise.all([
    supabase.from("user_profiles").select("telegram_id, first_name, last_name").in("telegram_id", ids),
    supabase.from("allowed_users").select("telegram_id, username, email").in("telegram_id", ids),
  ]);
  if (profRes.error) console.error("[resolvePersonNames] user_profiles:", profRes.error.message);
  if (auRes.error) console.error("[resolvePersonNames] allowed_users:", auRes.error.message);
  const profById = new Map(((profRes.data ?? []) as ProfileNameRow[]).map((p) => [p.telegram_id, p]));
  const auById = new Map(((auRes.data ?? []) as MemberNameRow[]).map((a) => [a.telegram_id, a]));
  for (const id of ids) {
    const p = profById.get(id);
    const a = auById.get(id);
    const name = personName({
      first_name: p?.first_name,
      last_name: p?.last_name,
      username: a?.username,
      email: a?.email,
    });
    if (name) out.set(id, name);
  }
  return out;
}
