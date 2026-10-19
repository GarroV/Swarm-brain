// MCP: проверки Децимуса (блок 3, решение 11.10.2026) — get_inspections и get_inspection. Данные живые,
// из API Децимуса (Swarm их не хранит); воркспейс обязателен, страны режутся по allowed_markets, как у
// GET /inspections в swarm-api. Ответ — текст: компактная таблица и деталь с нарушениями.
// Линт просит короткое имя из карты импортов; см. пояснение в swarm-api/sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decimusGet,
  DecimusHttpError,
  DecimusNotConfigured,
  decimusPageUrl,
  workspaceCountries,
} from "../_shared/decimus.ts";
import { formatInspectionDetail, formatInspectionsTable } from "../_shared/inspections-format.ts";
import { toInspectionDetail, toInspectionsView } from "../_shared/inspections-view.ts";
import { resolveGroupId } from "./tasks/tools.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DEFAULT_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_IDENTITY = "Ошибка: личность не определена (нужен токен коннектора).";
const NOT_FOUND = "Проверка не найдена.";
const SOURCE_DOWN = "Источник проверок (Децимус) сейчас недоступен — попробуй позже.";

type Args = Record<string, unknown> & { requesting_user_id?: number };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Воркспейс вызывающего и его страны; иначе — текст отказа. */
async function scope(args: Args): Promise<{ countries: string[] | null } | { denied: string }> {
  if (!args.requesting_user_id) return { denied: NO_IDENTITY };
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return { denied: NO_IDENTITY };
  return { countries: await workspaceCountries(supabase, groupId) };
}

function failure(tool: string, e: unknown): string {
  // Подробность — в лог, человеку — общая фраза (как в swarm-api: тело ответа Децимуса наружу не отдаём).
  console.error(`[${tool}]`, e instanceof Error ? e.message : e);
  return e instanceof DecimusNotConfigured ? "Источник проверок не настроен." : SOURCE_DOWN;
}

async function toolGetInspections(args: Args): Promise<string> {
  const s = await scope(args);
  if ("denied" in s) return s.denied;
  const now = new Date();
  const from = String(args.from ?? isoDay(new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS)));
  const to = String(args.to ?? isoDay(now));
  if (!DATE.test(from) || !DATE.test(to)) return "Ошибка: from и to — даты вида 2026-10-02.";
  let countries = s.countries;
  const cc = args.country ? String(args.country).trim().toUpperCase() : "";
  if (cc) {
    if (!/^[A-Z]{2}$/.test(cc)) return "Ошибка: country — код страны из двух букв, например RS.";
    if (countries && !countries.includes(cc)) return `Ошибка: страна ${cc} тебе не открыта.`;
    countries = [cc];
  }
  if (countries && !countries.length) return "Проверок по этим условиям нет.";
  try {
    const body = await decimusGet("/api/v1/inspections", { countries: countries?.join(","), from, to });
    const view = toInspectionsView(body, countries);
    const unit = String(args.unit ?? "").trim().toLowerCase();
    const rows = unit ? view.inspections.filter((r) => r.unit.name.toLowerCase().includes(unit)) : view.inspections;
    return formatInspectionsTable(rows, view.truncated);
  } catch (e) {
    return failure("get_inspections", e);
  }
}

async function toolGetInspection(args: Args): Promise<string> {
  const s = await scope(args);
  if ("denied" in s) return s.denied;
  const id = String(args.id ?? "").trim();
  if (!UUID.test(id)) return "Ошибка: id — uuid проверки из get_inspections.";
  if (s.countries && !s.countries.length) return NOT_FOUND;
  try {
    const d = toInspectionDetail(await decimusGet(`/api/v1/inspections/${id}`), s.countries);
    return d ? formatInspectionDetail(d, decimusPageUrl(d.inspection.path)) : NOT_FOUND;
  } catch (e) {
    // «Нет такой» и «чужая страна» отвечают одинаково — перебором id чужую проверку не подтвердить.
    if (e instanceof DecimusHttpError && e.status === 404) return NOT_FOUND;
    return failure("get_inspection", e);
  }
}

export const INSPECTION_TOOLS: Record<string, (args: Args) => Promise<string>> = {
  get_inspections: toolGetInspections,
  get_inspection: toolGetInspection,
};

export { INSPECTION_TOOL_DEFINITIONS } from "./inspections-defs.ts";
