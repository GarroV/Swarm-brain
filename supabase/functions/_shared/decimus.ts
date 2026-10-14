// Клиент API чтения Децимуса (GarroV/decimus#567): токен, таймаут, «не настроено», страны воркспейса.
// Общий для swarm-api (/quality, /quality/maps, /inspections) и swarm-mcp (get_inspections). Данных
// Децимуса Swarm не хранит и не пишет — только читает (решение владельца 08.10.2026).
// Линт просит короткое имя из карты импортов; см. пояснение в swarm-api/sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const DECIMUS_TIMEOUT_MS = 10_000;

/** Нет DECIMUS_API_URL / DECIMUS_API_TOKEN: источник не настроен (клиенту — 503, не 500). */
export class DecimusNotConfigured extends Error {
  constructor() {
    super("DECIMUS_API_URL / DECIMUS_API_TOKEN не заданы");
  }
}

/** Децимус ответил не 2xx; status нужен вызывающему (404 «нет такой проверки» — не авария). */
export class DecimusHttpError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`decimus ${status}: ${detail}`);
  }
}

function config(): { base: string; token: string } {
  const base = Deno.env.get("DECIMUS_API_URL");
  const token = Deno.env.get("DECIMUS_API_TOKEN");
  if (!base || !token) throw new DecimusNotConfigured();
  return { base, token };
}

/** GET к Децимусу с токеном и таймаутом; параметры без значения пропускаются; тело — разобранный JSON. */
export async function decimusGet(
  path: string,
  params: Record<string, string | null | undefined> = {},
): Promise<unknown> {
  const { base, token } = config();
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(DECIMUS_TIMEOUT_MS),
  });
  if (!res.ok) throw new DecimusHttpError(res.status, (await res.text()).slice(0, 200));
  return await res.json();
}

/** Ссылка на страницу Децимуса (`path` из ответа API, например «/registry/<uuid>»); без настройки — null. */
export function decimusPageUrl(path: string): string | null {
  const base = Deno.env.get("DECIMUS_API_URL");
  if (!base || !path.startsWith("/")) return null;
  return new URL(path, base).toString();
}

/** Страны воркспейса (allowed_markets, верхний регистр); null — без ограничения, [] — ни одной. */
export async function workspaceCountries(supabase: SupabaseClient, groupId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from("workspaces").select("allowed_markets").eq("id", groupId).maybeSingle();
  if (error) throw new Error(`allowed_markets: ${error.message}`);
  const markets = (data?.allowed_markets as string[] | null) ?? null;
  return markets ? markets.map((m) => m.trim().toUpperCase()) : null;
}
