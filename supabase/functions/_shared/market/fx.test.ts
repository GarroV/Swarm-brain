import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  FxError,
  type FxGet,
  fxNote,
  fxRate,
  parseCbaRange,
  parseCbrCross,
  parseNbrbDynamics,
  parseValuteXml,
  periodDates,
} from "./fx.ts";
import { eurRate } from "./manual.ts";

// Образцы настоящих ответов банков (сняты 03.11.2026, оставлены евро и доллар).
const fx = (name: string) => Deno.readTextFileSync(new URL(`./fx-fixtures/${name}`, import.meta.url));

Deno.test("parseNbrbDynamics: daily EUR rates in BYN", () => {
  const r = parseNbrbDynamics(fx("nbrb-eur-dynamics.json"));
  assertEquals(r.length, 5);
  assertEquals(r[0], { date: "2026-09-01", rate: 3.5467 });
});

Deno.test("parseValuteXml: EUR from NBM, NBT and CBAR layouts", () => {
  assertEquals(parseValuteXml(fx("bnm-2026-09-15.xml"), "НБМ"), 20.1111);
  assertEquals(parseValuteXml(fx("nbt-2026-09-15.xml"), "НБТ"), 10.6855);
  assertEquals(parseValuteXml(fx("cbar-2026-09-15.xml"), "ЦБАР"), 1.9613);
});

Deno.test("parseValuteXml: nominal above 1 divides the rate", () => {
  const xml = "<ValCurs><Valute><CharCode>EUR</CharCode><Nominal>10</Nominal><Value>200,5</Value></Valute></ValCurs>";
  assertEquals(parseValuteXml(xml, "банк"), 20.05);
});

Deno.test("parseCbaRange: only EUR rows, one per day", () => {
  const r = parseCbaRange(fx("cba-eur-range.xml"));
  assertEquals(r.map((x) => x.date), ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  assertEquals(r[0].rate, 422.18);
});

Deno.test("broken bank answers are refused, not turned into a rate", () => {
  assertThrows(() => parseNbrbDynamics("<html>blocked</html>"), FxError);
  assertThrows(() => parseNbrbDynamics('{"error":1}'), FxError);
  assertThrows(() => parseNbrbDynamics('[{"Date":"2026-09-01T00:00:00","Cur_OfficialRate":"n/a"}]'), FxError);
  assertThrows(() => parseValuteXml(fx("bnm-2026-09-15.xml").replace(/EUR/g, "XXX"), "НБМ"), FxError);
  assertThrows(() => parseValuteXml("<ValCurs></ValCurs>", "НБМ"), FxError);
  assertThrows(
    () => parseValuteXml("<Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>0</Value></Valute>", "НБМ"),
    FxError,
  );
  assertThrows(() => parseCbaRange(fx("cba-eur-range.xml").replace(/<ISO>EUR/g, "<ISO>CHF")), FxError);
});

Deno.test("periodDates: month is every day, year is sampled, future days are cut", () => {
  assertEquals(periodDates("2026-02", "2026-12-31").length, 28);
  assertEquals(periodDates("2025", "2026-12-31").length, 48);
  assertEquals(periodDates("2025", "2025-03-10").length, 10);
  assertEquals(periodDates("2026-09-15", "2026-12-31"), ["2026-09-15"]);
  assertThrows(() => periodDates("sept", "2026-12-31"), FxError);
});

/** Банк, где курс = число месяца: среднее за 30 дней сентября известно заранее. */
const dailyBank: FxGet = (url) => {
  const day = Number(/date=(\d{2})\.\d{2}\.2026/.exec(url)?.[1]);
  return Promise.resolve(
    `<ValCurs><Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>${20 + day / 100}</Value></Valute></ValCurs>`,
  );
};

Deno.test("fxRate: month average over daily rates (MDL)", async () => {
  const r = await fxRate("mdl", "2026-09", dailyBank, "2026-11-03");
  assertEquals(r.days, 30);
  assertEquals(r.bank, "НБМ");
  assertEquals(r.rate, 20.155); // 20 + mean(1..30)/100
  assertEquals(fxNote("MDL", r), "курс 1 € = 20.155 MDL (НБМ, среднее за 2026-09 по 30 дн.)");
});

Deno.test("fxRate: range bank answers a month with one request (BYN)", async () => {
  let calls = 0;
  const get: FxGet = () => {
    calls++;
    return Promise.resolve(fx("nbrb-eur-dynamics.json"));
  };
  const r = await fxRate("BYN", "2026-09", get, "2026-11-03");
  assertEquals(calls, 1);
  assertEquals(r.rate, 3.5592); // mean of the five fixture days; only the days inside the month count
});

Deno.test("fxRate: a day without publication falls back to the previous published one", async () => {
  const get: FxGet = (url) =>
    url.includes("date=14.09.2026") || url.includes("date=15.09.2026")
      ? Promise.reject(new FxError("HTTP 404"))
      : dailyBank(url);
  const r = await fxRate("MDL", "2026-09-15", get, "2026-11-03");
  assertEquals(r.rate, 20.13);
});

Deno.test("fxRate: bank down or mostly silent -> refusal with a reason, never a rate", async () => {
  const down: FxGet = () => Promise.reject(new Error("timeout"));
  await assertRejects(() => fxRate("MDL", "2026-09", down, "2026-11-03"), FxError, "НБМ");
  const broken: FxGet = () => Promise.resolve("<html>captcha</html>");
  await assertRejects(() => fxRate("TJS", "2026-09", broken, "2026-11-03"), FxError);
  await assertRejects(() => fxRate("BYN", "2026-09", broken, "2026-11-03"), FxError);
});

Deno.test("parseCbrCross: EUR/RUB over CUR/RUB, nominal of KGS (100) is honoured", () => {
  const xml = fx("cbr-2026-10-15.xml");
  assertEquals(parseCbrCross(xml, "GEL"), 2.9076); // 93.9229 / 32.3020
  assertEquals(parseCbrCross(xml, "KGS"), 97.839); // 93.9229 / (95.9974 / 100)
});

Deno.test("parseCbrCross: broken CBR answer or missing currency is refused", () => {
  const xml = fx("cbr-2026-10-15.xml");
  assertThrows(() => parseCbrCross("<html>maintenance</html>", "GEL"), FxError);
  assertThrows(() => parseCbrCross(xml, "AMD"), FxError);
  assertThrows(() => parseCbrCross(xml.replace("<Value>93,9229</Value>", "<Value></Value>"), "GEL"), FxError);
  assertThrows(() => parseCbrCross(xml.replace("<Nominal>100</Nominal>", "<Nominal>0</Nominal>"), "KGS"), FxError);
});

Deno.test("fxRate: GEL goes through the CBR cross and the source says so; CBR down -> refusal", async () => {
  const ok: FxGet = (url) => {
    assert(url.includes("date_req=15/10/2026"), url);
    return Promise.resolve(fx("cbr-2026-10-15.xml"));
  };
  const r = await fxRate("GEL", "2026-10-15", ok);
  assertEquals([r.rate, r.bank], [2.9076, "ЦБ РФ, кросс EUR/RUB и GEL/RUB"]);
  await assertRejects(
    () => fxRate("KGS", "2026-10", () => Promise.reject(new Error("timeout")), "2026-11-03"),
    FxError,
    "ЦБ РФ",
  );
  await assertRejects(() => fxRate("XYZ", "2026-09", dailyBank), FxError, "XYZ");
});

Deno.test("eurRate: fixed currencies need no bank; bank currencies use it; failure is an error, not an empty euro", async () => {
  const never = () => Promise.reject(new Error("must not be called"));
  const bgn = await eurRate("bgn", "2026-09-15", never);
  assert(bgn.ok && Math.round(bgn.convert(195.583)) === 100);
  const ok = await eurRate(
    "MDL",
    "2026-09-15",
    () => Promise.resolve({ rate: 20, bank: "НБМ", days: 1, period: "2026-09-15" }),
  );
  assert(ok.ok && ok.convert(100) === 5 && ok.note?.includes("НБМ"));
  const bad = await eurRate("MDL", "2026-09-15", () => Promise.reject(new FxError("НБМ: курс не получен")));
  assert(!bad.ok && bad.error.includes("запись не сделана"));
  const other = await eurRate("USD", "2026-09-15", never);
  assert(!other.ok && other.error.includes("MDL"));
});
