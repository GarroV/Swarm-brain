// Права на управление пользователями из бота (/users, кнопки профиля) — issue #674.
// Те же правила, что у веб-админки и панели /superadmin (`_shared/users/admin-scope.ts`):
// админ действует только в своём воркспейсе, суперадмин — в любом, аккаунт суперадмина
// трогает только он сам. Чистые функции без базы: проверяются юнит-тестом.
import {
  type AdminActor,
  canChangeAccountKeys,
  canManageMember,
  isSuperadmin,
  type MemberRow,
} from "../../_shared/users/admin-scope.ts";

export type UsersActor = AdminActor & { isAdmin: boolean };

/**
 * Что делают с человеком:
 * - view — посмотреть профиль и его задачи;
 * - edit — поменять поле профиля;
 * - remove — убрать из воркспейса.
 */
export type UserAction = "view" | "edit" | "remove";

/** `target` — строка allowed_users человека в воркспейсе действующего; null — такой строки нет. */
export function canActOnUser(actor: UsersActor, target: MemberRow | null, action: UserAction): boolean {
  if (target == null) return false;
  if (!canManageMember(actor, target)) return false;
  if (action === "view") return true;
  if (!actor.isAdmin) return false;
  return canChangeAccountKeys(actor, target);
}

/** Добавлять людей в воркспейс может только его админ (или суперадмин). */
export function canAddUsers(actor: UsersActor): boolean {
  return actor.isAdmin || isSuperadmin(actor);
}

/** Поле профиля, которое разрешено править из бота: только из списка формы. */
export function isEditableProfileField(fields: Record<string, string>, field: string): boolean {
  return Object.hasOwn(fields, field);
}
