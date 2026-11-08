// Флаг «рекордер сам начинает запись по календарю» (#219) — user_profiles.recorder_auto_start.
// Отдельный модуль, чтобы правило «нет строки или ошибка чтения — false» проверялось без сети.

/** Строка профиля → флаг. Нет строки, не boolean — false: авто-старт включает только человек. */
export function autoStartOf(row: { recorder_auto_start?: unknown } | null | undefined): boolean {
  return row?.recorder_auto_start === true;
}

/**
 * Читает флаг человека. Ошибка чтения логируется и даёт false: флаг не должен ронять эндпоинт,
 * от которого зависят капсула и запись, а «выключено» — безопасная сторона (ничего не стартует само).
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
