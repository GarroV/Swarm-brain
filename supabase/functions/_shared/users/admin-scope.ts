// Границы админских действий — ЕДИНОЕ правило для веб-админки (swarm-api `/admin/*`) и
// админ-панели бота (swarm-bot `sa_*`). Решение владельца 28.09.2026: права админа не урезаем,
// задаём границы.
//   • Суперадмин (мастер-админ: ADMIN_USER_ID ИЛИ строка master_admins, #233) — глобальный объём: все воркспейсы, создание воркспейсов,
//     перенос людей между воркспейсами, рассылка всем.
//   • Админ (флаг allowed_users.is_admin) — только СВОЙ воркспейс (его group_id).
//   • Аккаунт владельца (константа) меняет только он сам; аккаунт мастер-админа из данных — только мастер-админ.

export const SUPERADMIN_TELEGRAM_ID = 744230399;

export type AdminActor = {
  telegramId: number;
  /** Воркспейс админа — тот же group_id, что index.ts резолвит для всех data-запросов. */
  groupId: string;
  /**
   * Мастер-админ по данным (#233): константа ИЛИ строка `master_admins`, вычислен один раз на
   * запрос (`isMasterAdmin`). Константа остаётся мастер-админом всегда; флаг только добавляет людей из данных (чистые функции и тесты без флага работают как раньше).
   */
  isMaster?: boolean;
};

/** Строка allowed_users в объёме, который нужен правилам. */
export type MemberRow = {
  telegram_id: number | null;
  group_id: string | null;
  email?: string | null;
  /**
   * Цель — мастер-админ из данных (`master_admins`), проставляет `withMasterFlag` при загрузке
   * строки. Без признака (чистые функции, старые тесты) защищена только константа владельца.
   */
  is_master?: boolean;
};

export function isSuperadmin(actor: AdminActor): boolean {
  return actor.isMaster === true || actor.telegramId === SUPERADMIN_TELEGRAM_ID;
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
 *   • аккаунт владельца (константа SUPERADMIN_TELEGRAM_ID) — только он сам: мастер-админ из данных
 *     его не трогает (иначе — захват аккаунта владельца);
 *   • аккаунт мастер-админа из данных (`target.is_master`) — только мастер-админ: админ
 *     пространства не может сменить ему почту входа и войти под ним.
 */
export function canChangeAccountKeys(
  actor: AdminActor,
  target: MemberRow,
): boolean {
  if (target.telegram_id === SUPERADMIN_TELEGRAM_ID) return actor.telegramId === SUPERADMIN_TELEGRAM_ID;
  if (target.is_master === true) return isSuperadmin(actor);
  return true;
}

/**
 * Можно ли задать или сменить ПОЧТУ ВХОДА (allowed_users.email — ключ веб-входа через Google).
 * Признак «уже входил» — telegram_id: у ожидающего приглашения он NULL, его присваивает первый
 * вход (бот или auth-resolve). Правило:
 *   • приглашение без входа — админ воркспейса или суперадмин (в объёме canManageMember);
 *   • тот, кто уже входил, — только он сам или суперадмин (мастер-админ);
 *   • аккаунты владельца и мастер-админа защищены общим canChangeAccountKeys.
 */
export function canSetLoginEmail(actor: AdminActor, target: MemberRow): boolean {
  if (!canChangeAccountKeys(actor, target)) return false;
  if (target.telegram_id == null) return canManageMember(actor, target);
  return target.telegram_id === actor.telegramId || isSuperadmin(actor);
}
