// Двухшаговое подтверждение разрушающих инструментов MCP (#1083; образец — DECIMUS src/mcp/confirm.py).
//
// Инструмент класса destructive (annotations.ts) с первого вызова не выполняется: сервер отвечает
// `confirmation_required` и токеном, а действие происходит вторым вызовом с ТЕМИ ЖЕ аргументами и
// этим токеном. Так модель, которую увели непрямой инъекцией, не удалит одним вызовом: между
// «хочу» и «сделано» стоит ответ, который обязан прочесть человек.
//
// Честный предел: токен не доказывает, что человек прочёл ответ, — клиент может повторить вызов
// сам. Он гарантирует другое: действие идёт только по ТОЧНЫМ аргументам из ответа-подтверждения,
// от того же автора и в пределах срока.
//
// Токен: `<срок, сек>.<hmac-sha256 hex>` от автора, инструмента, канонического JSON аргументов
// (без самого токена) и срока. Секрет — переменная MCP_CONFIRM_SECRET. Секрета нет — fail-closed:
// разрушающие инструменты отказывают, а не работают без подтверждения.

import { annotationsFor } from "./annotations.ts";
import type { ToolDefinition } from "./identity.ts";

export const CONFIRM_TOKEN_ARGUMENT = "confirmation_token";
export const CONFIRM_TTL_SECONDS = 300;
export const CONFIRM_SECRET_ENV = "MCP_CONFIRM_SECRET";

export const CONFIRM_NO_SECRET_MESSAGE =
  "Destructive tools are disabled: the server has no confirmation secret configured (MCP_CONFIRM_SECRET). Ask the Swarm owner.";
export const CONFIRM_INVALID_MESSAGE =
  "Confirmation token is invalid, expired, or was issued for different arguments. Nothing was executed. Call the tool again without a token to get a new one.";

/** Канонический JSON: ключи по алфавиту на любой глубине, чтобы порядок полей не менял подпись. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value == "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Аргументы без токена подтверждения — то, под что выдаётся и по чему проверяется подпись. */
export function stripConfirmationToken(args: Record<string, unknown>): Record<string, unknown> {
  const { [CONFIRM_TOKEN_ARGUMENT]: _token, ...rest } = args;
  return rest;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sign(secret: string, telegramId: number, tool: string, args: Record<string, unknown>, expires: number) {
  return hmacHex(
    secret,
    [String(telegramId), tool, canonicalJson(stripConfirmationToken(args)), String(expires)].join("\x00"),
  );
}

/** Сравнение без раннего выхода по первому несовпавшему символу. */
function sameText(a: string, b: string): boolean {
  if (a.length != b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff == 0;
}

export async function issueConfirmationToken(
  secret: string,
  telegramId: number,
  tool: string,
  args: Record<string, unknown>,
  nowSec: number,
): Promise<string> {
  const expires = nowSec + CONFIRM_TTL_SECONDS;
  return `${expires}.${await sign(secret, telegramId, tool, args, expires)}`;
}

/** Токен верен для ЭТОГО автора, инструмента и аргументов и не истёк. Любая порча формы — false. */
export async function verifyConfirmationToken(
  secret: string,
  token: unknown,
  telegramId: number,
  tool: string,
  args: Record<string, unknown>,
  nowSec: number,
): Promise<boolean> {
  if (typeof token != "string") return false;
  const [head, signature, ...extra] = token.split(".");
  if (extra.length > 0 || !signature || !/^\d{1,12}$/.test(head)) return false;
  const expires = Number(head);
  if (expires < nowSec) return false;
  return sameText(await sign(secret, telegramId, tool, args, expires), signature);
}

export type ConfirmDecision =
  | { action: "execute"; args: Record<string, unknown> }
  | { action: "challenge"; token: string }
  | { action: "refuse"; message: string };

export interface ConfirmInput {
  /** Значение MCP_CONFIRM_SECRET; пусто — отказ. */
  secret: string | undefined;
  telegramId: number;
  tool: string;
  /** Аргументы как пришли от клиента (с токеном, если он есть). */
  args: Record<string, unknown>;
  nowSec: number;
}

/** Решение по вызову РАЗРУШАЮЩЕГО инструмента: выдать токен, исполнить или отказать. */
export async function decideConfirmation(input: ConfirmInput): Promise<ConfirmDecision> {
  const { secret, telegramId, tool, args, nowSec } = input;
  if (!secret) return { action: "refuse", message: CONFIRM_NO_SECRET_MESSAGE };
  const bare = stripConfirmationToken(args);
  const presented = args[CONFIRM_TOKEN_ARGUMENT];
  if (presented === undefined || presented === null || presented === "") {
    return { action: "challenge", token: await issueConfirmationToken(secret, telegramId, tool, bare, nowSec) };
  }
  const valid = await verifyConfirmationToken(secret, presented, telegramId, tool, bare, nowSec);
  return valid ? { action: "execute", args: bare } : { action: "refuse", message: CONFIRM_INVALID_MESSAGE };
}

/** Ответ первого шага: что будет сделано и токен для второго. Не отказ и не выполнение. */
export function confirmationChallenge(tool: string, args: Record<string, unknown>, token: string) {
  const shown = canonicalJson(stripConfirmationToken(args));
  const text = [
    "Confirmation required. The action was NOT executed.",
    `Tool: ${tool}`,
    `Arguments: ${shown}`,
    "Show this to the user. Only if they agree, repeat EXACTLY the same call with the extra argument",
    `${CONFIRM_TOKEN_ARGUMENT}="${token}". The token is valid for ${
      CONFIRM_TTL_SECONDS / 60
    } minutes and only for these arguments.`,
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      status: "confirmation_required",
      executed: false,
      tool,
      confirmation_token_argument: CONFIRM_TOKEN_ARGUMENT,
      confirmation_token: token,
      expires_in_seconds: CONFIRM_TTL_SECONDS,
    },
  };
}

/** Для tools/list: у разрушающего инструмента в схеме появляется необязательный confirmation_token. */
export function withConfirmationArgument<T extends ToolDefinition>(tool: T): T {
  if (!annotationsFor(tool.name)?.destructiveHint) return tool;
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...(tool.inputSchema.properties ?? {}),
        [CONFIRM_TOKEN_ARGUMENT]: {
          type: "string",
          description:
            "Leave empty on the first call: the server answers confirmation_required with a token. Pass it back, with the same arguments, only after the user agrees.",
        },
      },
    },
  };
}
