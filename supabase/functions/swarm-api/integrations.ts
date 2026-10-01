// Подключение интеграций человека: Google-календарь и ключ Granola (issue #573).
//
// Интеграция пишется в `user_integrations` за личностью из авторизации веба (её уже проверил
// index.ts); тело запроса личность не задаёт. Демо-сессия общая для всех посетителей витрины:
// привязка, сделанная одним, достанется следующим, поэтому демо подключать интеграции не может
// вовсе — отказ здесь, на сервере, а не только спрятанной кнопкой в вебе. Календарь подключается
// на CF Pages (miniapp/functions/api/auth/google/*) и сохраняется через google-oauth/link — там
// стоит тот же отказ. Отключение (DELETE) демо не запрещено: оно только убирает своё.
//
//   GET  /google/connect-url                 200 { url }  — путь потока на CF Pages
//   POST /integrations/granola { api_key }   204
//   Ошибка = { error: <EN>, error_ru: <RU>, code } · 400 invalid_body · 400 invalid_key ·
//            403 demo_not_allowed
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "./http.ts";
import { externalFetch, VIA_GRANOLA } from "../_shared/external-fetch.ts";

export const GOOGLE_CONNECT_PATH = "/google/connect-url";
export const GRANOLA_PATH = "/integrations/granola";

const ERRORS = {
  invalid_body: { status: 400, en: "Send { api_key: string }", ru: "Нужно { api_key: строка }" },
  invalid_key: { status: 400, en: "Invalid Granola API key", ru: "Неверный ключ Granola" },
  demo_not_allowed: {
    status: 403,
    en: "Integrations cannot be connected in the demo",
    ru: "В демо интеграции не подключаются",
  },
} as const;

type ErrorCode = keyof typeof ERRORS;

function integrationErr(code: ErrorCode, origin: string): Response {
  const e = ERRORS[code];
  return json({ error: e.en, error_ru: e.ru, code }, e.status, origin);
}

export interface IntegrationsContext {
  telegramId: number;
  isDemo: boolean;
  origin: string;
  /** Ключ живой? Спрашивает сам Granola. */
  validateGranolaKey: (key: string) => Promise<boolean>;
  saveGranolaKey: (telegramId: number, key: string) => Promise<void>;
}

export function makeIntegrationsDeps(
  supabase: SupabaseClient,
): Pick<IntegrationsContext, "validateGranolaKey" | "saveGranolaKey"> {
  return {
    async validateGranolaKey(key) {
      const res = await externalFetch("https://public-api.granola.ai/v1/notes?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
      }, VIA_GRANOLA);
      return res.ok;
    },
    async saveGranolaKey(telegramId, key) {
      const { error } = await supabase.from("user_integrations").upsert(
        { telegram_id: telegramId, service: "granola", api_key: key, skipped_note_ids: [] },
        { onConflict: "telegram_id,service" },
      );
      if (error) throw new Error(`user_integrations upsert: ${error.message}`);
    },
  };
}

export async function handleIntegrationConnectRoutes(
  ctx: IntegrationsContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  const isConnectUrl = req.method === "GET" && routePath === GOOGLE_CONNECT_PATH;
  const isGranola = req.method === "POST" && routePath === GRANOLA_PATH;
  if (!isConnectUrl && !isGranola) return null;

  if (ctx.isDemo) return integrationErr("demo_not_allowed", ctx.origin);

  // Поток живёт на CF Pages (/api/auth/google/start?flow=calendar) рядом с веб-сессией: start и
  // callback сами сверяют сессию браузера. Путь относительный — веб открывает его на своём адресе.
  if (isConnectUrl) return json({ url: "/api/auth/google/start?flow=calendar" }, 200, ctx.origin);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationErr("invalid_body", ctx.origin);
  }
  const key = (body as { api_key?: unknown } | null)?.api_key;
  if (typeof key !== "string" || !key.trim()) return integrationErr("invalid_body", ctx.origin);
  if (!(await ctx.validateGranolaKey(key))) return integrationErr("invalid_key", ctx.origin);
  await ctx.saveGranolaKey(ctx.telegramId, key);
  return new Response(null, { status: 204, headers: corsHeaders(ctx.origin) });
}
