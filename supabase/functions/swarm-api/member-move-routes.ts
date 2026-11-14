// Переезд человека в другое пространство из админки (этап 3 решения
// docs/decisions/2026-11-05-second-workspace.md). Подключён в admin.ts после общего гейта isAdmin.
//   • GET  /admin/members/:telegramId/move-preview?to=<wsId> — что переедет (пробный прогон, без записи)
//   • POST /admin/members/:telegramId/move {to, expected:{tasks, entries}} — выполнить
// Account-addressed equivalents: /admin/member-accounts/:accountId/{move-preview,move} (#1156).
// Только мастер-админ. Аккаунт владельца (константа) переводит только он сам.
//
// Вся работа — одна функция базы `move_member_to_workspace` (миграция 20261105200000): одна
// транзакция, решения по каждой таблице, журнал `member_moves`. Выполнение передаёт показанные
// числа в p_expected, и база сверяет их со свежим подсчётом в той же транзакции: данные успели
// измениться между показом и нажатием — 409, ничего не записано.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type AdminActor, isSuperadmin, SUPERADMIN_TELEGRAM_ID } from "./admin-scope.ts";
import { serverError } from "./client-error.ts";
import { apiErr, json } from "./http.ts";

type ResolveNames = (ids: number[]) => Promise<Map<number, string>>;

const PREVIEW_ROUTE = /^\/admin\/(members|member-accounts)\/([^/]+)\/move-preview$/;
const MOVE_ROUTE = /^\/admin\/(members|member-accounts)\/([^/]+)\/move$/;

type TitledRow = { id: string; title: string };

/** Ответ функции базы (пробный прогон и выполнение — одна форма). */
export type MoveDbResult = {
  error?: string;
  person?: { account_id?: string; telegram_id: number | null; email: string | null };
  from?: string;
  to?: string;
  counts?: Record<string, unknown>;
  tasks_mixed?: TitledRow[];
  tasks_detached?: TitledRow[];
  projects?: Array<{ id: string; name: string }>;
  tokens?: { claude: boolean; chatgpt: boolean; oauth: number; recorder: boolean };
  conflicts?: string[];
  can_execute?: boolean;
  moved?: boolean;
};

export type MoveExpected = { tasks: number; entries: number };

/** Отказ функции базы → HTTP. null — отказа нет. */
export function moveErrorStatus(code: string | undefined): { status: number; message: string } | null {
  switch (code) {
    case undefined:
      return null;
    case "person_not_found":
      return { status: 404, message: "Person not found" };
    case "workspace_not_found":
      return { status: 404, message: "Workspace not found" };
    case "same_workspace":
      return { status: 409, message: "Person is already in this workspace" };
    case "person_without_workspace":
      return { status: 409, message: "Person has no workspace to move from" };
    case "conflicts":
      return { status: 409, message: "Move has conflicts" };
    case "identity_changed":
    case "expected_mismatch":
      return { status: 409, message: "Data changed since the preview" };
    case "bad_input":
      return { status: 400, message: "Bad input" };
    default:
      return { status: 500, message: "Move failed" };
  }
}

/** Telegram id из пути: только целое без потери точности, иначе null (→ 404). */
export function parseTelegramId(raw: string): number | null {
  if (!/^-?\d{1,19}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n !== 0 ? n : null;
}

/** Account id stays a decimal string so SQL bigint identity is not rounded in JavaScript. */
export function parseAccountId(raw: string): string | null {
  return /^[1-9]\d{0,18}$/.test(raw) && BigInt(raw) <= 9223372036854775807n ? raw : null;
}

/** `expected` из тела: два неотрицательных целых, иначе null (→ 400). */
export function parseExpected(raw: unknown): MoveExpected | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { tasks, entries } = raw as Record<string, unknown>;
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  return ok(tasks) && ok(entries) ? { tasks, entries } : null;
}

/**
 * Кто кого может переводить: только мастер-админ; аккаунт владельца (константа) — только он сам.
 * Возвращает отказ или null.
 */
export function moveForbidden(actor: AdminActor, target: number): string | null {
  if (!isSuperadmin(actor)) return "master_admin_only";
  if (target === SUPERADMIN_TELEGRAM_ID && actor.telegramId !== SUPERADMIN_TELEGRAM_ID) return "owner_only";
  return null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function workspaceNames(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("workspaces").select("id, name").in("id", ids);
  if (error) throw new Error(`workspaces: ${error.message}`);
  return new Map(((data ?? []) as Array<{ id: string; name: string | null }>).map((w) => [w.id, w.name ?? w.id]));
}

/** Ответ экрану: форма контракта, имена пространств и человека. */
async function present(
  supabase: SupabaseClient,
  r: MoveDbResult,
  resolveNames: ResolveNames,
  withMoved: boolean,
) {
  const from = r.from ?? "";
  const to = r.to ?? "";
  const tid = r.person?.telegram_id ?? null;
  const [wsNames, people] = await Promise.all([
    workspaceNames(supabase, [from, to]),
    resolveNames(tid === null ? [] : [tid]),
  ]);
  return {
    person: {
      ...(r.person?.account_id === undefined ? {} : { account_id: r.person.account_id }),
      telegram_id: tid,
      name: tid === null ? null : people.get(tid) ?? null,
      email: r.person?.email ?? null,
    },
    from: { id: from, name: wsNames.get(from) ?? from },
    to: { id: to, name: wsNames.get(to) ?? to },
    counts: r.counts ?? {},
    tasks_mixed: r.tasks_mixed ?? [],
    tasks_detached: r.tasks_detached ?? [],
    projects: r.projects ?? [],
    tokens: r.tokens ?? { claude: false, chatgpt: false, oauth: 0, recorder: false },
    conflicts: r.conflicts ?? [],
    can_execute: r.can_execute === true,
    ...(withMoved ? { moved: r.moved === true } : {}),
  };
}

async function callMove(
  supabase: SupabaseClient,
  member: number | string,
  to: string,
  actor: number,
  dryRun: boolean,
  expected: MoveExpected | null,
  checkedTelegramId: number | null,
): Promise<MoveDbResult> {
  const { data, error } = await supabase.rpc(
    typeof member === "string" ? "move_member_account_to_workspace" : "move_member_to_workspace",
    {
      ...(typeof member === "string" ? { p_account_id: member } : { p_telegram_id: member }),
      p_to: to,
      p_actor: actor,
      p_dry_run: dryRun,
      p_expected: expected,
      ...(typeof member === "string" ? { p_expected_identity: { telegram_id: checkedTelegramId } } : {}),
    },
  );
  if (error) throw new Error(`move_member_to_workspace: ${error.message}`);
  if (!data || typeof data !== "object") throw new Error("move_member_to_workspace: empty answer");
  return data as MoveDbResult;
}

/** Отказ базы → ответ 4xx с машинной причиной; у конфликтов и расхождения — подробности. */
function refusal(r: MoveDbResult, origin: string): Response | null {
  const err = moveErrorStatus(r.error);
  if (!err) return null;
  if (err.status >= 500) throw new Error(`move_member_to_workspace: unexpected answer ${r.error}`);
  const extra = r.error === "conflicts"
    ? { conflicts: r.conflicts ?? [] }
    : r.error === "expected_mismatch"
    ? { counts: r.counts ?? {} }
    : {};
  return json({ error: err.message, code: r.error, ...extra }, err.status, origin);
}

export async function handleMemberMoveRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  actor: AdminActor,
  origin: string,
  resolveNames: ResolveNames,
): Promise<Response | null> {
  const preview = req.method === "GET" ? routePath.match(PREVIEW_ROUTE) : null;
  const move = req.method === "POST" ? routePath.match(MOVE_ROUTE) : null;
  const match = preview ?? move;
  if (!match) return null;
  try {
    return await handleMatched(
      supabase,
      req,
      match[2],
      match[1] === "member-accounts",
      preview !== null,
      actor,
      origin,
      resolveNames,
    );
  } catch (e) {
    return serverError(origin, "admin: member move", e);
  }
}

async function handleMatched(
  supabase: SupabaseClient,
  req: Request,
  idPart: string,
  byAccount: boolean,
  isPreview: boolean,
  actor: AdminActor,
  origin: string,
  resolveNames: ResolveNames,
): Promise<Response> {
  let target = byAccount ? null : parseTelegramId(idPart);
  const forbidden = moveForbidden(actor, target ?? 0);
  if (forbidden) return apiErr(403, "Forbidden", origin, forbidden);
  const accountId = byAccount ? parseAccountId(idPart) : null;
  if (byAccount && accountId !== null) {
    const { data, error } = await supabase.from("allowed_users").select("telegram_id").eq("id", accountId)
      .maybeSingle();
    if (error) throw new Error(`allowed_users: ${error.message}`);
    if (!data) return apiErr(404, "Person not found", origin, "person_not_found");
    target = data.telegram_id as number | null;
    const accountForbidden = moveForbidden(actor, target ?? 0);
    if (accountForbidden) return apiErr(403, "Forbidden", origin, accountForbidden);
  } else if (byAccount || target === null) return apiErr(404, "Person not found", origin, "person_not_found");
  const member = accountId ?? target!;

  if (isPreview) {
    const to = new URL(req.url).searchParams.get("to")?.trim() ?? "";
    if (!to) return apiErr(400, "to is required", origin, "bad_input");
    const r = await callMove(supabase, member, to, actor.telegramId, true, null, target);
    return refusal(r, origin) ?? json(await present(supabase, r, resolveNames, false), 200, origin);
  }

  const body = await readBody(req);
  if (!body) return apiErr(400, "Invalid JSON", origin, "bad_input");
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const expected = parseExpected(body.expected);
  if (!to || !expected) return apiErr(400, "to and expected {tasks, entries} are required", origin, "bad_input");

  const r = await callMove(supabase, member, to, actor.telegramId, false, expected, target);
  const refused = refusal(r, origin);
  if (refused) return refused;
  // Журнал переезда пишет сама функция базы (member_moves) в той же транзакции; здесь — строка в
  // лог функции, как у смены мастер-админа.
  console.log(JSON.stringify({
    event: "member_moved",
    actor: actor.telegramId,
    person: target,
    from: r.from,
    to: r.to,
    counts: r.counts,
    at: new Date().toISOString(),
  }));
  return json(await present(supabase, r, resolveNames, true), 200, origin);
}
