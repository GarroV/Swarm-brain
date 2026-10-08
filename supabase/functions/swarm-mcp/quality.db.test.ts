// Загрузка баллов РС/РКО через MCP на настоящей базе: грузит только админ, повторная загрузка
// идемпотентна, исчезнувший балл удаляется только в границах загруженного листа, статус видит
// только страны воркспейса. Данные синтетические.
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { QUALITY_TOOLS } from "./quality.ts";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Не задана ${name}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WS = "qa-quality-mcp";
const MEMBER = 990_101, ADMIN = 990_102;
const U1 = "f".repeat(31) + "1", U2 = "f".repeat(31) + "2", U3 = "f".repeat(31) + "3";
const UNITS = [U1, U2, U3];
const link = (id: string) => `https://dodopizza.info/rating#/${id}/1?x=1`;

async function wipe() {
  await sb.from("quality_scores").delete().in("unit_id", UNITS);
  await sb.from("allowed_users").delete().in("telegram_id", [MEMBER, ADMIN]);
  await sb.from("workspaces").delete().eq("id", WS);
}

async function seed() {
  await wipe();
  await sb.from("workspaces").insert({ id: WS, name: "QA quality", allowed_markets: ["RS", "bg"] });
  await sb.from("allowed_users").insert([
    { telegram_id: MEMBER, group_id: WS, added_by: ADMIN, is_admin: false },
    { telegram_id: ADMIN, group_id: WS, added_by: ADMIN, is_admin: true },
  ]);
}

const call = (tool: string, who: number, args: Record<string, unknown>) =>
  QUALITY_TOOLS[tool]({ ...args, requesting_user_id: who });

// Год в подписи явный: без него год выводится от сегодняшней даты, и в середине января два листа
// теста разошлись бы по годам.
const sheet = (weeks: string[], rows: string[]) =>
  ["Неделя рейтинга,,,,," + weeks.map((w) => w.replace(/^(\d\d\.\d\d)/, "$1.2025")).join(","), ...rows].join("\n");

async function stored(): Promise<string[]> {
  const { data } = await sb.from("quality_scores").select("unit_id, period_start, score").in("unit_id", UNITS)
    .order("unit_id").order("period_start");
  return (data ?? []).map((r) => `${r.unit_id.slice(-1)} ${r.period_start} ${Number(r.score)}`);
}

Deno.test("only an admin imports; re-import is idempotent and deletes only inside the imported window", async () => {
  await seed();
  const first = sheet(["05.01 — 11.01", "12.01 — 18.01"], [
    `Dev,Serbia,QA-1,${link(U1)},QA-1,80,81`,
    `,,QA-2,${link(U2)},QA-2,70,71`,
    `Dev,Bulgaria,QA-3,${link(U3)},QA-3,60,61`,
  ]);
  const refused = await call("quality_import", MEMBER, { csv: first });
  assert(refused.includes("только админ"), refused);
  assertEquals(await stored(), []);

  const ok = await call("quality_import", ADMIN, { csv: first });
  assert(ok.startsWith("✅ РКО"), ok);
  const again = await call("quality_import", ADMIN, { csv: first, kind: "rko" });
  assert(again.includes("удалено исчезнувших из листа: 0"), again);
  assertEquals((await stored()).length, 6);

  // Следующая выгрузка: окно сдвинулось на неделю, у QA-1 балл за 12.01 стёрт, QA-2 в листе нет.
  const next = sheet(["12.01 — 18.01", "19.01 — 25.01"], [
    `Dev,Serbia,QA-1,${link(U1)},QA-1,-,85`,
    `Dev,Bulgaria,QA-3,${link(U3)},QA-3,62,63`,
  ]);
  const r = await call("quality_import", ADMIN, { csv: next });
  assert(r.includes("удалено исчезнувших из листа: 1"), r);
  const year = 2025;
  assertEquals(await stored(), [
    `1 ${year}-01-05 80`, // период вне новой выгрузки — остался
    `1 ${year}-01-19 85`, // 12.01 стёрт в листе — удалён
    `2 ${year}-01-05 70`, // пиццерии нет в новом листе — не тронута
    `2 ${year}-01-12 71`,
    `3 ${year}-01-05 60`,
    `3 ${year}-01-12 62`,
    `3 ${year}-01-19 63`,
  ]);

  const status = await call("quality_status", MEMBER, {});
  assert(status.includes("RS 2") && status.includes("BG 1"), status);
  await wipe();
});

Deno.test("a workspace admin cannot import countries outside the workspace markets", async () => {
  await seed();
  await sb.from("workspaces").update({ allowed_markets: ["RS"] }).eq("id", WS);
  const csv = sheet(["05.01 — 11.01"], [
    `Dev,Serbia,QA-1,${link(U1)},QA-1,80`,
    `Dev,Bulgaria,QA-3,${link(U3)},QA-3,60`,
  ]);
  const r = await call("quality_import", ADMIN, { csv });
  assert(r.startsWith("Ошибка") && r.includes("BG") && !r.includes("RS,"), r);
  assertEquals(await stored(), []);
  await wipe();
});

Deno.test("a sheet of the wrong kind is refused before anything is written", async () => {
  await seed();
  const csv = sheet(["05.01 — 11.01"], [`Dev,Serbia,QA-1,${link(U1)},QA-1,80`]);
  const r = await call("quality_import", ADMIN, { csv, kind: "rs" });
  assert(r.startsWith("Ошибка") && r.includes("РКО"), r);
  assertEquals(await stored(), []);
  await wipe();
});

Deno.test("a workspace admin cannot move a stored pizzeria to another country", async () => {
  await seed();
  // Пиццерия U3 уже записана под TR (чужая этому воркспейсу страна) — как будто её загрузил другой.
  await sb.from("quality_scores").insert({
    kind: "rko",
    unit_id: U3,
    unit_name: "QA-TR",
    country_code: "TR",
    period_start: "2025-01-05",
    period_end: "2025-01-11",
    score: 50,
  });
  const csv = sheet(["05.01 — 11.01"], [`Dev,Serbia,QA-x,${link(U3)},QA-x,99`]);
  const r = await call("quality_import", ADMIN, { csv });
  assert(r.startsWith("Ошибка") && r.includes("TR") && r.includes("другой страной"), r);
  assertEquals(await stored(), ["3 2025-01-05 50"]);
  await wipe();
});
