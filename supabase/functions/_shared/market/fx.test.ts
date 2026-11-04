import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  cbrCrossRange,
  FxError,
  type FxGet,
  fxNote,
  fxRate,
  parseCbaRange,
  parseCbrDynamic,
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

// Ряды ЦБ РФ XML_dynamic 28.12.2023–10.01.2024 (сняты 04.11.2026): EUR R01239, GEL R01210, KGS R01370 (Nominal 10).
const cbrDyn = (id: string) => fx(`cbr-dynamic-${id}-2023-12-28.xml`);
const cbrByUrl: FxGet = (url) => {
  const id = /VAL_NM_RQ=(R\d+)/.exec(url)?.[1];
  return id ? Promise.resolve(cbrDyn(id)) : Promise.reject(new Error(`unexpected ${url}`));
};

Deno.test("parseCbrDynamic + cbrCrossRange: EUR/RUB over CUR/RUB by day, nominal of KGS (10) is honoured", () => {
  const eur = parseCbrDynamic(cbrDyn("R01239"), "EUR");
  assertEquals(eur.length, 4);
  assertEquals(cbrCrossRange(eur, parseCbrDynamic(cbrDyn("R01210"), "GEL"))[0], { date: "2023-12-28", rate: 2.9737 });
  assertEquals(cbrCrossRange(eur, parseCbrDynamic(cbrDyn("R01370"), "KGS"))[0], { date: "2023-12-28", rate: 98.3876 });
});

Deno.test("parseCbrDynamic: broken CBR answer is refused; a day missing in one series is skipped", () => {
  assertThrows(() => parseCbrDynamic("<html>maintenance</html>", "GEL"), FxError);
  assertThrows(
    () => parseCbrDynamic(cbrDyn("R01210").replace("<Value>34,0810</Value>", "<Value></Value>"), "GEL"),
    FxError,
  );
  assertThrows(
    () => parseCbrDynamic(cbrDyn("R01370").replace("<Nominal>10</Nominal>", "<Nominal>0</Nominal>"), "KGS"),
    FxError,
  );
  const eur = parseCbrDynamic(cbrDyn("R01239"), "EUR");
  assertEquals(cbrCrossRange(eur, parseCbrDynamic(cbrDyn("R01210"), "GEL").slice(1)).length, 3);
});

Deno.test("fxRate: GEL/KGS — two range requests to CBR (not one per day); day = last published; CBR down -> refusal", async () => {
  const urls: string[] = [];
  const spy: FxGet = (url, init) => (urls.push(url), cbrByUrl(url, init));
  const day = await fxRate("GEL", "2024-01-05", spy, "2026-11-04");
  assertEquals([day.rate, day.bank], [2.9784, "ЦБ РФ, кросс EUR/RUB и GEL/RUB"]); // 30.12.2023: 99.1919 / 33.3042
  const year = await fxRate("GEL", "2024", spy, "2026-11-04");
  assertEquals([year.rate, year.days], [2.943, 1]); // в фикстуре из 2024 года только 10.01
  assertEquals(urls.length, 4);
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
