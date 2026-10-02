import { assertEquals } from "@std/assert";
import { fmtMln, isDerived, moneyYears, pickMoneyRows, sparkPoints } from "./marketMoney.ts";
import type { MarketCompany } from "../types.ts";

const co = (id: string, name: string, chain_key: string | null): MarketCompany => ({ id, chain_key, name, reg_id: null, owner: null, notes: null });

Deno.test("moneyYears: с 2021 по последний год с выручкой, будущее не берёт", () => {
  const fin = [{ year: 2019, revenue_eur: 1 }, { year: 2024, revenue_eur: 5 }, { year: 2025, revenue_eur: null }, { year: 2030, revenue_eur: 9 }];
  assertEquals(moneyYears(fin, 2026), [2021, 2022, 2023, 2024]);
  assertEquals(moneyYears([], 2026), []);
});

Deno.test("fmtMln: два знака до 10 млн, один от 10 млн, «<0,01» вместо нуля", () => {
  assertEquals(fmtMln(9_994_000, true), "9,99");
  assertEquals(fmtMln(12_340_000, false), "12.3");
  assertEquals(fmtMln(3_000, true), "<0,01");
  assertEquals(fmtMln(null, true), null);
});

Deno.test("isDerived: только год перед последним и только с пометкой пересчёта", () => {
  assertEquals(isDerived({ year: 2024, note: "emp DERIVED from YoY", source: null }, 2025), true);
  assertEquals(isDerived({ year: 2024, note: null, source: "~ press" }, 2025), true);
  assertEquals(isDerived({ year: 2023, note: "DERIVED", source: null }, 2025), false);
  assertEquals(isDerived({ year: 2024, note: "filing", source: "registry" }, 2025), false);
});

Deno.test("sparkPoints: шаг 80/(годы−1), минимум внизу на 20, максимум наверху на 2", () => {
  assertEquals(sparkPoints([10, null, 30]), [[0, 20], [80, 2]]);
  assertEquals(sparkPoints([5]), []);
});

Deno.test("pickMoneyRows: префикс по сети или юрлицу, затем ключ сети, без отчётности — мимо", () => {
  const companies = [co("a", "Alpha Foods d.o.o.", "burgo"), co("b", "Beta Group", null), co("c", "Gamma LLC", "pizzo"), co("d", "Delta", "nofin")];
  const names: Record<string, string> = { burgo: "Burgo (drive chain)", pizzo: "Pizzo" };
  const rows = pickMoneyRows(
    [{ prefix: "Burgo", chains: ["burgo"], company: null, label: null }, { prefix: "Beta", chains: null, company: null, label: null }, { prefix: "Zeta", chains: ["pizzo"], company: null, label: null }, { prefix: "Delta", chains: ["nofin"], company: null, label: null }, { prefix: "Nope", chains: null, company: null, label: null }],
    companies,
    (k) => (k ? names[k] ?? null : null),
    (id) => id !== "d",
  );
  assertEquals(rows.map((r) => [r.company.id, r.name]), [["a", "Burgo"], ["b", "Beta"], ["c", "Pizzo"]]);
});

Deno.test("pickMoneyRows: явное юрлицо по рег. номеру — для строки без сети в справочнике", () => {
  const companies = [{ ...co("v", "Virtus services d.o.o.", null), reg_id: "123" }, co("l", "Lumo", null)];
  const rows = pickMoneyRows([{ prefix: "Lumo cafe", chains: null, company: "123", label: null }], companies, () => null, () => true);
  assertEquals(rows.map((r) => [r.company.id, r.name]), [["v", "Lumo cafe"]]);
});

Deno.test("pickMoneyRows: label from editorial names the row as the reference does", () => {
  const companies = [co("d", "Pizza Dom d.o.o.", "dom")];
  const rows = pickMoneyRows([{ prefix: "Dom", chains: ["dom"], company: null, label: "Domino's Pizza" }], companies, () => "Dom", () => true);
  assertEquals(rows.map((r) => r.name), ["Domino's Pizza"]);
});
