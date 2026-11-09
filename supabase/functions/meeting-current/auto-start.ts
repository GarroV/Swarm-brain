// Флаг «рекордер сам начинает запись по календарю» (#219) — user_profiles.recorder_auto_start.
// Отдельный модуль, чтобы правила (нет строки — true, ошибка чтения — false) проверялись без сети.

/**
 * Строка профиля → флаг. По умолчанию ВКЛЮЧЕНО (решение 18.09.2026, как у колонки): нет строки
 * профиля или значение не boolean — true; выключает только явное false человека.
 */
export function autoStartOf(row: { recorder_auto_start?: unknown } | null | undefined): boolean {
  const v = row?.recorder_auto_start;
  return typeof v === "boolean" ? v : true;
}

/**
 * Читает флаг человека. Ошибка чтения логируется и даёт false: флаг не должен ронять эндпоинт,
 * от которого зависят капсула и запись, а при сбое лучше не стартовать сам — капсула предложит записать.
 */
export async function loadAutoStart(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  telegramId: number,
): Promise<boolean> {
  const { data, error } = await supabase.from("user_profiles").select("recorder_auto_start")
    .eq("telegram_id", telegramId).maybeSingle();
  if (error) {
    console.error("[meeting-current] auto_start read failed", error);
    return false;
  }
  return autoStartOf(data as { recorder_auto_start?: unknown } | null);
}

/** Маршрут записи флага: `POST …/meeting-current/auto-start` (меню рекордера, один источник — сервер). */
export function isAutoStartWrite(method: string, pathname: string): boolean {
  return method === "POST" && /\/auto-start\/?$/.test(pathname);
}

export type AutoStartBody = { ok: true; value: boolean } | { ok: false; error: string };

/** Тело `{"auto_start": boolean}`; всё иное — отказ (строка «false» или 0 не должны менять настройку). */
export function parseAutoStartBody(raw: unknown): AutoStartBody {
  const v = (raw && typeof raw === "object") ? (raw as { auto_start?: unknown }).auto_start : undefined;
  if (typeof v !== "boolean") return { ok: false, error: "auto_start must be boolean" };
  return { ok: true, value: v };
}

/**
 * Пишет флаг человека. upsert, а не update: у части команды строки профиля нет, и update молча
 * обновлял бы ноль строк (как в PATCH /me, #165). Возвращает текст ошибки или null.
 */
export async function saveAutoStart(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  telegramId: number,
  value: boolean,
): Promise<string | null> {
  const { error } = await supabase.from("user_profiles")
    .upsert({ telegram_id: telegramId, recorder_auto_start: value }, { onConflict: "telegram_id" });
  if (error) {
    console.error("[meeting-current] auto_start write failed", error);
    return "Could not save auto_start";
  }
  return null;
}
