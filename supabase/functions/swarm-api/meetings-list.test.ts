import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEntriesQuery } from "./entries-guard.ts";
import { toListRow } from "./meetings-payload.ts";
import {
  applyListFilters,
  ENTRY_LIGHT_COLUMNS,
  hasListFilters,
  LIGHT_PAGE_MAX,
  LIGHT_PAGE_SIZE,
  LIGHT_TITLE_CHARS,
  parseMeetingsListParams,
  toLightRow,
} from "./meetings-list.ts";

const HERE = fromFileUrl(new URL(".", import.meta.url));
const parse = (qs: string) => parseMeetingsListParams(new URLSearchParams(qs), { def: 500, max: 2000 });

// ── Форма лёгкой строки ───────────────────────────────────────────────────────

const heavyRow = {
  id: "m1",
  content: "Планёрка по Польше\n" + "тело транскрипта ".repeat(40),
  summary: "### Тема\n- тезис ".repeat(40),
  list_truncated: true,
  added_by: "granola",
  source: "granola",
  countries: ["PL"],
  entry_type: "meeting",
  entry_date: "2026-10-12",
  group_id: "cee",
  is_private: false,
  owner_id: 7,
  created_at: "2026-10-12T09:00:00Z",
  metadata: {
    title: "Планёрка по Польше",
    confirmed: true,
    recorded_by: "bumblebee",
    attendees: Array.from({ length: 12 }, (_, i) => ({ name: `Человек ${i}`, email: `p${i}@example.com` })),
    identity_key: "granola:abcdef0123456789abcdef0123456789",
    meeting_id: "11111111-2222-3333-4444-555555555555",
    countries_backup_20260730: ["PL"],
    added_by_telegram_id: 7,
  },
};

Deno.test("лёгкая строка не несёт тезисов, участников и служебной metadata", () => {
  const out = toLightRow(heavyRow);
  assertEquals(out.summary, null);
  assertEquals("list_truncated" in out, false);
  assertEquals(Object.keys(out.metadata).sort(), ["confirmed", "recorded_by", "title"]);
  assertEquals(out.truncated, true);
  // то, что рисует список, на месте
  assertEquals(out.id, "m1");
  assertEquals(out.countries, ["PL"]);
  assertEquals(out.entry_date, "2026-10-12");
  assertEquals(out.is_private, false);
});

Deno.test("content в лёгкой строке — только первая строка (из неё строится заголовок)", () => {
  assertEquals(toLightRow(heavyRow).content, "Планёрка по Польше");
  const long = toLightRow({ ...heavyRow, content: "\n\n" + "я".repeat(500) });
  assertEquals(long.content.length, LIGHT_TITLE_CHARS);
  assertEquals(toLightRow({ ...heavyRow, content: null }).content, "");
});

Deno.test("лёгкая строка заметно меньше прежней списочной", () => {
  const before = JSON.stringify(toListRow(heavyRow)).length;
  const after = JSON.stringify(toLightRow(heavyRow)).length;
  assert(after < before / 2, `ожидали сжатие минимум вдвое: было ${before}, стало ${after}`);
});

Deno.test("колонки лёгкого запроса не содержат summary и полного content", () => {
  const cols = ENTRY_LIGHT_COLUMNS.split(",");
  assertEquals(cols.includes("summary"), false);
  assertEquals(cols.includes("content"), false); // только content:content_preview
  assertEquals(cols.includes("content:content_preview"), true);
  for (const dead of ["embedding", "fts", "*"]) assertEquals(cols.includes(dead), false);
});

// ── Параметры ─────────────────────────────────────────────────────────────────

Deno.test("без light=1 лимиты прежние, лёгкий режим выключен", () => {
  const p = parse("");
  assertEquals([p.light, p.limit, p.offset], [false, 500, 0]);
  assertEquals(parse("limit=5000").limit, 2000);
});

Deno.test("light=1: страница по 50, потолок 200, мусорный offset → 0", () => {
  assertEquals(parse("light=1").limit, LIGHT_PAGE_SIZE);
  assertEquals(parse("light=1&limit=99999").limit, LIGHT_PAGE_MAX);
  assertEquals(parse("light=1&limit=0").limit, LIGHT_PAGE_SIZE);
  assertEquals(parse("light=1&offset=-5").offset, 0);
  assertEquals(parse("light=1&offset=abc").offset, 0);
  assertEquals(parse("light=1&offset=100").offset, 100);
});

Deno.test("даты принимаются только настоящие YYYY-MM-DD", () => {
  assertEquals(parse("from=2026-10-12&to=2026-10-13").from, "2026-10-12");
  assertEquals(parse("from=2026-02-31").from, null);
  assertEquals(parse("from=12.10.2026").from, null);
  assertEquals(parse("to=2026-10-12'; drop").to, null);
});

Deno.test("поисковая строка очищается от символов, ломающих условие PostgREST", () => {
  assertEquals(parse('q=a,b)(c"d*e%f_g\\h').q, "a b c d e f g h");
  assertEquals(parse("q=" + "я".repeat(300)).q.length, 100);
  assertEquals(hasListFilters(parse("light=1")), false);
  assertEquals(hasListFilters(parse("q=x")), true);
  assertEquals(hasListFilters(parse("storage=personal")), true);
  assertEquals(hasListFilters(parse("storage=junk")), false);
});

// ── Фильтры накладываются ПОВЕРХ privacy-фильтра ─────────────────────────────

type Call = { method: string; args: unknown[] };

function recordingClient(): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "order", "range", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  const client = {
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test("фильтры экрана добавляются отдельными .or/.eq и не снимают воркспейс и приватность", () => {
  const { client, calls } = recordingClient();
  const base = buildEntriesQuery(client, ENTRY_LIGHT_COLUMNS, { groupId: "cee", telegramId: 42 });
  applyListFilters(
    base as never,
    parse("light=1&q=польша&from=2026-10-12&to=2026-10-13&storage=shared"),
  );
  const ors = calls.filter((c) => c.method === "or").map((c) => String(c.args[0]));
  // privacy-условие из buildEntriesQuery стоит первым и не тронуто
  assert(ors[0].includes("is_private") && ors[0].includes("42"), `privacy-or потерян: ${ors[0]}`);
  assertEquals(calls.some((c) => c.method === "eq" && c.args[0] === "group_id" && c.args[1] === "cee"), true);
  // дальше — условия экрана, каждое своим .or
  assert(ors.some((o) => o.includes("metadata->>title.ilike.") && o.includes("польша")));
  assert(
    ors.some((o) => o.includes("entry_date.gte.2026-10-12") && o.includes("created_at.lt.2026-10-14T00:00:00.000Z")),
  );
  assert(ors.some((o) => o === "is_private.eq.false,is_private.is.null"));
});

Deno.test("«Личное» — .eq is_private=true", () => {
  const { client, calls } = recordingClient();
  applyListFilters(
    buildEntriesQuery(client, "id", { groupId: "g", telegramId: 1 }) as never,
    parse("light=1&storage=personal"),
  );
  assertEquals(calls.some((c) => c.method === "eq" && c.args[0] === "is_private" && c.args[1] === true), true);
});

// ── Роут: пагинация детерминирована, доступ только через хелперы ─────────────

async function meetingsRouteBody(): Promise<string> {
  const src = await Deno.readTextFile(`${HERE}index.ts`);
  const start = src.indexOf('routePath === "/meetings"');
  assert(start > 0, "роут GET /meetings не найден — детектор устарел");
  const end = src.indexOf("POST /meetings/:id/resummarize", start);
  return src.slice(start, end);
}

Deno.test("GET /meetings: порядок с tie-breaker по id и .range — страницы не теряют и не дублируют строки", async () => {
  const body = await meetingsRouteBody();
  assert(body.includes('.order("created_at", { ascending: false })'));
  assert(body.includes('.order("id", { ascending: false })'), "нужен tie-breaker по id");
  assert(body.includes(".range(lp.offset, lp.offset + limit - 1)"));
});

Deno.test("GET /meetings: к entries — только через хелперы доступа", async () => {
  const body = await meetingsRouteBody();
  assertEquals(/from\(\s*"entries"\s*\)/.test(body), false, 'прямой from("entries") в роуте запрещён');
  assert(body.includes("buildEntriesQuery"));
  assert(body.includes("buildReviewQueueQuery"));
});

Deno.test("GET /meetings: очередь вычитки не получает фильтров экрана (они только для списка)", async () => {
  const body = await meetingsRouteBody();
  assert(body.includes("if (!isReviewQueue) q = applyListFilters(q, lp);"));
});
