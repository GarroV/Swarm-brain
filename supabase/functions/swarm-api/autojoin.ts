// Автозапуск бота по календарю — переключатель человека (D021, T161).
//
// Бот scriba сам приходит на встречи Meet из календаря только тем, кто это включил: бота на встрече
// видят и внешние участники, а календарь многие подключали ради рекордера. Источник истины —
// `allowed_users.scriba_autojoin` (по умолчанию false); его читает meeting-calendar на каждом опросе.
// Выключение гасит и заведённые, но не забранные задания — это делает сам опрос (meeting-calendar/
// sweep.ts), здесь только флаг.
//
// Личность — из авторизации веба (её уже проверил index.ts); тело задаёт только `enabled`, поэтому
// включить бота коллеге нельзя. Демо не включает бота никому.
//
//   GET /scriba/autojoin                     200 { enabled: boolean }
//   PUT /scriba/autojoin { enabled: bool }   200 { enabled: boolean }
//   Ошибка = { error: <EN>, error_ru: <RU>, code } · 400 invalid_body · 403 demo_not_allowed ·
//            404 not_found (строки человека нет) · 405 method_not_allowed · 500 сбой базы
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";

export const AUTOJOIN_PATH = "/scriba/autojoin";

const ERRORS = {
  invalid_body: { status: 400, en: "Send { enabled: true | false }", ru: "Нужно { enabled: true | false }" },
  demo_not_allowed: {
    status: 403,
    en: "The bot cannot join meetings on its own in the demo",
    ru: "В демо бот сам на встречи не ходит",
  },
  not_found: { status: 404, en: "User not found", ru: "Пользователь не найден" },
  method_not_allowed: { status: 405, en: "Method not allowed", ru: "Метод не поддерживается" },
  store_failed: {
    status: 500,
    en: "Could not save the setting, try again",
    ru: "Не удалось сохранить настройку, повторите",
  },
} as const;

type ErrorCode = keyof typeof ERRORS;

function autojoinErr(code: ErrorCode, origin: string): Response {
  const e = ERRORS[code];
  return json({ error: e.en, error_ru: e.ru, code }, e.status, origin);
}

/** Флаг автозапуска одного человека. `null` / `false` — строки человека нет. */
export interface AutojoinStore {
  read(telegramId: number): Promise<boolean | null>;
  write(telegramId: number, enabled: boolean): Promise<boolean>;
}

export interface AutojoinContext {
  store: AutojoinStore;
  telegramId: number;
  isDemo: boolean;
  origin: string;
}

export function makeAutojoinStore(supabase: SupabaseClient): AutojoinStore {
  return {
    async read(telegramId) {
      const { data, error } = await supabase.from("allowed_users")
        .select("scriba_autojoin").eq("telegram_id", telegramId).maybeSingle();
      if (error) throw new Error(`allowed_users read: ${error.message}`);
      if (!data) return null;
      return (data as { scriba_autojoin?: boolean }).scriba_autojoin === true;
    },
    async write(telegramId, enabled) {
      const { data, error } = await supabase.from("allowed_users")
        .update({ scriba_autojoin: enabled }).eq("telegram_id", telegramId).select("telegram_id");
      if (error) throw new Error(`allowed_users write: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}

async function readEnabled(req: Request): Promise<boolean | null> {
  try {
    const body = await req.json() as { enabled?: unknown } | null;
    return typeof body?.enabled === "boolean" ? body.enabled : null;
  } catch {
    return null;
  }
}

async function route(ctx: AutojoinContext, req: Request): Promise<Response> {
  if (req.method === "GET") {
    const enabled = await ctx.store.read(ctx.telegramId);
    if (enabled === null) return autojoinErr("not_found", ctx.origin);
    return json({ enabled }, 200, ctx.origin);
  }
  if (req.method === "PUT") {
    const enabled = await readEnabled(req);
    if (enabled === null) return autojoinErr("invalid_body", ctx.origin);
    if (!(await ctx.store.write(ctx.telegramId, enabled))) return autojoinErr("not_found", ctx.origin);
    console.log(`[scriba/autojoin] ${ctx.telegramId} → ${enabled ? "включил" : "выключил"}`);
    return json({ enabled }, 200, ctx.origin);
  }
  return autojoinErr("method_not_allowed", ctx.origin);
}

export async function handleAutojoinRoutes(
  ctx: AutojoinContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  if (routePath !== AUTOJOIN_PATH) return null;
  if (ctx.isDemo) return autojoinErr("demo_not_allowed", ctx.origin);
  try {
    return await route(ctx, req);
  } catch (e) {
    console.error(`[scriba/autojoin] ${e instanceof Error ? e.message : String(e)}`);
    return autojoinErr("store_failed", ctx.origin);
  }
}
