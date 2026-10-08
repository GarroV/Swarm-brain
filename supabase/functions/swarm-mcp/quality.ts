// Баллы РС и РКО по пиццериям через MCP (решение владельца 08.10.2026,
// docs/decisions/2026-10-07-home-dashboard-direction.md): загрузка выгрузки листа «Качество по
// пиццериям» и сводка, что загружено. Разбор и запись — в `_shared/quality/`, здесь доступ,
// аргументы и текст ответа. Загружать — только админ; хранится всё, страны режутся при чтении.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { must } from "../_shared/market/db.ts";
import { KIND_TITLE, parseQualitySheet, QualityFormatError, type QualityKind } from "../_shared/quality/sheet.ts";
import { importParsed, qualityStatus, storedUnitCountries } from "../_shared/quality/store.ts";
import { foreignCountries, type UnitMove, unitMoves } from "../_shared/quality/scope.ts";
import { ADMIN_USER_ID } from "./tasks/tools.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Args = Record<string, unknown> & { requesting_user_id: number };
type ToolFn = (args: Args) => Promise<string>;
type Caller = { member: boolean; allowed: string[] | null; isAdmin: boolean; isSuper: boolean };

/** Сколько замечаний показывать в ответе: остальные — числом, чтобы ответ не тонул в списке. */
const MAX_ISSUES = 15;

async function caller(telegramId: number): Promise<Caller> {
  const user = await must<{ group_id: string | null; is_admin: boolean | null } | null>(
    supabase.from("allowed_users").select("group_id, is_admin").eq("telegram_id", telegramId).maybeSingle(),
    "allowed_users",
  );
  const ws = user?.group_id
    ? await must<{ allowed_markets: string[] | null } | null>(
      supabase.from("workspaces").select("allowed_markets").eq("id", user.group_id).maybeSingle(),
      "workspaces",
    )
    : null;
  return {
    member: user !== null,
    // Коды в allowed_markets бывают и строчными: фильтр базы сравнивает строго.
    allowed: ws?.allowed_markets ? ws.allowed_markets.map((m) => m.trim().toUpperCase()) : null,
    isAdmin: telegramId === ADMIN_USER_ID || user?.is_admin === true,
    isSuper: telegramId === ADMIN_USER_ID,
  };
}

function kindArg(v: unknown): QualityKind | undefined | "bad" {
  if (v === undefined || v === null || v === "") return undefined;
  return v === "rs" || v === "rko" ? v : "bad";
}

const today = () => new Date().toISOString().slice(0, 10);

async function toolImport(args: Args): Promise<string> {
  const who = await caller(args.requesting_user_id);
  if (!who.isAdmin) return "Ошибка: загружать баллы РС и РКО может только админ.";
  const kind = kindArg(args.kind);
  if (kind === "bad") return "Ошибка: kind — rs или rko (или не указывать: тип определится по листу).";
  const csv = typeof args.csv === "string" ? args.csv : "";
  if (!csv.trim()) return "Ошибка: csv — содержимое выгрузки листа «Качество по пиццериям» (Файл → Скачать → CSV).";
  let parsed;
  try {
    parsed = parseQualitySheet(csv, { today: today(), kind });
  } catch (e) {
    if (e instanceof QualityFormatError) return `Ошибка: ${e.message}`;
    throw e;
  }
  // Таблица баллов общая для всех воркспейсов: админ воркспейса грузит только свои страны,
  // иначе он перезаписал бы (и удалил исчезнувшее) у чужих. Без ограничений — владелец Swarm.
  const foreign = who.isSuper ? [] : foreignCountries(parsed.countries, who.allowed);
  if (foreign.length) {
    return `Ошибка: в листе есть страны вне твоего воркспейса: ${foreign.join(", ")} — ничего не записано. ` +
      "Загрузить такой лист может только владелец Swarm.";
  }
  if (!parsed.scores.length) {
    return `Ошибка: в листе ${KIND_TITLE[parsed.kind]} не нашлось ни одного балла — ничего не записано.\n` +
      issuesText(parsed.issues);
  }
  // Ключ строки — (вид, пиццерия, начало периода), страна в него не входит: лист с чужим id
  // пиццерии переписал бы её страну. Админу воркспейса такой лист — отказ; владельцу Swarm —
  // замечание (пиццерия страну не меняет, это почти наверняка ошибка в листе).
  const moves = unitMoves(
    parsed.sheetUnits,
    await storedUnitCountries(supabase, parsed.sheetUnits.map((u) => u.id)),
    who.allowed,
  );
  if (moves.length && !who.isSuper) {
    return "Ошибка: пиццерии листа уже записаны в базе под другой страной — ничего не записано:\n" +
      moves.slice(0, MAX_ISSUES).map(moveText).join("\n") +
      (moves.length > MAX_ISSUES ? `\n…и ещё ${moves.length - MAX_ISSUES}` : "") +
      "\nПроверьте ссылки на рейтинг в листе; перенести пиццерию может только владелец Swarm.";
  }
  const issues = [...parsed.issues, ...moves.map((m) => `перенесена в другую страну — ${moveText(m).slice(2)}`)];
  const r = await importParsed(supabase, parsed, args.requesting_user_id);
  const first = parsed.periods[0], last = parsed.periods.at(-1)!;
  return [
    `✅ ${KIND_TITLE[parsed.kind]}: загружено.`,
    `Периоды: ${parsed.periods.length}, ${first.start} — ${last.end}.`,
    `Пиццерий: ${parsed.units}, страны: ${parsed.countries.join(", ")}.`,
    `Баллов записано: ${r.upserted}, удалено исчезнувших из листа: ${r.removed}.`,
    issuesText(issues),
  ].join("\n");
}

const moveText = (m: UnitMove) =>
  `• ${m.name} (${m.id.slice(0, 8)}…): в базе ${m.from}${m.foreign ? " — не твоя страна" : ""}, в листе ${m.to}`;

function issuesText(issues: string[]): string {
  if (!issues.length) return "Замечаний нет.";
  const more = issues.length > MAX_ISSUES ? `\n…и ещё ${issues.length - MAX_ISSUES}` : "";
  return `Замечания (${issues.length}):\n` + issues.slice(0, MAX_ISSUES).map((i) => `• ${i}`).join("\n") + more;
}

async function toolStatus(args: Args): Promise<string> {
  const who = await caller(args.requesting_user_id);
  if (!who.member) return "Ошибка: тебя нет в списке пользователей Swarm.";
  const out: string[] = [];
  for (const kind of ["rs", "rko"] as const) {
    const s = await qualityStatus(supabase, kind, who.allowed);
    if (!s.lastImport) {
      out.push(`${KIND_TITLE[kind]}: не загружено.`);
      continue;
    }
    const cc = Object.entries(s.unitsByCountry).map(([c, n]) => `${c} ${n}`).join(", ");
    out.push(
      `${KIND_TITLE[kind]}: последняя загрузка ${s.lastImport.slice(0, 16).replace("T", " ")} UTC, ` +
        `свежий период с ${s.latestPeriod}. Пиццерий по странам: ${cc}.`,
    );
  }
  return out.join("\n");
}

export const QUALITY_TOOLS: Record<string, ToolFn> = {
  quality_import: toolImport,
  quality_status: toolStatus,
};

const ME = { type: "number", description: "Твой Telegram user ID" };

export const QUALITY_TOOL_DEFINITIONS = [
  {
    name: "quality_import",
    description: "Загрузить баллы РС (стандарты, полумесячные волны) или РКО (клиентский опыт, недели) по " +
      "пиццериям: выгрузка листа «Качество по пиццериям» таблицы «Аналитика IMF» или «Аналитика IMF (РКО)» " +
      "(Файл → Скачать → CSV), содержимое файла целиком в csv. Повторная загрузка того же листа безопасна: " +
      "баллы обновятся, исчезнувшие из листа в загруженных периодах удалятся, старые периоды не трогаются. " +
      "Отвечает сводкой и замечаниями (незнакомая страна, нет ссылки на рейтинг, не балл в ячейке). Только админ.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["rs", "rko"], description: "rs или rko; не указывать — определится по листу" },
        csv: { type: "string", description: "Содержимое CSV-выгрузки листа целиком" },
        requesting_user_id: ME,
      },
      required: ["csv", "requesting_user_id"],
    },
  },
  {
    name: "quality_status",
    description: "Что загружено из баллов РС и РКО: время последней загрузки, самый свежий период, " +
      "сколько пиццерий по каждой стране (только страны твоего воркспейса).",
    inputSchema: {
      type: "object",
      properties: { requesting_user_id: ME },
      required: ["requesting_user_id"],
    },
  },
];
