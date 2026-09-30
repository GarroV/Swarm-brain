// Фильтр видимости записей для PostgREST `.or()`: общие — всем в воркспейсе, личные — только
// владельцу. Отдельным модулем без клиента базы, чтобы его брали и модули, проверяемые тестом.
export function visibilityFilter(userId: number): string {
  return `is_private.eq.false,and(is_private.eq.true,owner_id.eq.${userId})`;
}
