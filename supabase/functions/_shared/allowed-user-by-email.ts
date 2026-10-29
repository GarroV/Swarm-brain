// Поиск строки allowed_users по verified email из Google — единственная дверь веб-входа.
//
// Личность в Swarm — telegram_id (owner_id, исполнители, ключи passkey, токены). Веб-вход по
// Google обязан попасть в ТУ ЖЕ строку, что и у человека в боте, и выдать сессию с его
// настоящим telegram_id, а не завести нового. Поэтому сравнение регистронезависимое: уникальный
// индекс allowed_users_email_lower_uq стоит по lower(email), а значит, в базе допустима строка
// «Anna@…», и точное `.eq` её бы не нашло — человек получил бы «нет в списке доступа».
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AllowedUserRow = { id: number; telegram_id: number | null; group_id: string | null };

/** Экранирует %, _ и \ для ILIKE: email — данные, а не шаблон (`a_b@x` не должен ловить `axb@x`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * @returns строка (на email максимум одна — индекс по lower(email)), null — человека нет.
 * @throws при ошибке базы: «нет доступа» и «база не ответила» — разные исходы.
 */
export async function findAllowedUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<AllowedUserRow | null> {
  const clean = email.toLowerCase().trim();
  if (!clean) return null;
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id, telegram_id, group_id")
    .ilike("email", escapeLike(clean))
    .maybeSingle();
  if (error) throw new Error(`allowed_users lookup failed: ${error.message}`);
  return (data as AllowedUserRow | null) ?? null;
}
