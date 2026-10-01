// Фильтр видимости записей для PostgREST `.or()`: общие — всем в воркспейсе, личные — владельцу
// и тем, с кем запись разделена (встреча 1-1, #641). Правило одно на все поверхности и живёт в
// `_shared/entries/access.ts`; здесь — прежнее имя для модулей бота, чтобы не трогать каждый вызов.
import { entryVisibilityOr } from "../../_shared/entries/access.ts";

export function visibilityFilter(userId: number): string {
  return entryVisibilityOr(userId);
}
