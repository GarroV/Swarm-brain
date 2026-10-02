// Боевые адреса веба — ЕДИНСТВЕННОЕ место, где они перечислены (issue #753).
// Любой другой хост — превью ветки: там вход по личному токену владельца, а Google и Telegram
// не работают (адрес превью не прописан ни в Google, ни у бота).
// Читают: страница входа (src/app/login/page.tsx) и Pages Functions (functions/_lib/api-url.ts).
// Чистые данные без React и окружения — импортируются и в браузер, и в функции Cloudflare.

/** Основной адрес проекта (куплен владельцем 02.10.2026). */
export const PRIMARY_HOST = "swarm-team.app";

/** Прежний адрес. Остаётся боевым: переадресует на основной и держит старые ссылки. */
export const LEGACY_HOST = "swarm-brain.pages.dev";

export const PROD_HOSTS: readonly string[] = [PRIMARY_HOST, LEGACY_HOST];

export function isProdHost(hostname: string): boolean {
  return PROD_HOSTS.includes(hostname.toLowerCase());
}
