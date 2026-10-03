// «Анализ рынка» через MCP: шаблон отчёта, что заполнено, чтение и ручной ввод по разделам
// (решение владельца 03.10.2026, спецификация docs/superpowers/specs/2026-10-03-market-mcp-design.md).
// Логика записи — общая с импортом снимка в `_shared/market/`, здесь доступ, разбор аргументов
// и текст ответа агенту. Читать — кто видит страну на вебе; писать — только админ.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allRows, must } from "../_shared/market/db.ts";
import { canSeeCountry } from "../_shared/market/rules.ts";
import { EDITORIAL_BLOCKS } from "../_shared/market/editorial.ts";
import {
  type Change,
  setBlock,
  setCompanyYear,
  setPrice,
  upsertChain,
  upsertLocation,
} from "../_shared/market/manual.ts";
import { countryStatus, templateText } from "../_shared/market/template.ts";
import { ADMIN_USER_ID } from "./tasks/tools.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Args = Record<string, unknown> & { requesting_user_id: number };
type ToolFn = (args: Args) => Promise<string>;

type Caller = { allowed: string[] | null; isAdmin: boolean };

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
  return { allowed: ws?.allowed_markets ?? null, isAdmin: telegramId === ADMIN_USER_ID || user?.is_admin === true };
}

/** Страна из аргументов, если вызывающий её видит; иначе — текст отказа. */
async function country(args: Args, write: boolean): Promise<{ cc: string } | { denied: string }> {
  const cc = String(args.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return { denied: "Ошибка: country — код страны из двух букв, например BG." };
  const who = await caller(args.requesting_user_id);
  if (!canSeeCountry(cc, who.allowed, false)) return { denied: `Ошибка: страна ${cc} тебе не открыта.` };
  if (write && !who.isAdmin) return { denied: "Ошибка: вносить данные рынка может только админ." };
  return { cc };
}

const show = (v: unknown) => (v === null || v === undefined ? "—" : JSON.stringify(v));

/** Журнал ручного ввода: кто, что и по какому источнику внёс. Экран читает журнал по имени
 *  источника, «mcp» среди сборщиков не числится — запись видна только в базе. */
async function audit(cc: string, by: number, what: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("mkt_runs").insert({
    source: "mcp",
    country: cc,
    status: "ok",
    started_at: new Date().toISOString(),
    stats: { by, ...what },
  });
  if (error) console.error("mkt_runs mcp audit:", error.message);
}

async function answer<T>(
  args: Args,
  run: (cc: string) => Promise<Change<T>>,
  label: string,
): Promise<string> {
  const c = await country(args, true);
  if ("denied" in c) return c.denied;
  const r = await run(c.cc);
  if (!r.ok) return `Ошибка: ${r.error}`;
  await audit(c.cc, args.requesting_user_id, { tool: label, source: String(args.source ?? "") });
  return `✅ ${c.cc}, ${label}: записано, на экране — сразу.\nБыло: ${show(r.before)}\nСтало: ${show(r.after)}`;
}

// ── Чтение ──────────────────────────────────────────────────────────────────

function toolTemplate(): Promise<string> {
  return Promise.resolve(templateText());
}

async function toolStatus(args: Args): Promise<string> {
  const c = await country(args, false);
  if ("denied" in c) return c.denied;
  return await countryStatus(supabase, c.cc);
}

const GET_LIMIT = 200;

async function toolGet(args: Args): Promise<string> {
  const c = await country(args, false);
  if ("denied" in c) return c.denied;
  const section = String(args.section ?? "");
  const chain = typeof args.chain === "string" && args.chain ? args.chain : null;
  if (section in EDITORIAL_BLOCKS) {
    const row = await must<{ payload: unknown; updated_at: string } | null>(
      supabase.from("mkt_editorial").select("payload, updated_at").eq("country", c.cc).eq("block", section)
        .maybeSingle(),
      "editorial",
    );
    return row
      ? `${section} (обновлён ${row.updated_at.slice(0, 10)}):\n${JSON.stringify(row.payload)}`
      : `${section}: пусто`;
  }
  if (section === "chains") {
    const rows = await must<unknown[]>(
      supabase.from("mkt_chains").select("key, name, slot, segment, is_bakery, origin").eq("country", c.cc).order(
        "slot",
      ),
      "chains",
    );
    return JSON.stringify(rows);
  }
  if (section === "money") {
    const rows = await allRows<unknown>(
      (a, b) =>
        supabase.from("mkt_companies").select(
          "name, chain_key, reg_id, mkt_financials(year, revenue_eur, employees, source, verification, note)",
        )
          .eq("country", c.cc).order("name").range(a, b),
      "money",
    );
    return JSON.stringify(rows);
  }
  if (section === "locations") {
    let q = supabase.from("mkt_locations")
      .select("id, chain_key, name, city, address, lat, lng, opened, status, closed, source_kind, verification")
      .eq("country", c.cc);
    if (chain) q = q.eq("chain_key", chain);
    if (typeof args.city === "string" && args.city) q = q.ilike("city", `%${args.city}%`);
    const rows = await must<unknown[]>(q.order("chain_key").limit(GET_LIMIT + 1), "locations");
    const more = rows.length > GET_LIMIT ? `\n…больше ${GET_LIMIT} — сузь по chain или city` : "";
    return JSON.stringify(rows.slice(0, GET_LIMIT)) + more;
  }
  if (section === "prices") {
    let q = supabase.from("mkt_prices").select("chain_key, item, size_cm, channel, price_eur, seen_on, source").eq(
      "country",
      c.cc,
    );
    if (chain) q = q.eq("chain_key", chain);
    return JSON.stringify(await must<unknown[]>(q.order("seen_on", { ascending: false }).limit(GET_LIMIT), "prices"));
  }
  return `Ошибка: section — chains, locations, money, prices или блок: ${Object.keys(EDITORIAL_BLOCKS).join(", ")}`;
}

// ── Запись ──────────────────────────────────────────────────────────────────

const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : undefined);

const toolSetBlock: ToolFn = (args) =>
  answer(
    args,
    (cc) => setBlock(supabase, cc, String(args.block ?? ""), args.payload, String(args.source ?? "")),
    `блок ${args.block}`,
  );

const toolSetCompanyYear: ToolFn = (args) =>
  answer(args, (cc) =>
    setCompanyYear(supabase, cc, {
      chain: s(args.chain),
      company: String(args.company ?? ""),
      reg_id: s(args.reg_id),
      year: Number(args.year),
      revenue: Number(args.revenue),
      currency: String(args.currency ?? ""),
      employees: n(args.employees),
      source: String(args.source ?? ""),
      note: s(args.note),
    }), `выручка ${args.company} за ${args.year}`);

const toolUpsertLocation: ToolFn = (args) =>
  answer(args, (cc) =>
    upsertLocation(supabase, cc, {
      id: s(args.id),
      chain: String(args.chain ?? ""),
      name: s(args.name),
      city: s(args.city),
      address: s(args.address),
      lat: n(args.lat),
      lng: n(args.lng),
      opened: s(args.opened),
      status: s(args.status),
      closed: s(args.closed),
      source: String(args.source ?? ""),
      note: s(args.note),
    }), args.id ? "правка точки" : "точка");

const toolUpsertChain: ToolFn = (args) =>
  answer(args, (cc) =>
    upsertChain(supabase, cc, {
      key: String(args.key ?? ""),
      name: String(args.name ?? ""),
      kind: s(args.kind),
      origin: s(args.origin),
      notes: s(args.notes),
    }), `сеть ${args.key}`);

const toolSetPrice: ToolFn = (args) =>
  answer(args, (cc) =>
    setPrice(supabase, cc, {
      chain: String(args.chain ?? ""),
      item: String(args.item ?? ""),
      price: Number(args.price),
      currency: String(args.currency ?? ""),
      size_cm: n(args.size_cm),
      channel: s(args.channel),
      item_type: s(args.item_type),
      seen_on: s(args.seen_on),
      source: String(args.source ?? ""),
    }), `цена ${args.chain} ${args.item}`);

export const MARKET_TOOLS: Record<string, ToolFn> = {
  market_template: toolTemplate,
  market_status: toolStatus,
  market_get: toolGet,
  market_set_block: toolSetBlock,
  market_set_company_year: toolSetCompanyYear,
  market_upsert_location: toolUpsertLocation,
  market_upsert_chain: toolUpsertChain,
  market_set_price: toolSetPrice,
};

const ME = { type: "number", description: "Твой Telegram user ID" };
const CC = { type: "string", description: "Код страны, например BG, HR, RS" };
const SRC = { type: "string", description: "Источник: ссылка на документ или «внутренняя выгрузка Dodo». Обязателен" };
const str = (description: string) => ({ type: "string", description });
const numb = (description: string) => ({ type: "number", description });
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties: { ...properties, requesting_user_id: ME },
  required: [...required, "requesting_user_id"],
});

export const MARKET_TOOL_DEFINITIONS = [
  {
    name: "market_template",
    description: "Шаблон отчёта «Анализ рынка»: разделы экрана, что собирается само, чем вносить руками, " +
      "форма каждого блока с примером. Читай перед заполнением страны.",
    inputSchema: schema({}, []),
  },
  {
    name: "market_status",
    description: "Что заполнено по стране: точки, деньги, цены, блоки ручной части, свежесть источников.",
    inputSchema: schema({ country: CC }, ["country"]),
  },
  {
    name: "market_get",
    description: "Что записано по стране сейчас. section: chains, locations (фильтры chain, city), money, prices " +
      "или имя блока ручной части (summary, events, ratings…). Перед правкой блока — прочитай его целиком.",
    inputSchema: schema({ country: CC, section: str("Раздел или блок"), chain: str("Ключ сети"), city: str("Город") }, [
      "country",
      "section",
    ]),
  },
  {
    name: "market_set_block",
    description: "Записать блок ручной части страны целиком (сводка, события, оценки, доставка, таблица пиццерий…). " +
      "Форма блока — в market_template. Блок заменяется полностью. Только админ.",
    inputSchema: schema({
      country: CC,
      block: str(`Блок: ${Object.keys(EDITORIAL_BLOCKS).join(", ")}`),
      payload: { description: "Содержимое блока: массив или объект по форме из шаблона" },
      source: SRC,
    }, ["country", "block", "payload", "source"]),
  },
  {
    name: "market_set_company_year",
    description: "Выручка юрлица за год (раздел «Деньги»). Валюта EUR или с фиксированным курсом (BGN, HRK) — " +
      "пересчёт в евро сделает Swarm. Прибыль не вносится. Только админ.",
    inputSchema: schema({
      country: CC,
      chain: str("Ключ сети, если юрлицо — оператор сети"),
      company: str("Юрлицо, как в реестре"),
      reg_id: str("Регистрационный номер (ЕИК, OIB, МБ…)"),
      year: numb("Год отчёта"),
      revenue: numb("Выручка от продаж, полной суммой (не в тысячах)"),
      currency: str("EUR, BGN или HRK"),
      employees: numb("Число сотрудников, если есть в отчёте"),
      source: SRC,
      note: str("Пометка: что именно за строка отчёта, консолидировано ли"),
    }, ["country", "company", "year", "revenue", "currency", "source"]),
  },
  {
    name: "market_upsert_location",
    description: "Точка на карте: без id — добавить новую (нужны chain, name, lat, lng), с id из market_get — " +
      "поправить или закрыть (closed = дата закрытия; статус без явного status не меняется). Сборщик OSM поправленную " +
      "руками точку не трогает. Пиццерии Dodo ведёт API Dodo — их дату открытия уточняй блоком location_dates. Только админ.",
    inputSchema: schema({
      country: CC,
      id: str("id точки из market_get — для правки"),
      chain: str("Ключ сети"),
      name: str("Название точки"),
      city: str("Город"),
      address: str("Адрес"),
      lat: numb("Широта"),
      lng: numb("Долгота"),
      opened: str("Дата открытия: ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД"),
      status: str("open, closed, planned или paused"),
      closed: str("Дата закрытия"),
      source: SRC,
      note: str("Пометка проверки"),
    }, ["country", "source"]),
  },
  {
    name: "market_upsert_chain",
    description: "Завести сеть в стране или поправить её название и тип. Только админ.",
    inputSchema: schema({
      country: CC,
      key: str("Ключ сети латиницей: pizza-hut"),
      name: str("Название, как пишет сеть"),
      kind: str("pizza, bakery или other"),
      origin: str("Страна происхождения сети"),
      notes: str("Пометка"),
    }, ["country", "key", "name"]),
  },
  {
    name: "market_set_price",
    description: "Цена позиции меню сети на дату (раздел цен у пицца-сетей). Только админ.",
    inputSchema: schema({
      country: CC,
      chain: str("Ключ сети"),
      item: str("Позиция, например Margherita"),
      price: numb("Цена"),
      currency: str("EUR, BGN или HRK"),
      size_cm: numb("Размер пиццы, см"),
      channel: str("Канал: delivery, pickup, restaurant"),
      item_type: str("Тип позиции"),
      seen_on: str("Дата цены ГГГГ-ММ-ДД, по умолчанию сегодня"),
      source: SRC,
    }, ["country", "chain", "item", "price", "currency", "source"]),
  },
];
