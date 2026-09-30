// Контроль доступа к tools/call: кто вызывает и в каком воркспейсе.
//
// Правило одно и без режимов: личность берётся ТОЛЬКО из валидного токена коннектора,
// воркспейс — из строки этого человека в allowed_users. Нет токена → отказ. Нет воркспейса →
// отказ (кроме whoami, который читает только строку самого вызывающего). Всё, что прислал
// клиент в аргументах про «кто я», перетирается значением из токена.
//
// Почему отдельный модуль: правило чистое (без БД и сети), его проверяют тесты
// (auth.test.ts), а index.ts только подставляет результаты поиска токена и воркспейса.
// Протокольные методы (initialize / tools/list / notifications) сюда не приходят — они
// отвечают без токена, чтобы коннектор не отваливался на хендшейке (см. index.ts).

import { TOKEN_IDENTITY_FIELDS } from "./identity.ts";

export const UNAUTHORIZED_MESSAGE = "Unauthorized — run /mytoken in the bot and add the token to the connector";
export const NO_WORKSPACE_MESSAGE = "No workspace — ask the Swarm owner to add you to a workspace";

/** JSON-RPC код отказа в доступе (тот же, что и раньше, клиенты его уже знают). */
export const AUTH_ERROR_CODE = -32001;

/** Инструменты, которым воркспейс не нужен: они читают только строку самого вызывающего. */
export const TOOLS_WITHOUT_WORKSPACE: ReadonlySet<string> = new Set(["whoami"]);

export type ToolCallAuth =
  | { ok: true; telegramId: number; groupId: string | null }
  | { ok: false; code: number; message: string };

export interface ToolCallAuthInput {
  toolName: string;
  /** telegram_id из валидного токена; null — токена нет или он не прошёл. */
  verifiedTelegramId: number | null;
  /** Текст ошибки, если Bearer передан, но не найден или протух. */
  tokenError: string | null;
  /** group_id вызывающего из allowed_users; null/"" — воркспейса нет. */
  groupId: string | null;
}

const deny = (message: string): ToolCallAuth => ({ ok: false, code: AUTH_ERROR_CODE, message });

/** Решение по tools/call. Fail-closed: любое «не знаю, кто это» — отказ. */
export function authorizeToolCall(input: ToolCallAuthInput): ToolCallAuth {
  if (input.tokenError) return deny(input.tokenError);
  const telegramId = input.verifiedTelegramId;
  if (telegramId === null || !Number.isFinite(telegramId)) return deny(UNAUTHORIZED_MESSAGE);
  const groupId = input.groupId || null;
  if (!groupId && !TOOLS_WITHOUT_WORKSPACE.has(input.toolName)) return deny(NO_WORKSPACE_MESSAGE);
  return { ok: true, telegramId, groupId };
}

/**
 * Копия аргументов, где поля личности заданы значением из токена.
 * Исходный объект не меняется; присланные клиентом значения этих полей не доживают до инструмента.
 */
export function withCallerIdentity(
  args: Record<string, unknown>,
  telegramId: number,
): Record<string, unknown> {
  const forced = Object.fromEntries(TOKEN_IDENTITY_FIELDS.map((field) => [field, telegramId]));
  return { ...args, ...forced };
}

/**
 * Воркспейс вызывающего для запроса внутри инструмента. Второй рубеж после authorizeToolCall:
 * без личности или без воркспейса инструмент не получает «пустой» фильтр, а получает null
 * и обязан отказать — выборка «по всем воркспейсам» из MCP невозможна.
 */
export async function resolveCallerScope(
  userId: number | null | undefined,
  lookupGroupId: (telegramId: number) => Promise<string | null>,
): Promise<{ userId: number; groupId: string } | null> {
  if (userId == null || !Number.isFinite(userId)) return null;
  const groupId = await lookupGroupId(userId);
  if (!groupId) return null;
  return { userId, groupId };
}
