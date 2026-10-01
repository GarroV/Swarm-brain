// Границы админских действий — ЕДИНОЕ правило для веб-админки (swarm-api `/admin/*`) и
// админ-панели бота (swarm-bot `sa_*`). Решение владельца 28.09.2026: права админа не урезаем,
// задаём границы.
//   • Суперадмин (ADMIN_USER_ID) — глобальный объём: все воркспейсы, создание воркспейсов,
//     перенос людей между воркспейсами, рассылка всем.
//   • Админ (флаг allowed_users.is_admin) — только СВОЙ воркспейс (его group_id).
//   • Аккаунт суперадмина (почта входа, флаг админа, членство) меняет только сам суперадмин.

export const SUPERADMIN_TELEGRAM_ID = 744230399;

export type AdminActor = {
  telegramId: number;
  /** Воркспейс админа — тот же group_id, что index.ts резолвит для всех data-запросов. */
  groupId: string;
};

/** Строка allowed_users в объёме, который нужен правилам. */
export type MemberRow = {
  telegram_id: number | null;
  group_id: string | null;
  email?: string | null;
};

export function isSuperadmin(actor: AdminActor): boolean {
  return actor.telegramId === SUPERADMIN_TELEGRAM_ID;
}

/** Воркспейс в объёме админа: суперадмину любой, остальным — только свой. */
export function canManageWorkspace(actor: AdminActor, wsId: string): boolean {
  return isSuperadmin(actor) || wsId === actor.groupId;
}

/** Участник в объёме админа: суперадмину любой, остальным — только из своего воркспейса. */
export function canManageMember(actor: AdminActor, target: MemberRow): boolean {
  return isSuperadmin(actor) ||
    (target.group_id != null && target.group_id === actor.groupId);
}

/**
 * Можно ли менять ключевые поля аккаунта (почта входа, флаг админа, членство):
 * аккаунт суперадмина — только ему самому.
 */
export function canChangeAccountKeys(
  actor: AdminActor,
  target: MemberRow,
): boolean {
  return target.telegram_id !== SUPERADMIN_TELEGRAM_ID || isSuperadmin(actor);
}
