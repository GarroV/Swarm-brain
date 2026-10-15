// Последний удачный ответ по ключу — чтобы главная при повторном заходе сразу показывала то,
// что уже видела, и обновлялась в фоне, а не стояла скелетоном 0,5–2,5 с на каждый блок
// (#906, замер 12.10.2026: /quality медиана 1,4 с, /quality/maps 2,4 с — Децимус).
//
// Только память вкладки, как request-cache.ts: приватные ответы не кладём ни в localStorage,
// ни в HTTP-кэш (issue #71). Вкладка закрылась — забылось; перезагрузка — тоже.
const seen = new Map<string, unknown>();

export function recall<T>(key: string): T | null {
  return seen.has(key) ? (seen.get(key) as T) : null;
}

export function remember<T>(key: string, value: T): T {
  seen.set(key, value);
  return value;
}
