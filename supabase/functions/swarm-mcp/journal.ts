// Журнал изменяющих вызовов MCP (#1082, #1083): кто, когда, какой инструмент, чем кончилось.
// Таблица mcp_tool_journal — миграция 20261027120000, только дописывается.
//
// Чего здесь НЕТ намеренно: аргументов (там текст людей и данные встреч) и самого токена.
// Только последние символы ХЭШа токена — чтобы отличить «тот же ключ» от «перевыпущенного».
//
// Запись — best effort: сбой журнала не роняет вызов, ошибка уходит в console.error.

import { toolKind } from "./annotations.ts";

export type JournalOutcome = "ok" | "refused" | "error";

export const TOKEN_HINT_LENGTH = 6;

/** Пишутся вызовы write и destructive; чтение и незнакомые инструменты в журнал не идут. */
export function isMutatingTool(name: string): boolean {
  const kind = toolKind(name);
  return kind === "write" || kind === "destructive";
}

/** Последние символы sha256-хэша токена: по ним ключ не восстановить, различить можно. */
export function tokenHint(hashHex: string | null): string | null {
  return hashHex ? hashHex.slice(-TOKEN_HINT_LENGTH) : null;
}

export interface JournalRow {
  telegram_id: number;
  tool: string;
  outcome: JournalOutcome;
  token_hint: string | null;
}

/** Минимум от supabase-клиента, нужный журналу (чтобы тест подставлял свой). */
export interface JournalSink {
  from(table: string): { insert(row: JournalRow): PromiseLike<{ error: { message: string } | null }> };
}

export async function recordToolCall(
  sink: JournalSink,
  call: { telegramId: number; tool: string; outcome: JournalOutcome; tokenHash: string | null },
): Promise<boolean> {
  if (!isMutatingTool(call.tool)) return false;
  const row: JournalRow = {
    telegram_id: call.telegramId,
    tool: call.tool,
    outcome: call.outcome,
    token_hint: tokenHint(call.tokenHash),
  };
  try {
    const { error } = await sink.from("mcp_tool_journal").insert(row);
    if (error) {
      console.error("mcp_tool_journal: запись не удалась:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("mcp_tool_journal: запись не удалась:", e instanceof Error ? e.message : String(e));
    return false;
  }
}
