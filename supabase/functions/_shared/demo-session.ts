// Демо-сессия — одно правило на все функции. Демо — это личность (демо-пользователь секретной
// ссылки), а не слаг воркспейса: по конкретному group_id ничего не решаем (CLAUDE.md,
// §Идентификаторы). swarm-api форсит демо-сессии синтетическую группу DEMO_GROUP_ID и запрещает
// ей админку; meeting-missed отказывает ей в приглашении бота, как веб.

/** telegram_id демо-пользователя (строка allowed_users, в которую входит секретная демо-ссылка). */
export const DEMO_USER_ID = 900000001;

/** Синтетическая группа, которую swarm-api форсит демо-сессии (не из базы). */
export const DEMO_GROUP_ID = "demo";

/** Это демо-сессия? Решается по личности, а не по группе. */
export function isDemoSession(telegramId: number): boolean {
  return telegramId === DEMO_USER_ID;
}

/**
 * Засеянные аккаунты демо: сам демо-пользователь и его выдуманные коллеги. Тот же диапазон
 * трогает сброс демо (миграция 20260928180000_demo_auto_reset.sql, `c_users`). Чата в Telegram у
 * них нет — рассылки бота их пропускают, иначе каждый тик пишет в лог «chat not found» (#675).
 */
export const DEMO_ACCOUNT_MIN_ID = 900000001;
export const DEMO_ACCOUNT_MAX_ID = 900000007;

/** Это засеянный демо-аккаунт (не живой человек)? */
export function isDemoAccount(telegramId: number): boolean {
  return telegramId >= DEMO_ACCOUNT_MIN_ID && telegramId <= DEMO_ACCOUNT_MAX_ID;
}
