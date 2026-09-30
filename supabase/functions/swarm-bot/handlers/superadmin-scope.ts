// Границы админ-панели бота (`sa_*`, handlers/superadmin.ts). Правила объёма — общий канон
// `_shared/users/admin-scope.ts` (тот же, что у веб-админки swarm-api `/admin/*`):
//   • админ — только свой воркспейс: смотреть людей, добавлять, удалять, переименовывать;
//   • перенос людей между воркспейсами и создание воркспейса — только суперадмин;
//   • аккаунт суперадмина админу недоступен (удалить, «добавить» = переписать его членство).
// Колбэк приходит от клиента Telegram, поэтому каждое действие разбирается здесь и проверяется
// ДО любой записи; неизвестное действие — отказ (закрыто по умолчанию).
import {
  type AdminActor,
  canChangeAccountKeys,
  canManageMember,
  canManageWorkspace,
  isSuperadmin,
  type MemberRow,
} from "../../_shared/users/admin-scope.ts";

export type BotAdminAction =
  | { kind: "menu" }
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "workspace"; wsId: string }
  | { kind: "user"; tgId: number; wsId: string }
  | { kind: "move"; tgId: number; wsId: string }
  | { kind: "remove"; tgId: number; wsId: string }
  | { kind: "add"; wsId: string; input: string }
  | { kind: "unknown" };

const UNKNOWN: BotAdminAction = { kind: "unknown" };

/** "<tgId>_<wsId>" — делим по первому «_» (в id воркспейса он допустим). */
function tgAndWs(rest: string): { tgId: number; wsId: string } | null {
  const idx = rest.indexOf("_");
  if (idx <= 0) return null;
  const raw = rest.slice(0, idx);
  const wsId = rest.slice(idx + 1);
  if (!/^-?\d+$/.test(raw) || !wsId) return null;
  return { tgId: Number(raw), wsId };
}

const WS_CALLBACKS = ["sa_sp_", "sa_su_", "sa_add_", "sa_ren_"];
const USER_CALLBACKS: Array<[string, "user" | "move" | "remove"]> = [
  // sa_mvto_ раньше sa_mv_: иначе «mvto» разобрался бы как «mv» с id «to…»
  ["sa_mvto_", "move"],
  ["sa_mv_", "move"],
  ["sa_blk_", "remove"],
  ["sa_u_", "user"],
];

export function parseSaCallback(data: string): BotAdminAction {
  if (data === "sa_main") return { kind: "menu" };
  if (data === "sa_spaces") return { kind: "list" };
  if (data === "sa_create") return { kind: "create" };
  for (const p of WS_CALLBACKS) {
    if (data.startsWith(p)) {
      const wsId = data.slice(p.length);
      return wsId ? { kind: "workspace", wsId } : UNKNOWN;
    }
  }
  for (const [p, kind] of USER_CALLBACKS) {
    if (data.startsWith(p)) {
      const parsed = tgAndWs(data.slice(p.length));
      return parsed ? { kind, ...parsed } : UNKNOWN;
    }
  }
  return UNKNOWN;
}

export function parseSaSession(action: string, text: string): BotAdminAction {
  if (action.startsWith("sa_adduser_")) {
    const wsId = action.slice("sa_adduser_".length);
    return wsId ? { kind: "add", wsId, input: text.trim() } : UNKNOWN;
  }
  if (action === "sa_create_id" || action.startsWith("sa_create_name_")) return { kind: "create" };
  if (action.startsWith("sa_rename_")) {
    const wsId = action.slice("sa_rename_".length);
    return wsId ? { kind: "workspace", wsId } : UNKNOWN;
  }
  return UNKNOWN;
}

/** Кого адресует действие — строку allowed_users обработчик загружает до решения. */
export function actionTarget(act: BotAdminAction): { telegramId: number } | { username: string } | null {
  if (act.kind === "user" || act.kind === "move" || act.kind === "remove") return { telegramId: act.tgId };
  if (act.kind === "add") {
    return /^\d+$/.test(act.input)
      ? { telegramId: Number(act.input) }
      : { username: act.input.replace(/^@/, "").toLowerCase() };
  }
  return null;
}

/**
 * Можно ли админу выполнить действие. `target` — строка allowed_users того, кого адресует
 * действие (actionTarget), или null, если такой строки нет.
 */
export function botAdminAllowed(actor: AdminActor, act: BotAdminAction, target: MemberRow | null): boolean {
  switch (act.kind) {
    case "menu":
    case "list":
      return true;
    case "create":
    case "move":
      return isSuperadmin(actor);
    case "workspace":
      return canManageWorkspace(actor, act.wsId);
    case "user":
      return canManageWorkspace(actor, act.wsId) &&
        (isSuperadmin(actor) || (target != null && canManageMember(actor, target)));
    case "remove":
      return target != null && target.group_id === act.wsId &&
        canManageWorkspace(actor, act.wsId) && canManageMember(actor, target) &&
        canChangeAccountKeys(actor, target);
    case "add":
      return canManageWorkspace(actor, act.wsId) &&
        (target == null || (canManageMember(actor, target) && canChangeAccountKeys(actor, target)));
    default:
      return false;
  }
}

/** Список воркспейсов в панели: админу — только свой. */
export function visibleWorkspaces<T extends { id: string }>(actor: AdminActor, all: T[]): T[] {
  return isSuperadmin(actor) ? all : all.filter((w) => w.id === actor.groupId);
}

/** Отказ — двуязычно (правило i18n продукта). */
export const NO_ACCESS_TEXT = "No access to this action or workspace.\nНет доступа к этому действию или спейсу.";
