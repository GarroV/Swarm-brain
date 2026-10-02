# «Анализ рынка» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Раздел Swarm «Анализ рынка» с данными по Хорватии, Румынии и Эстонии, которые раз в неделю обновляются кодом, и стенд на MUSPELHEIM для показа владельцу.

**Architecture:** Рыночные данные лежат в новых таблицах `mkt_*` (по стране, не по воркспейсу). Чтение идёт через модуль `swarm-api/market.ts`, доступ режется по `workspaces.allowed_markets`. Запись — двумя путями: импорт снимка админом (`POST /market/:cc/import`) и сборщики в GitHub Actions, которые шлют данные в edge-функцию `market-ingest` по токену. Правила сборщиков (сопоставление, «возможно закрыта», свёртка заказов) — чистые функции в `_shared/market/` под тестами.

**Tech Stack:** Supabase Postgres + Edge Functions (Deno 2), Next.js 16 / React miniapp (Tailwind 4, токены `globals.css`), GitHub Actions, Deno-скрипты.

**Spec:** [docs/superpowers/specs/2026-10-02-market-analysis-design.md](../specs/2026-10-02-market-analysis-design.md) · решение: [docs/decisions/2026-10-02-market-analysis-section.md](../../decisions/2026-10-02-market-analysis-section.md)

## Global Constraints

- Все пути — абсолютные от корня worktree `/Users/garva/orca/workspaces/Swarm-brain/Аналитика-по-конкурентам`.
- Название раздела: RU «Анализ рынка», EN «Market analysis». Каждый пользовательский текст — парой `dt("…", "…")`.
- Каждая новая таблица `public`: `enable row level security` + `revoke all … from anon, authenticated`, политик нет.
- В `swarm-api` запрещён `select("*")` (тест `no-star-select`) и сырые ошибки (тест `no-raw-error`) — только `serverError`.
- Новых npm-зависимостей нет: карта и графики — SVG в коде, контуры стран — статический JSON в `miniapp/public/market/`.
- Реальные данные (снимки HR/RO/EE, выгрузки) — **только** в `~/Documents/workbench/private/market/`, никогда в git: репозиторий публичный, данные Fina нельзя перепубликовать.
- Демо: только вымышленная страна `XD` (Demoland). Демо-сессия видит только `XD`, реальные воркспейсы `XD` не видят.
- Сборщик не переписывает проверенные записи (`official`/`confirmed`/`corrected`/`added`/`internal`): предлагает кандидата. Исключение — точки Dodo из `publicapi.dodois.io`.
- Неудачный запуск сборщика пишет `mkt_runs.status='failed'` и ничего больше не меняет.
- Cron сборщиков: `0 23 * * 0` (UTC, ночь на понедельник = 01:00 по Белграду), у каждого job `timeout-minutes`.
- `miniapp/` и `main` не сливаем без «да» владельца и окна 23:00–06:59; работа идёт в ветке `GarroV/Аналитика-по-конкурентам`.
- Защищённые пути (`.github/protected-paths.txt`) не трогаем; таблицы `projects`/`sprints` не трогаем.

## Review Focus

1. **Повторный импорт того же снимка** — ожидание: ни одного дубля, счётчики те же (Task 3, тест `import is idempotent`).
2. **Источник лёг (Overpass 504, таймаут)** — ожидание: строка `mkt_runs` со статусом `failed`, ни одного кандидата, счётчик недель отсутствия у точек не растёт (Task 5, тест `failed run changes nothing`).
3. **Частичные и пустые даты открытия («2017», «2017-11», null)** — ожидание: точка без даты считается открытой до первого года графика, как в хорватском файле; «2017-11» попадает в 2017 (Task 2, тесты `aliveAtYearEnd`).
4. **Страна не из `allowed_markets`, в том числе `XD` у реального воркспейса и `HR` у демо** — ожидание: 403 на чтение (Task 4, db-тест доступа).
5. **Битый снимок (нет `chains`, точка ссылается на несуществующую сеть, координаты вне диапазона)** — ожидание: 400 с перечнем причин, в базе ничего не изменилось (Task 1 и Task 3).

---

## Файловая структура

| Файл | Ответственность |
|---|---|
| `supabase/migrations/20261003100000_market_tables.sql` | таблицы `mkt_*`, индексы, RLS, revoke |
| `supabase/functions/_shared/market/types.ts` | типы снимка и строк |
| `supabase/functions/_shared/market/snapshot.ts` | `validateSnapshot` — разбор снимка в формате хорватского файла |
| `supabase/functions/_shared/market/geo.ts` | `distanceM`, `matchPoints` |
| `supabase/functions/_shared/market/rules.ts` | `shouldFlagClosed`, `foldDailyOrders`, `toEur`, `canSeeCountry` |
| `supabase/functions/_shared/market/db.ts` | запросы: загрузка страны, импорт, кандидаты, запуски |
| `supabase/functions/swarm-api/market.ts` | `handleMarketRoutes` — чтение и админ-действия |
| `supabase/functions/market-ingest/index.ts` | приём данных сборщиков по токену |
| `scripts/market/lib.ts` | HTTP с User-Agent, отправка в ingest, журнал |
| `scripts/market/dodo.ts`, `osm.ts`, `registry-ee.ts`, `registry-ro.ts` | сборщики |
| `scripts/market/countries/<CC>.ts` | конфиг страны: сети, бренды OSM, юрлица, источники |
| `scripts/market/adapters/*.ts` | адаптеры источников по единому контракту |
| `.github/workflows/market-collect.yml` | расписание и ручной запуск |
| `miniapp/src/lib/marketStats.ts` | производные для экрана (точки на конец года, тренды) |
| `miniapp/src/components/market/*.tsx` | экран и секции |
| `miniapp/public/market/shapes/{HR,RO,EE,XD}.json` | контуры стран (SVG path + проекция) |
| `scripts/seed-demo.sql` | Demoland |

---

### Task 1: Типы и валидатор снимка

**Files:**
- Create: `supabase/functions/_shared/market/types.ts`
- Create: `supabase/functions/_shared/market/snapshot.ts`
- Test: `supabase/functions/_shared/market/snapshot.test.ts`

**Interfaces:**
- Produces: `validateSnapshot(raw: unknown): { ok: true; snapshot: Snapshot } | { ok: false; errors: string[] }`; типы `Snapshot`, `SnapChain`, `SnapLocation`, `SnapCompany`, `SnapFinYear`, `SnapPrice`, `SnapFact`, `SnapDodoMonth`, `Verification`, `LocStatus`.

Снимок — это JSON хорватского файла (`<script id="data">`). Валидатор принимает его как есть, игнорирует производные ключи (`paths`, `proj`, `W`, `H`, `trends`) и приводит к плоскому `Snapshot`.

- [ ] **Step 1: типы**

```ts
// supabase/functions/_shared/market/types.ts
// Снимок страны — формат данных хорватского анализа (01.10.2026), см. спеку «Анализ рынка».
export type Verification = "official" | "confirmed" | "corrected" | "added" | "unverified" | "internal";
export type LocStatus = "open" | "closed" | "planned" | "paused";
export const VERIFICATIONS: Verification[] = ["official", "confirmed", "corrected", "added", "unverified", "internal"];
export const LOC_STATUSES: LocStatus[] = ["open", "closed", "planned", "paused"];
// Записи, которые сборщик не переписывает сам — только через кандидата.
export const TRUSTED: Verification[] = ["official", "confirmed", "corrected", "added", "internal"];

export type SnapChain = {
  key: string; name: string; slot: number; segment: string; bakery: boolean;
  origin: string | null; operator: string | null; first_entry: string | null; notes: string | null;
};
export type SnapLocation = {
  chain: string; name: string; city: string | null; address: string | null;
  lat: number; lng: number; placement: string | null;
  opened: string | null;        // "2017" | "2017-11" | "2017-11-05" | null
  opened_estimated: boolean;
  status: LocStatus; closed: string | null; format: string | null;
  source: string | null; verification: Verification; verification_note: string | null;
};
export type SnapFinYear = {
  year: number; revenue_eur: number | null; net_profit_eur: number | null; employees: number | null;
  source: string | null; verification: Verification; note: string | null;
};
export type SnapCompany = { chain: string | null; name: string; reg_id: string | null; owner: string | null; notes: string | null; years: SnapFinYear[] };
export type SnapPrice = { chain: string; item: string; item_type: string | null; size_cm: number | null; price_eur: number; channel: string | null; source: string | null; seen_on: string | null };
export type SnapFact = { topic: "delivery" | "market" | "deal" | "timeline" | "insight" | "commentary"; date: string | null; text: string; value: string | null; source: string | null };
export type SnapDodoMonth = { month: string; revenue_local: number | null; currency: string; revenue_eur: number | null; units: number | null; orders: Record<string, number> | null; complete: boolean };
export type Snapshot = {
  chains: SnapChain[]; locations: SnapLocation[]; companies: SnapCompany[];
  prices: SnapPrice[]; facts: SnapFact[]; dodo: SnapDodoMonth[];
};
```

- [ ] **Step 2: падающий тест**

```ts
// supabase/functions/_shared/market/snapshot.test.ts
import { assert, assertEquals } from "@std/assert";
import { validateSnapshot } from "./snapshot.ts";

const chain = { key: "dominos", name: "Domino's", slot: 1, segment: "pizza", bakery: false, origin: "US", operator: "X d.o.o.", first_entry: "2019", notes: null };
const loc = { c: "dominos", n: "Domino's Zagreb", city: "Zagreb", a: "Ilica 1", lat: 45.81, lng: 15.97, p: "street", o: "2019-05", oy: 2019, est: false, s: "open", cl: null, cy: null, f: "delivery", src: "https://x", v: "official", vn: null };
const base = { chains: [chain], locs: [loc] };

Deno.test("accepts the Croatia file format and maps short keys", () => {
  const r = validateSnapshot(base);
  assert(r.ok);
  assertEquals(r.snapshot.locations[0], {
    chain: "dominos", name: "Domino's Zagreb", city: "Zagreb", address: "Ilica 1", lat: 45.81, lng: 15.97,
    placement: "street", opened: "2019-05", opened_estimated: false, status: "open", closed: null,
    format: "delivery", source: "https://x", verification: "official", verification_note: null,
  });
});

Deno.test("rejects snapshot without chains", () => {
  const r = validateSnapshot({ locs: [] });
  assert(!r.ok);
  assertEquals(r.errors, ["chains: обязателен непустой массив"]);
});

Deno.test("rejects location of unknown chain and coordinates out of range", () => {
  const r = validateSnapshot({ chains: [chain], locs: [{ ...loc, c: "ghost" }, { ...loc, lat: 145 }] });
  assert(!r.ok);
  assertEquals(r.errors, ["locs[0]: сеть «ghost» не объявлена в chains", "locs[1]: координаты вне диапазона"]);
});

Deno.test("rejects unknown status and verification", () => {
  const r = validateSnapshot({ chains: [chain], locs: [{ ...loc, s: "gone", v: "maybe" }] });
  assert(!r.ok);
  assertEquals(r.errors, ["locs[0]: статус «gone» неизвестен", "locs[0]: статус проверки «maybe» неизвестен"]);
});

Deno.test("maps fin companies, prices, delivery facts and dodo months", () => {
  const r = validateSnapshot({
    ...base,
    fin: { companies: [{ chain: "Domino's", company: "X d.o.o.", oib: "123", owner: null, notes: null,
      years: [{ year: 2025, revenue_eur: 1000, net_profit_eur: 10, employees: 5, source: "fina", v: "confirmed", v_note: null }] }],
      market: [{ fact: "QSR market", value: "€1bn", year: "2025", source: "s" }], deals: [{ date: "2024-01", description: "deal", source: "s" }] },
    prices: { seen: "2026-10-01", items: [{ chain: "Domino's", pizza: "Margherita", pizza_type: "margherita", size: "30 cm", cm: 30, price_eur: 9.5, channel: "wolt", source: "s" }] },
    delivery: { facts: [{ topic: "Wolt", fact: "Wolt revenue", value: "€30m", year: 2025, source: "s" }], timeline: [{ date: "2019-01", event: "Wolt enters", source: "s" }], insights: ["note"] },
    dodo: [{ m: "2025-01", usd: 100, fx: 0.9, eur: 90, units: 2, per: 45 }],
  });
  assert(r.ok);
  assertEquals(r.snapshot.companies[0].chain, "dominos"); // имя сети → ключ
  assertEquals(r.snapshot.companies[0].years[0].verification, "confirmed");
  assertEquals(r.snapshot.prices[0], { chain: "dominos", item: "Margherita", item_type: "margherita", size_cm: 30, price_eur: 9.5, channel: "wolt", source: "s", seen_on: "2026-10-01" });
  assertEquals(r.snapshot.facts.map((f) => f.topic), ["market", "deal", "delivery", "timeline", "insight"]);
  assertEquals(r.snapshot.dodo[0], { month: "2025-01", revenue_local: 100, currency: "USD", revenue_eur: 90, units: 2, orders: null, complete: true });
});
```

- [ ] **Step 3: прогнать — FAIL** (`deno test supabase/functions/_shared/market/snapshot.test.ts` → «Module not found snapshot.ts»).

- [ ] **Step 4: реализация**

```ts
// supabase/functions/_shared/market/snapshot.ts
// Разбор снимка страны. Формат — данные хорватского анализа как есть (короткие ключи точек:
// c/n/a/p/o/est/s/cl/f/src/v/vn). Производные ключи файла (paths/proj/trends/W/H) игнорируются:
// экран считает их сам. Битый снимок отклоняется целиком с перечнем причин — частичный импорт
// оставил бы страну в состоянии, которого не было ни в одном источнике.
import {
  LOC_STATUSES, type LocStatus, type SnapChain, type SnapCompany, type SnapDodoMonth, type SnapFact,
  type SnapLocation, type Snapshot, type SnapPrice, VERIFICATIONS, type Verification,
} from "./types.ts";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): R[] => (Array.isArray(v) ? (v as R[]) : []);
const verif = (v: unknown): Verification => (VERIFICATIONS.includes(v as Verification) ? (v as Verification) : "unverified");

export function validateSnapshot(raw: unknown): { ok: true; snapshot: Snapshot } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const B = (raw ?? {}) as R;
  if (!Array.isArray(B.chains) || B.chains.length === 0) return { ok: false, errors: ["chains: обязателен непустой массив"] };

  const chains: SnapChain[] = arr(B.chains).map((c) => ({
    key: str(c.key) ?? "", name: str(c.name) ?? "", slot: num(c.slot) ?? 0, segment: str(c.segment) ?? "other",
    bakery: c.bakery === true, origin: str(c.origin), operator: str(c.operator), first_entry: str(c.first_entry), notes: str(c.notes),
  }));
  chains.forEach((c, i) => { if (!c.key || !c.name) errors.push(`chains[${i}]: нужны key и name`); });
  const keys = new Set(chains.map((c) => c.key));
  const byName = new Map(chains.map((c) => [c.name.toLowerCase(), c.key]));
  const chainKey = (v: unknown): string | null => {
    const s = str(v);
    if (!s) return null;
    return keys.has(s) ? s : byName.get(s.toLowerCase()) ?? null;
  };

  const locations: SnapLocation[] = [];
  arr(B.locs).forEach((l, i) => {
    const c = str(l.c);
    if (!c || !keys.has(c)) errors.push(`locs[${i}]: сеть «${c}» не объявлена в chains`);
    const lat = num(l.lat), lng = num(l.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push(`locs[${i}]: координаты вне диапазона`);
    if (!LOC_STATUSES.includes(l.s as LocStatus)) errors.push(`locs[${i}]: статус «${l.s}» неизвестен`);
    if (l.v != null && !VERIFICATIONS.includes(l.v as Verification)) errors.push(`locs[${i}]: статус проверки «${l.v}» неизвестен`);
    locations.push({
      chain: c ?? "", name: str(l.n) ?? "", city: str(l.city), address: str(l.a), lat: lat ?? 0, lng: lng ?? 0,
      placement: str(l.p), opened: str(l.o) ?? str(l.oy), opened_estimated: l.est === true,
      status: (l.s as LocStatus) ?? "open", closed: str(l.cl) ?? str(l.cy), format: str(l.f),
      source: str(l.src), verification: verif(l.v), verification_note: str(l.vn),
    });
  });

  const fin = (B.fin ?? {}) as R;
  const companies: SnapCompany[] = arr(fin.companies).map((co) => ({
    chain: chainKey(co.chain), name: str(co.company) ?? str(co.name) ?? "", reg_id: str(co.oib) ?? str(co.reg_id),
    owner: str(co.owner), notes: str(co.notes),
    years: arr(co.years).filter((y) => num(y.year) !== null).map((y) => ({
      year: num(y.year)!, revenue_eur: num(y.revenue_eur), net_profit_eur: num(y.net_profit_eur), employees: num(y.employees),
      source: str(y.source), verification: verif(y.v), note: str(y.v_note) ?? str(y.revenue_note),
    })),
  }));

  const P = (B.prices ?? {}) as R;
  const prices: SnapPrice[] = arr(P.items).flatMap((p) => {
    const c = chainKey(p.chain), price = num(p.price_eur);
    return c && price !== null
      ? [{ chain: c, item: str(p.pizza) ?? str(p.item) ?? "", item_type: str(p.pizza_type), size_cm: num(p.cm), price_eur: price, channel: str(p.channel), source: str(p.source), seen_on: str(P.seen) }]
      : [];
  });

  const D = (B.delivery ?? {}) as R;
  const facts: SnapFact[] = [
    ...arr(fin.market).map((f) => ({ topic: "market" as const, date: str(f.year), text: str(f.fact) ?? "", value: str(f.value), source: str(f.source) })),
    ...arr(fin.deals).map((f) => ({ topic: "deal" as const, date: str(f.date), text: str(f.description) ?? "", value: null, source: str(f.source) })),
    ...arr(D.facts).map((f) => ({ topic: "delivery" as const, date: str(f.year), text: str(f.fact) ?? "", value: str(f.value), source: str(f.source) })),
    ...arr(D.timeline).map((f) => ({ topic: "timeline" as const, date: str(f.date), text: str(f.event) ?? "", value: null, source: str(f.source) })),
    ...(Array.isArray(D.insights) ? (D.insights as unknown[]) : []).flatMap((t) => (str(t) ? [{ topic: "insight" as const, date: null, text: str(t)!, value: null, source: null }] : [])),
  ];

  const dodo: SnapDodoMonth[] = arr(B.dodo).flatMap((d) => {
    const m = str(d.m);
    return m ? [{ month: m, revenue_local: num(d.usd) ?? num(d.revenue_local), currency: num(d.usd) !== null ? "USD" : str(d.currency) ?? "EUR", revenue_eur: num(d.eur), units: num(d.units), orders: null, complete: true }] : [];
  });

  return errors.length ? { ok: false, errors } : { ok: true, snapshot: { chains, locations, companies, prices, facts, dodo } };
}
```

- [ ] **Step 5: прогнать — PASS.** Затем порча: временно заменить в `snapshot.ts` `Math.abs(lat) > 90` на `false`, убедиться, что тест «coordinates out of range» падает с понятным diff, вернуть.

- [ ] **Step 6: проверка на настоящем файле** (не в git):

```bash
mkdir -p ~/Documents/workbench/private/market
python3 - <<'EOF'
import re,json
s=open("/Users/garva/Downloads/Хорватия_ сети QSR.html",encoding="utf-8").read()
open("/Users/garva/Documents/workbench/private/market/HR.snapshot.json","w").write(re.search(r'<script id="data"[^>]*>(.*?)</script>',s,re.S).group(1))
EOF
deno eval 'import {validateSnapshot} from "./supabase/functions/_shared/market/snapshot.ts"; const r=validateSnapshot(JSON.parse(Deno.readTextFileSync(Deno.env.get("HOME")+"/Documents/workbench/private/market/HR.snapshot.json"))); console.log(r.ok ? [r.snapshot.chains.length, r.snapshot.locations.length, r.snapshot.companies.length] : r.errors.slice(0,10))'
```
Expected: `[ 23, 611, 16 ]`. Если ошибки — разобрать: правится валидатор, если файл законный, а не наоборот.

- [ ] **Step 7: что из хорватского файла идёт в ручные источники.** Цель — не воспроизвести страницу, а заполнить то, у чего нет автоматического источника (решение 02.10.2026). Берём: `fin` и годовые периоды `pizzafin` (→ `companies[].years` по `oib`) — источник `manual:fina`; `delivery` — `manual:delivery`; `prices` — `manual:prices`; точки локальных сетей — пока их локатор не написан (`manual:locations`). Не берём: тексты «Ключевых цифр» и таблицу оценок, зашитые в код страницы (сводка считается из данных), `dodo`/`dodoOps` (их доливает сборщик Dodo с `--since 2024-04-01`), производные `paths/proj/trends`. `chains[].hist` (число точек по годам из новостей) → `SnapChain.hist` и колонка `mkt_chains.hist`. Тест Step 2 дополнить случаями `hist` и `pizzafin`.

- [ ] **Step 8: commit** — `git add supabase/functions/_shared/market && git commit -m "feat(market): snapshot types and validator"`

---

### Task 2: Правила — расстояние, сопоставление, «возможно закрыта», свёртка заказов, евро, доступ

**Files:**
- Create: `supabase/functions/_shared/market/geo.ts`, `supabase/functions/_shared/market/rules.ts`
- Create: `miniapp/src/lib/marketStats.ts`
- Test: `supabase/functions/_shared/market/rules.test.ts`, `miniapp/src/lib/marketStats.test.ts`

**Interfaces:**
- Produces:
  - `distanceM(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number`
  - `matchPoints<E extends {id:string;chain:string;lat:number;lng:number}, P extends {chain:string;lat:number;lng:number}>(existing: E[], found: P[], radiusM = 150): { matched: Array<{ existing: E; found: P }>; unmatched: P[]; missing: E[] }`
  - `shouldFlagClosed(loc: { verification: Verification; source_kind: string | null; missing_weeks: number }): boolean` — `true` только если `source_kind === "osm"`, проверка не из `TRUSTED` и `missing_weeks >= 3`.
  - `foldDailyOrders(days: Array<{ date: string; counts: Record<string, number> }>, today: string): Array<{ month: string; orders: Record<string, number>; complete: boolean }>`
  - `toEur(amount: number, currency: string, rates: Record<string, number>): number | null` — `rates` = единиц валюты за 1 EUR.
  - `canSeeCountry(cc: string, allowed: string[] | null, isDemo: boolean): boolean`
  - `aliveAtYearEnd(locs: Array<{opened:string|null;status:string;closed:string|null}>, year: number): number` и `unitsByYear(locs, chains: string[], years: number[]): Record<string, number[]>` (в `marketStats.ts`).

- [ ] **Step 1: падающие тесты**

```ts
// supabase/functions/_shared/market/rules.test.ts
import { assert, assertEquals } from "@std/assert";
import { distanceM, matchPoints } from "./geo.ts";
import { canSeeCountry, foldDailyOrders, shouldFlagClosed, toEur } from "./rules.ts";

Deno.test("distanceM: 0.001° of latitude is ~111 m", () => {
  const d = distanceM({ lat: 45.8, lng: 15.97 }, { lat: 45.801, lng: 15.97 });
  assert(d > 105 && d < 117, String(d));
});

Deno.test("matchPoints pairs same chain within 150 m, never across chains", () => {
  const existing = [{ id: "a", chain: "kfc", lat: 45.8, lng: 15.97 }, { id: "b", chain: "mcd", lat: 45.9, lng: 16.0 }];
  const found = [{ chain: "kfc", lat: 45.8009, lng: 15.97 }, { chain: "kfc", lat: 45.9, lng: 16.0 }];
  const r = matchPoints(existing, found);
  assertEquals(r.matched.map((m) => m.existing.id), ["a"]);
  assertEquals(r.unmatched.length, 1);           // kfc рядом с mcd — не пара
  assertEquals(r.missing.map((e) => e.id), ["b"]);
});

Deno.test("matchPoints: one existing point is matched once", () => {
  const existing = [{ id: "a", chain: "kfc", lat: 45.8, lng: 15.97 }];
  const found = [{ chain: "kfc", lat: 45.8, lng: 15.97 }, { chain: "kfc", lat: 45.8001, lng: 15.97 }];
  const r = matchPoints(existing, found);
  assertEquals(r.matched.length, 1);
  assertEquals(r.unmatched.length, 1);
});

Deno.test("shouldFlagClosed: only osm-sourced, untrusted, 3+ weeks", () => {
  assert(shouldFlagClosed({ verification: "unverified", source_kind: "osm", missing_weeks: 3 }));
  assert(!shouldFlagClosed({ verification: "unverified", source_kind: "osm", missing_weeks: 2 }));
  assert(!shouldFlagClosed({ verification: "official", source_kind: "osm", missing_weeks: 9 }));
  assert(!shouldFlagClosed({ verification: "unverified", source_kind: "snapshot", missing_weeks: 9 }));
});

Deno.test("foldDailyOrders sums by month and marks the current month incomplete", () => {
  const r = foldDailyOrders([
    { date: "2026-09-29", counts: { aggregator: 2, restaurant: 1 } },
    { date: "2026-09-30", counts: { aggregator: 3 } },
    { date: "2026-10-01", counts: { site: 1 } },
  ], "2026-10-02");
  assertEquals(r, [
    { month: "2026-09", orders: { aggregator: 5, restaurant: 1 }, complete: true },
    { month: "2026-10", orders: { site: 1 }, complete: false },
  ]);
});

Deno.test("toEur divides by units-per-euro; EUR passes through; unknown → null", () => {
  assertEquals(toEur(497, "RON", { RON: 4.97 }), 100);
  assertEquals(toEur(10, "EUR", {}), 10);
  assertEquals(toEur(10, "XYZ", {}), null);
});

Deno.test("canSeeCountry: demo sees only XD, real workspace never XD", () => {
  assert(canSeeCountry("XD", null, true));
  assert(!canSeeCountry("HR", ["HR"], true));
  assert(canSeeCountry("HR", ["HR", "RO"], false));
  assert(!canSeeCountry("XD", ["XD"], false));
  assert(!canSeeCountry("EE", null, false));
  assert(canSeeCountry("hr", ["HR"], false));
});
```

```ts
// miniapp/src/lib/marketStats.test.ts
import { assertEquals } from "@std/assert";
import { aliveAtYearEnd, unitsByYear } from "./marketStats.ts";

const locs = [
  { chain: "a", opened: null, status: "open", closed: null },          // без даты — до первого года
  { chain: "a", opened: "2023-11", status: "open", closed: null },
  { chain: "a", opened: "2022", status: "closed", closed: "2024-03" },
  { chain: "a", opened: "2027", status: "planned", closed: null },      // анонс не считается
];

Deno.test("aliveAtYearEnd handles partial dates, closures and announcements", () => {
  assertEquals(aliveAtYearEnd(locs, 2021), 1);
  assertEquals(aliveAtYearEnd(locs, 2022), 2);
  assertEquals(aliveAtYearEnd(locs, 2023), 3);
  assertEquals(aliveAtYearEnd(locs, 2024), 2);
});

Deno.test("unitsByYear groups per chain", () => {
  assertEquals(unitsByYear(locs, ["a"], [2023, 2024]), { a: [3, 2] });
});
```

- [ ] **Step 2: прогнать — FAIL** (`deno test supabase/functions/_shared/market/rules.test.ts miniapp/src/lib/marketStats.test.ts`).

- [ ] **Step 3: реализация**

```ts
// supabase/functions/_shared/market/geo.ts
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Пара — та же сеть и ближе radiusM. Жадно по возрастанию расстояния: одна точка базы
// сопоставляется не больше одного раза, иначе два соседних McDonald's слипались бы в один.
export function matchPoints<
  E extends { id: string; chain: string; lat: number; lng: number },
  P extends { chain: string; lat: number; lng: number },
>(existing: E[], found: P[], radiusM = 150) {
  const pairs: Array<{ e: number; f: number; d: number }> = [];
  existing.forEach((e, ei) => found.forEach((f, fi) => {
    if (e.chain !== f.chain) return;
    const d = distanceM(e, f);
    if (d <= radiusM) pairs.push({ e: ei, f: fi, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const usedE = new Set<number>(), usedF = new Set<number>();
  const matched: Array<{ existing: E; found: P }> = [];
  for (const p of pairs) {
    if (usedE.has(p.e) || usedF.has(p.f)) continue;
    usedE.add(p.e); usedF.add(p.f);
    matched.push({ existing: existing[p.e], found: found[p.f] });
  }
  return {
    matched,
    unmatched: found.filter((_, i) => !usedF.has(i)),
    missing: existing.filter((_, i) => !usedE.has(i)),
  };
}
```

```ts
// supabase/functions/_shared/market/rules.ts
import { TRUSTED, type Verification } from "./types.ts";

export const CLOSE_AFTER_WEEKS = 3;
export const DEMO_COUNTRY = "XD";

// «Возможно закрыта» — только у точки, которую в базу привёл сам OSM и которую никто не
// подтвердил. Проверенную запись отсутствие в OSM не трогает никогда: OSM видит не всё
// (сверка по Хорватии 02.10.2026 — локальные сети ему неизвестны вовсе).
export function shouldFlagClosed(loc: { verification: Verification; source_kind: string | null; missing_weeks: number }): boolean {
  return loc.source_kind === "osm" && !TRUSTED.includes(loc.verification) && loc.missing_weeks >= CLOSE_AFTER_WEEKS;
}

export function foldDailyOrders(days: Array<{ date: string; counts: Record<string, number> }>, today: string) {
  const by = new Map<string, Record<string, number>>();
  for (const d of days) {
    const m = d.date.slice(0, 7);
    const acc = { ...(by.get(m) ?? {}) };
    for (const [k, v] of Object.entries(d.counts)) if (v) acc[k] = (acc[k] ?? 0) + v;
    by.set(m, acc);
  }
  const current = today.slice(0, 7);
  return [...by.keys()].sort().map((month) => ({ month, orders: by.get(month)!, complete: month < current }));
}

export function toEur(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "EUR") return amount;
  const r = rates[currency];
  return r ? Math.round((amount / r) * 100) / 100 : null;
}

export function canSeeCountry(cc: string, allowed: string[] | null, isDemo: boolean): boolean {
  const c = cc.toUpperCase();
  if (isDemo) return c === DEMO_COUNTRY;
  return c !== DEMO_COUNTRY && (allowed ?? []).map((a) => a.toUpperCase()).includes(c);
}
```

```ts
// miniapp/src/lib/marketStats.ts
// Производные «Анализа рынка»: считаются на экране из реестра точек, в базе не хранятся
// (как в хорватском файле: таймлайн, динамика и тренды — из дат открытия/закрытия).
type L = { chain: string; opened: string | null; status: string; closed: string | null };
const yearOf = (s: string | null): number | null => (s && /^\d{4}/.test(s) ? Number(s.slice(0, 4)) : null);

// Точка без даты открытия считается открытой до начала графика; анонс не считается вовсе.
export function aliveAtYearEnd(locs: Omit<L, "chain">[], year: number): number {
  return locs.filter((l) => {
    if (l.status === "planned") return false;
    const o = yearOf(l.opened);
    if (o !== null && o > year) return false;
    const c = yearOf(l.closed);
    return !(l.status === "closed" && c !== null && c <= year);
  }).length;
}

export function unitsByYear(locs: L[], chains: string[], years: number[]): Record<string, number[]> {
  return Object.fromEntries(chains.map((c) => {
    const own = locs.filter((l) => l.chain === c);
    return [c, years.map((y) => aliveAtYearEnd(own, y))];
  }));
}
```

- [ ] **Step 4: прогнать — PASS.** Порча: в `rules.ts` заменить `>= CLOSE_AFTER_WEEKS` на `>= 0` → тест `shouldFlagClosed` падает; в `geo.ts` убрать проверку `usedE.has` → падает «matched once». Вернуть.

- [ ] **Step 5: commit** — `git commit -m "feat(market): matching, closure, order folding and access rules"`

---

### Task 3: Миграция и слой базы (импорт снимка, загрузка страны)

**Files:**
- Create: `supabase/migrations/20261003100000_market_tables.sql`
- Create: `supabase/functions/_shared/market/db.ts`
- Test: `supabase/functions/_shared/market/db.db.test.ts`

**Interfaces:**
- Consumes: `Snapshot` (Task 1).
- Produces:
  - `importSnapshot(sb: SupabaseClient, cc: string, s: Snapshot, by: number): Promise<{ chains: number; locations: number; companies: number; years: number; prices: number; facts: number; dodo: number }>`
  - `loadCountry(sb, cc: string): Promise<CountryBundle>` где `CountryBundle = { country: string; chains; locations; companies; financials; prices; facts; dodo; runs; pending: number }`
  - `listCountriesWithData(sb): Promise<string[]>`
  - `recordRun(sb, run: { source: string; country: string; status: "ok" | "failed"; started_at: string; stats: Record<string, number>; error: string | null }): Promise<void>`
  - `listCandidates(sb, cc)`, `decideCandidate(sb, id: string, accept: boolean, by: number): Promise<"ok" | "not_found" | "already">`

- [ ] **Step 1: миграция**

```sql
-- supabase/migrations/20261003100000_market_tables.sql
-- «Анализ рынка» (решение 02.10.2026, спека docs/superpowers/specs/2026-10-02-market-analysis-design.md).
-- Данные рынка страны, не воркспейса: ключ — код страны ISO-2. Доступ режется в коде по
-- workspaces.allowed_markets. RLS без политик + revoke — клиент в эти таблицы не ходит.
-- ext_key — естественный ключ записи внутри страны: повторный импорт того же снимка обновляет,
-- а не дублирует.

create table public.mkt_chains (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  key text not null,
  name text not null,
  slot int not null default 0,
  segment text not null default 'other',
  is_bakery boolean not null default false,
  origin text, operator text, first_entry text, notes text,
  hist jsonb,                         -- число точек по годам из новостей (когда реестр точек неполон)
  updated_at timestamptz not null default now(),
  unique (country, key)
);

create table public.mkt_locations (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  chain_key text not null,
  ext_key text not null,
  name text not null,
  city text, address text,
  lat double precision not null, lng double precision not null,
  placement text,
  opened text, opened_estimated boolean not null default false,
  status text not null check (status in ('open','closed','planned','paused')),
  closed text, format text,
  source text,
  source_kind text not null default 'snapshot' check (source_kind in ('snapshot','dodo','osm','manual')),
  verification text not null check (verification in ('official','confirmed','corrected','added','unverified','internal')),
  verification_note text,
  missing_weeks int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (country, ext_key),
  foreign key (country, chain_key) references public.mkt_chains (country, key)
);
create index mkt_locations_country_chain on public.mkt_locations (country, chain_key);

create table public.mkt_companies (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  chain_key text,
  name text not null,
  reg_id text,
  owner text, notes text,
  unique (country, name)
);

create table public.mkt_financials (
  company_id uuid not null references public.mkt_companies (id) on delete cascade,
  year int not null check (year between 1990 and 2100),
  revenue_eur numeric, net_profit_eur numeric, employees numeric,
  source text,
  verification text not null check (verification in ('official','confirmed','corrected','added','unverified','internal')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (company_id, year)
);

create table public.mkt_prices (
  id uuid primary key default gen_random_uuid(),
  country text not null, chain_key text not null,
  item text not null, item_type text, size_cm numeric, price_eur numeric not null,
  channel text, source text, seen_on date,
  unique (country, chain_key, item, size_cm, channel, seen_on)
);

create table public.mkt_ratings (
  id uuid primary key default gen_random_uuid(),
  country text not null, chain_key text, location_id uuid references public.mkt_locations (id),
  platform text not null, rating numeric, rating_count int, seen_on date not null
);

create table public.mkt_facts (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  topic text not null check (topic in ('delivery','market','deal','timeline','insight','commentary')),
  date text, text text not null, value text, source text,
  unique (country, topic, text)
);

create table public.mkt_dodo_monthly (
  country text not null, month text not null check (month ~ '^\d{4}-\d{2}$'),
  revenue_local numeric, currency text, revenue_eur numeric, units int,
  orders jsonb, complete boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (country, month)
);

create table public.mkt_candidates (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  kind text not null check (kind in ('new_location','maybe_closed','financial_update')),
  source text not null,
  payload jsonb not null,
  target_id uuid,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  decided_by bigint, decided_at timestamptz,
  created_at timestamptz not null default now()
);
-- Один открытый кандидат на одну и ту же находку: еженедельный прогон не плодит дубли.
create unique index mkt_candidates_pending_once on public.mkt_candidates (country, kind, (payload->>'key')) where status = 'pending';

create table public.mkt_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null, country text not null,
  status text not null check (status in ('ok','failed')),
  started_at timestamptz not null, finished_at timestamptz not null default now(),
  stats jsonb not null default '{}'::jsonb, error text
);
create index mkt_runs_recent on public.mkt_runs (country, source, finished_at desc);

-- Источники страны (из конфига scripts/market/countries/<CC>.ts): что кормит каждый блок,
-- как часто и когда последний раз успешно. Страница показывает возраст данных по ним.
create table public.mkt_sources (
  country text not null, adapter text not null, chain_key text not null default '',
  feeds text not null check (feeds in ('locations','financials','dodo','prices','facts')),
  cadence text not null check (cadence in ('weekly','monthly','yearly','manual')),
  mode text not null check (mode in ('auto','manual','blocked')), reason text,
  last_ok_at timestamptz,
  primary key (country, adapter, chain_key, feeds)
);

do $$ declare t text; begin
  foreach t in array array['mkt_chains','mkt_locations','mkt_companies','mkt_financials','mkt_prices','mkt_ratings','mkt_facts','mkt_dodo_monthly','mkt_candidates','mkt_runs','mkt_sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
```

- [ ] **Step 2: накат локально** — `supabase db reset` (на стенде, см. `make test-db`). Expected: без ошибок; `supabase/functions/_shared/public-tables-locked.db.test.ts` зелёный.

- [ ] **Step 3: падающий db-тест**

```ts
// supabase/functions/_shared/market/db.db.test.ts
// Импорт снимка на настоящей базе: повтор не дублирует, загрузка отдаёт то, что импортировали.
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { importSnapshot, loadCountry } from "./db.ts";
import { validateSnapshot } from "./snapshot.ts";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`Не задана ${name}: прогоняй через ./scripts/with-local-db`);
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CC = "QA"; // тестовая страна, реальные коды не трогаем

const raw = {
  chains: [{ key: "kfc", name: "KFC", slot: 2, segment: "chicken", bakery: false }],
  locs: [
    { c: "kfc", n: "KFC One", city: "A", a: "St 1", lat: 45.8, lng: 15.9, s: "open", o: "2020", v: "official" },
    { c: "kfc", n: "KFC Two", city: "A", a: "St 2", lat: 45.81, lng: 15.91, s: "closed", o: "2019", cl: "2024", v: "confirmed" },
  ],
  fin: { companies: [{ chain: "KFC", company: "KFC Co", oib: "1", years: [{ year: 2025, revenue_eur: 5, v: "confirmed" }] }] },
};

async function wipe() {
  await sb.from("mkt_financials").delete().in("company_id", (await sb.from("mkt_companies").select("id").eq("country", CC)).data?.map((r) => r.id) ?? []);
  for (const t of ["mkt_locations", "mkt_companies", "mkt_prices", "mkt_facts", "mkt_dodo_monthly", "mkt_candidates", "mkt_runs"]) await sb.from(t).delete().eq("country", CC);
  await sb.from("mkt_chains").delete().eq("country", CC);
}

Deno.test("import is idempotent and loadCountry returns it", async () => {
  await wipe();
  const v = validateSnapshot(raw);
  if (!v.ok) throw new Error(v.errors.join("; "));
  const first = await importSnapshot(sb, CC, v.snapshot, 1);
  const second = await importSnapshot(sb, CC, v.snapshot, 1);
  assertEquals(first, second);
  const b = await loadCountry(sb, CC);
  assertEquals(b.locations.length, 2);
  assertEquals(b.chains.map((c) => c.key), ["kfc"]);
  assertEquals(b.financials.length, 1);
  await wipe();
});
```

- [ ] **Step 4: прогнать — FAIL** (`./scripts/with-local-db deno test -A supabase/functions/_shared/market/db.db.test.ts` → нет `db.ts`).

- [ ] **Step 5: реализация `db.ts`**

```ts
// supabase/functions/_shared/market/db.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Snapshot } from "./types.ts";

// Естественный ключ точки: сеть + координаты до 4 знаков (~11 м). Название не входит —
// его правят при проверке, а точка от этого не становится другой.
export const locKey = (chain: string, lat: number, lng: number) => `${chain}:${lat.toFixed(4)}:${lng.toFixed(4)}`;

const LOC_COLS = "id, chain_key, ext_key, name, city, address, lat, lng, placement, opened, opened_estimated, status, closed, format, source, source_kind, verification, verification_note, missing_weeks, first_seen_at, last_seen_at";

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, ctx: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${ctx}: ${error.message}`);
  return data as T;
}

export async function importSnapshot(sb: SupabaseClient, cc: string, s: Snapshot, _by: number) {
  const country = cc.toUpperCase();
  await must(sb.from("mkt_chains").upsert(s.chains.map((c) => ({
    country, key: c.key, name: c.name, slot: c.slot, segment: c.segment, is_bakery: c.bakery,
    origin: c.origin, operator: c.operator, first_entry: c.first_entry, notes: c.notes, updated_at: new Date().toISOString(),
  })), { onConflict: "country,key" }), "chains");

  const locs = new Map(s.locations.map((l) => [locKey(l.chain, l.lat, l.lng), l]));
  await must(sb.from("mkt_locations").upsert([...locs].map(([ext_key, l]) => ({
    country, chain_key: l.chain, ext_key, name: l.name, city: l.city, address: l.address, lat: l.lat, lng: l.lng,
    placement: l.placement, opened: l.opened, opened_estimated: l.opened_estimated, status: l.status, closed: l.closed,
    format: l.format, source: l.source, source_kind: l.verification === "internal" ? "dodo" : "snapshot",
    verification: l.verification, verification_note: l.verification_note, last_seen_at: new Date().toISOString(),
  })), { onConflict: "country,ext_key" }), "locations");

  let years = 0;
  for (const co of s.companies) {
    const row = await must(sb.from("mkt_companies").upsert({ country, chain_key: co.chain, name: co.name, reg_id: co.reg_id, owner: co.owner, notes: co.notes }, { onConflict: "country,name" }).select("id").single(), "company");
    const id = (row as { id: string }).id;
    if (co.years.length) {
      await must(sb.from("mkt_financials").upsert(co.years.map((y) => ({ company_id: id, ...y, updated_at: new Date().toISOString() })), { onConflict: "company_id,year" }), "financials");
      years += co.years.length;
    }
  }
  if (s.prices.length) await must(sb.from("mkt_prices").upsert(s.prices.map((p) => ({ country, chain_key: p.chain, ...p, chain: undefined })), { onConflict: "country,chain_key,item,size_cm,channel,seen_on" }), "prices");
  if (s.facts.length) await must(sb.from("mkt_facts").upsert(s.facts.map((f) => ({ country, ...f })), { onConflict: "country,topic,text" }), "facts");
  if (s.dodo.length) await must(sb.from("mkt_dodo_monthly").upsert(s.dodo.map((d) => ({ country, ...d, updated_at: new Date().toISOString() })), { onConflict: "country,month" }), "dodo");

  return { chains: s.chains.length, locations: locs.size, companies: s.companies.length, years, prices: s.prices.length, facts: s.facts.length, dodo: s.dodo.length };
}

export async function loadCountry(sb: SupabaseClient, cc: string) {
  const country = cc.toUpperCase();
  const [chains, locations, companies, prices, facts, dodo, runs, pending] = await Promise.all([
    must(sb.from("mkt_chains").select("key, name, slot, segment, is_bakery, origin, operator, first_entry, notes").eq("country", country).order("name"), "chains"),
    must(sb.from("mkt_locations").select(LOC_COLS).eq("country", country), "locations"),
    must(sb.from("mkt_companies").select("id, chain_key, name, reg_id, owner, notes").eq("country", country), "companies"),
    must(sb.from("mkt_prices").select("chain_key, item, item_type, size_cm, price_eur, channel, source, seen_on").eq("country", country), "prices"),
    must(sb.from("mkt_facts").select("topic, date, text, value, source").eq("country", country), "facts"),
    must(sb.from("mkt_dodo_monthly").select("month, revenue_local, currency, revenue_eur, units, orders, complete").eq("country", country).order("month"), "dodo"),
    must(sb.from("mkt_runs").select("source, status, started_at, finished_at, stats, error").eq("country", country).order("finished_at", { ascending: false }).limit(30), "runs"),
    sb.from("mkt_candidates").select("id", { count: "exact", head: true }).eq("country", country).eq("status", "pending"),
  ]);
  const ids = (companies as Array<{ id: string }>).map((c) => c.id);
  const financials = ids.length
    ? await must(sb.from("mkt_financials").select("company_id, year, revenue_eur, net_profit_eur, employees, source, verification, note").in("company_id", ids).order("year"), "financials")
    : [];
  return { country, chains, locations, companies, financials, prices, facts, dodo, runs, pending: pending.count ?? 0 };
}
export type CountryBundle = Awaited<ReturnType<typeof loadCountry>>;

export async function listCountriesWithData(sb: SupabaseClient): Promise<string[]> {
  const rows = await must(sb.from("mkt_chains").select("country"), "countries");
  return [...new Set((rows as Array<{ country: string }>).map((r) => r.country))].sort();
}

export async function recordRun(sb: SupabaseClient, run: { source: string; country: string; status: "ok" | "failed"; started_at: string; stats: Record<string, number>; error: string | null }) {
  await must(sb.from("mkt_runs").insert(run), "run");
}

export async function listCandidates(sb: SupabaseClient, cc: string) {
  return await must(sb.from("mkt_candidates").select("id, kind, source, payload, target_id, created_at").eq("country", cc.toUpperCase()).eq("status", "pending").order("created_at"), "candidates");
}

// Принять кандидата: new_location → точка (source_kind=osm, verification=unverified → человек
// подтвердил, ставим confirmed); maybe_closed → статус closed; financial_update → год юрлица.
export async function decideCandidate(sb: SupabaseClient, id: string, accept: boolean, by: number): Promise<"ok" | "not_found" | "already"> {
  const { data: c } = await sb.from("mkt_candidates").select("id, country, kind, payload, target_id, status").eq("id", id).maybeSingle();
  if (!c) return "not_found";
  if (c.status !== "pending") return "already";
  if (accept) {
    const p = c.payload as Record<string, unknown>;
    if (c.kind === "new_location") {
      await must(sb.from("mkt_locations").upsert({ country: c.country, ...(p.row as object), source_kind: "osm", verification: "confirmed" }, { onConflict: "country,ext_key" }), "accept new");
    } else if (c.kind === "maybe_closed" && c.target_id) {
      await must(sb.from("mkt_locations").update({ status: "closed", closed: new Date().toISOString().slice(0, 10) }).eq("id", c.target_id), "accept closed");
    } else if (c.kind === "financial_update") {
      await must(sb.from("mkt_financials").upsert({ ...(p.row as object), verification: "confirmed", updated_at: new Date().toISOString() }, { onConflict: "company_id,year" }), "accept fin");
    }
  }
  await must(sb.from("mkt_candidates").update({ status: accept ? "accepted" : "rejected", decided_by: by, decided_at: new Date().toISOString() }).eq("id", id), "decide");
  return "ok";
}
```

> В `mkt_prices` поле `chain` из `SnapPrice` не колонка: при сборке строки его надо исключить явно — замени `{ country, chain_key: p.chain, ...p, chain: undefined }` на `const { chain, ...rest } = p; ({ country, chain_key: chain, ...rest })`, если supabase-js отправит `chain: undefined` как ключ (проверь на Step 6).

- [ ] **Step 6: прогнать — PASS.** Плюс полный хорватский снимок на локальной базе:

```bash
./scripts/with-local-db deno eval 'import {createClient} from "@supabase/supabase-js"; import {validateSnapshot} from "./supabase/functions/_shared/market/snapshot.ts"; import {importSnapshot} from "./supabase/functions/_shared/market/db.ts"; const sb=createClient(Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")); const v=validateSnapshot(JSON.parse(Deno.readTextFileSync(Deno.env.get("HOME")+"/Documents/workbench/private/market/HR.snapshot.json"))); console.log(await importSnapshot(sb,"HR",v.snapshot,0))'
```
Expected: `locations` = 611 минус дубли по `locKey` (если меньше 611 — вывести пары-дубли и проверить, что это одна и та же точка, а не две соседние; если соседние — уменьшить округление до 5 знаков).

- [ ] **Step 7: commit** — `git commit -m "feat(market): tables and snapshot import"`

---

### Task 4: API раздела в swarm-api

**Files:**
- Create: `supabase/functions/swarm-api/market.ts`
- Modify: `supabase/functions/swarm-api/index.ts` (импорт рядом с `:139`, вызов рядом с `:997`)
- Test: `supabase/functions/swarm-api/market.db.test.ts`

**Interfaces:**
- Consumes: `canSeeCountry` (Task 2), `loadCountry`, `listCountriesWithData`, `importSnapshot`, `listCandidates`, `decideCandidate` (Task 3), `validateSnapshot` (Task 1).
- Produces (HTTP, все под сессией):
  - `GET /market/countries` → `string[]` — страны с данными, видимые воркспейсу.
  - `GET /market/:cc` → `CountryBundle`; 403 если страна не видна.
  - `POST /market/:cc/import` (админ) body = снимок → `200 {counts}` | `400 {error, details: string[]}`.
  - `GET /market/:cc/candidates` (админ) → список; `POST /market/candidates/:id/accept|reject` (админ) → 204 | 404 | 409.
- Сигнатура: `handleMarketRoutes(req, routePath, telegramId, groupId, isAdmin, isDemo, origin): Promise<Response | null>`.

- [ ] **Step 1: падающий db-тест доступа**

```ts
// supabase/functions/swarm-api/market.db.test.ts
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!Deno.env.get(n)) throw new Error(`Не задана ${n}: ./scripts/with-local-db`);
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const { handleMarketRoutes } = await import("./market.ts");

const WS = "t_market";
await sb.from("workspaces").upsert({ id: WS, name: "t market", allowed_markets: ["QB"] });
await sb.from("mkt_chains").upsert([{ country: "QB", key: "a", name: "A" }, { country: "QC", key: "a", name: "A" }, { country: "XD", key: "a", name: "A" }], { onConflict: "country,key" });

const get = (p: string, demo = false, ws = WS) => handleMarketRoutes(new Request("http://x" + p), p, 1, ws, false, demo, "http://x");

Deno.test("market access follows allowed_markets; XD only for demo", async () => {
  assertEquals((await get("/market/QB"))!.status, 200);
  assertEquals((await get("/market/QC"))!.status, 403);
  assertEquals((await get("/market/XD"))!.status, 403);
  assertEquals((await get("/market/XD", true, "demo"))!.status, 200);
  assertEquals((await get("/market/QB", true, "demo"))!.status, 403);
  assertEquals(await (await get("/market/countries"))!.json(), ["QB"]);
});

Deno.test("import is admin-only and rejects a broken snapshot with reasons", async () => {
  const body = JSON.stringify({ locs: [] });
  const asUser = await handleMarketRoutes(new Request("http://x/market/QB/import", { method: "POST", body }), "/market/QB/import", 1, WS, false, false, "http://x");
  assertEquals(asUser!.status, 403);
  const asAdmin = await handleMarketRoutes(new Request("http://x/market/QB/import", { method: "POST", body }), "/market/QB/import", 1, WS, true, false, "http://x");
  assertEquals(asAdmin!.status, 400);
  assertEquals((await asAdmin!.json()).details, ["chains: обязателен непустой массив"]);
});
```

- [ ] **Step 2: FAIL** (`./scripts/with-local-db deno test -A supabase/functions/swarm-api/market.db.test.ts`).

- [ ] **Step 3: реализация**

```ts
// supabase/functions/swarm-api/market.ts
// «Анализ рынка»: чтение данных страны и админ-действия (импорт снимка, очередь кандидатов).
// Данные — рынок страны, не воркспейса: видимость режет canSeeCountry по allowed_markets,
// демо видит только выдуманную XD. Решение 02.10.2026, спека 2026-10-02-market-analysis-design.
import { apiErr, corsHeaders, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { supabase } from "../_shared/supabase.ts";
import { canSeeCountry } from "../_shared/market/rules.ts";
import { decideCandidate, importSnapshot, listCandidates, listCountriesWithData, loadCountry } from "../_shared/market/db.ts";
import { validateSnapshot } from "../_shared/market/snapshot.ts";

async function allowedMarkets(groupId: string): Promise<string[] | null> {
  const { data } = await supabase.from("workspaces").select("allowed_markets").eq("id", groupId).maybeSingle();
  return (data?.allowed_markets as string[] | null) ?? null;
}

export async function handleMarketRoutes(
  req: Request, routePath: string, telegramId: number, groupId: string, isAdmin: boolean, isDemo: boolean, origin: string,
): Promise<Response | null> {
  if (!routePath.startsWith("/market")) return null;
  try {
    const allowed = await allowedMarkets(groupId);
    const visible = (cc: string) => canSeeCountry(cc, allowed, isDemo);

    if (routePath === "/market/countries" && req.method === "GET") {
      return json((await listCountriesWithData(supabase)).filter(visible), 200, origin);
    }

    const decide = routePath.match(/^\/market\/candidates\/([0-9a-f-]{36})\/(accept|reject)$/);
    if (decide && req.method === "POST") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      const r = await decideCandidate(supabase, decide[1], decide[2] === "accept", telegramId);
      if (r === "not_found") return apiErr(404, "Not found", origin);
      if (r === "already") return apiErr(409, "Already decided", origin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const m = routePath.match(/^\/market\/([A-Za-z]{2})(\/import|\/candidates)?$/);
    if (!m) return null;
    const cc = m[1].toUpperCase();
    if (!visible(cc)) return apiErr(403, "Forbidden", origin);

    if (!m[2] && req.method === "GET") return json(await loadCountry(supabase, cc), 200, origin);
    if (m[2] === "/candidates" && req.method === "GET") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      return json(await listCandidates(supabase, cc), 200, origin);
    }
    if (m[2] === "/import" && req.method === "POST") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      const v = validateSnapshot(await req.json().catch(() => null));
      if (!v.ok) return json({ error: "Invalid snapshot", details: v.errors }, 400, origin);
      return json(await importSnapshot(supabase, cc, v.snapshot, telegramId), 200, origin);
    }
    return null;
  } catch (e) {
    return serverError(origin, "market", e);
  }
}
```

В `index.ts`: `import { handleMarketRoutes } from "./market.ts";` и в цепочке модулей
`const marketRes = await handleMarketRoutes(req, routePath, telegramId, groupId, isAdmin, isDemoSession, origin); if (marketRes) return marketRes;` — переменную демо-сессии взять ту, что уже вычисляется у `:604-606` (сверь имя по месту). Если `json()` в `http.ts` не принимает объект с `details` — используй его как есть, он сериализует любой объект (проверь сигнатуру).

> `supabase` из `../_shared/supabase.ts` — сверь, что клиент экспортируется под этим именем (как в `_shared/tasks/db.ts`); если иначе — импортируй тем же путём, что `task-archive.ts` получает клиент через `db.ts`.

- [ ] **Step 4: PASS**, затем `deno check supabase/functions/swarm-api/index.ts`, `deno test supabase/functions/swarm-api/no-star-select.test.ts supabase/functions/swarm-api/no-raw-error.test.ts`. Порча: убрать `if (!isAdmin)` у импорта → тест «admin-only» падает. Вернуть.

- [ ] **Step 5: commit** — `git commit -m "feat(market): read API with per-market access and admin import"`

---

### Task 5: Приём данных сборщиков (`market-ingest`)

**Files:**
- Create: `supabase/functions/market-ingest/index.ts`, `supabase/functions/market-ingest/apply.ts`
- Modify: `supabase/config.toml` (блок `[functions.market-ingest] verify_jwt = false` рядом с `:372`)
- Test: `supabase/functions/market-ingest/apply.db.test.ts`

**Interfaces:**
- Consumes: `matchPoints` (Task 2), `shouldFlagClosed`, `foldDailyOrders`, `recordRun`, `locKey` (Task 3).
- Produces: `POST /market-ingest` с `Authorization: Bearer $MARKET_INGEST_TOKEN`, тело `IngestPayload`:

```ts
export type IngestPayload =
  | { source: "dodo"; country: string; started_at: string; units: Array<{ name: string; city: string | null; address: string | null; lat: number | null; lng: number | null; opened: string | null; open: boolean; organization: string | null }>; days: Array<{ date: string; counts: Record<string, number> }>; revenue: { month: string; amount: number; currency: string; units: number | null } | null }
  | { source: "osm"; country: string; started_at: string; points: Array<{ chain: string; name: string; lat: number; lng: number; city: string | null; address: string | null; osm_id: string }> }
  | { source: "registry"; country: string; started_at: string; years: Array<{ reg_id: string; year: number; revenue_eur: number | null; net_profit_eur: number | null; employees: number | null; source: string }> }
  | { source: string; country: string; started_at: string; failed: string };
```
- `applyIngest(sb, p: IngestPayload, today: string): Promise<Record<string, number>>`.

Правила:
- `failed` → только `recordRun(status:"failed")`.
- `dodo` → точки сети `dodo` upsert с `source_kind="dodo"`, `verification="internal"` (сеть `dodo` создаётся, если её нет); точки без координат пропускаются и считаются в `stats.no_coords`. Заказы — `foldDailyOrders` и слияние с уже лежащими днями месяца в `mkt_dodo_monthly.orders` (храним по дням в `orders._days`, чтобы повторный прогон недели не удвоил месяц). Выручка — в строку месяца.
- `osm` → `matchPoints(existing той же страны, points)`: matched → `last_seen_at=now, missing_weeks=0`; unmatched → кандидат `new_location` с `payload.key=locKey(...)`; missing среди `source_kind='osm'` → `missing_weeks+1`, и если `shouldFlagClosed` → кандидат `maybe_closed` (`payload.key = ext_key`). Точки других `source_kind` при отсутствии в OSM не меняются.
- `registry` → для юрлица с этим `reg_id` в стране: нет года → вставить с `verification="official"`; есть с проверкой из `TRUSTED` и значения отличаются → кандидат `financial_update`; иначе обновить.

- [ ] **Step 1: падающий db-тест**

```ts
// supabase/functions/market-ingest/apply.db.test.ts
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { applyIngest } from "./apply.ts";
for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!Deno.env.get(n)) throw new Error(`Не задана ${n}: ./scripts/with-local-db`);
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CC = "QD";

async function reset() {
  for (const t of ["mkt_candidates", "mkt_runs", "mkt_locations", "mkt_dodo_monthly"]) await sb.from(t).delete().eq("country", CC);
  await sb.from("mkt_chains").delete().eq("country", CC);
  await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC" });
  await sb.from("mkt_locations").insert([
    { country: CC, chain_key: "kfc", ext_key: "trusted", name: "T", lat: 45.8, lng: 15.9, status: "open", verification: "official", source_kind: "snapshot" },
    { country: CC, chain_key: "kfc", ext_key: "osm1", name: "O", lat: 45.9, lng: 16.0, status: "open", verification: "unverified", source_kind: "osm", missing_weeks: 2 },
  ]);
}
const started_at = new Date().toISOString();

Deno.test("failed run changes nothing but is logged", async () => {
  await reset();
  await applyIngest(sb, { source: "osm", country: CC, started_at, failed: "504" }, "2026-10-05");
  const { data: locs } = await sb.from("mkt_locations").select("missing_weeks").eq("country", CC).order("ext_key");
  assertEquals(locs!.map((l) => l.missing_weeks), [2, 0]);
  const { data: runs } = await sb.from("mkt_runs").select("status, error").eq("country", CC);
  assertEquals(runs, [{ status: "failed", error: "504" }]);
  const { count } = await sb.from("mkt_candidates").select("id", { count: "exact", head: true }).eq("country", CC);
  assertEquals(count, 0);
});

Deno.test("osm: new point → candidate once, trusted untouched, osm point flagged after 3 weeks", async () => {
  await reset();
  const p = { source: "osm" as const, country: CC, started_at, points: [{ chain: "kfc", name: "N", lat: 46.5, lng: 16.5, city: null, address: null, osm_id: "n1" }] };
  await applyIngest(sb, p, "2026-10-05");
  await applyIngest(sb, p, "2026-10-12"); // повтор недели — кандидат не дублируется
  const { data: c } = await sb.from("mkt_candidates").select("kind").eq("country", CC).order("kind");
  assertEquals(c!.map((x) => x.kind), ["maybe_closed", "new_location"]);
  const { data: t } = await sb.from("mkt_locations").select("status, missing_weeks").eq("ext_key", "trusted").single();
  assertEquals(t, { status: "open", missing_weeks: 0 });
});

Deno.test("dodo: re-sending the same days does not double the month", async () => {
  await reset();
  const p = { source: "dodo" as const, country: CC, started_at, units: [], revenue: null, days: [{ date: "2026-09-29", counts: { aggregator: 4 } }] };
  await applyIngest(sb, p, "2026-10-05");
  await applyIngest(sb, p, "2026-10-05");
  const { data } = await sb.from("mkt_dodo_monthly").select("orders").eq("country", CC).eq("month", "2026-09").single();
  assertEquals((data!.orders as Record<string, number>).aggregator, 4);
});
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: реализация `apply.ts`**

```ts
// supabase/functions/market-ingest/apply.ts
// Применение данных сборщиков «Анализа рынка». Правила — спека §«Правила сборщиков»:
// Dodo — истина для своих точек; OSM только предлагает; реестр не перезаписывает проверенное.
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPoints } from "../_shared/market/geo.ts";
import { foldDailyOrders, shouldFlagClosed } from "../_shared/market/rules.ts";
import { locKey, recordRun } from "../_shared/market/db.ts";
import { TRUSTED, type Verification } from "../_shared/market/types.ts";
import type { IngestPayload } from "./types.ts";

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, ctx: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${ctx}: ${error.message}`);
  return data as T;
}
const candidate = (sb: SupabaseClient, row: Record<string, unknown>) =>
  // Уникальный частичный индекс mkt_candidates_pending_once гасит повтор той же находки.
  sb.from("mkt_candidates").upsert(row, { onConflict: "country,kind,(payload->>'key')", ignoreDuplicates: true });

export async function applyIngest(sb: SupabaseClient, p: IngestPayload, today: string): Promise<Record<string, number>> {
  const country = p.country.toUpperCase();
  const stats: Record<string, number> = {};
  try {
    if ("failed" in p) {
      await recordRun(sb, { source: p.source, country, status: "failed", started_at: p.started_at, stats, error: p.failed });
      return stats;
    }
    if (p.source === "osm") Object.assign(stats, await applyOsm(sb, country, p.points));
    else if (p.source === "dodo") Object.assign(stats, await applyDodo(sb, country, p, today));
    else if (p.source === "registry") Object.assign(stats, await applyRegistry(sb, country, p.years));
    await recordRun(sb, { source: p.source, country, status: "ok", started_at: p.started_at, stats, error: null });
    return stats;
  } catch (e) {
    await recordRun(sb, { source: p.source, country, status: "failed", started_at: p.started_at, stats, error: String(e) });
    throw e;
  }
}

async function applyOsm(sb: SupabaseClient, country: string, points: Array<{ chain: string; name: string; lat: number; lng: number; city: string | null; address: string | null; osm_id: string }>) {
  const chains = new Set(points.map((x) => x.chain));
  const existing = await must(sb.from("mkt_locations").select("id, chain_key, ext_key, lat, lng, verification, source_kind, missing_weeks").eq("country", country).in("chain_key", [...chains]).neq("status", "closed"), "osm existing") as Array<{ id: string; chain_key: string; ext_key: string; lat: number; lng: number; verification: Verification; source_kind: string; missing_weeks: number }>;
  const r = matchPoints(existing.map((e) => ({ ...e, chain: e.chain_key })), points);
  const now = new Date().toISOString();
  if (r.matched.length) await must(sb.from("mkt_locations").update({ last_seen_at: now, missing_weeks: 0 }).in("id", r.matched.map((m) => m.existing.id)), "osm seen");
  for (const f of r.unmatched) {
    const key = locKey(f.chain, f.lat, f.lng);
    await candidate(sb, { country, kind: "new_location", source: "osm", payload: { key, row: { chain_key: f.chain, ext_key: key, name: f.name, city: f.city, address: f.address, lat: f.lat, lng: f.lng, status: "open", source: `https://www.openstreetmap.org/${f.osm_id}` } } });
  }
  let flagged = 0;
  for (const e of r.missing.filter((m) => m.source_kind === "osm")) {
    const weeks = e.missing_weeks + 1;
    await must(sb.from("mkt_locations").update({ missing_weeks: weeks }).eq("id", e.id), "osm missing");
    if (shouldFlagClosed({ verification: e.verification, source_kind: e.source_kind, missing_weeks: weeks })) {
      await candidate(sb, { country, kind: "maybe_closed", source: "osm", target_id: e.id, payload: { key: e.ext_key, weeks } });
      flagged++;
    }
  }
  return { points: points.length, matched: r.matched.length, new_candidates: r.unmatched.length, maybe_closed: flagged };
}

async function applyDodo(sb: SupabaseClient, country: string, p: Extract<IngestPayload, { source: "dodo" }>, today: string) {
  await must(sb.from("mkt_chains").upsert({ country, key: "dodo", name: "Dodo Pizza", segment: "pizza", origin: "RU/UAE" }, { onConflict: "country,key", ignoreDuplicates: true }), "dodo chain");
  const withCoords = p.units.filter((u) => u.lat !== null && u.lng !== null);
  if (withCoords.length) {
    await must(sb.from("mkt_locations").upsert(withCoords.map((u) => ({
      country, chain_key: "dodo", ext_key: `dodo:${u.name}`, name: `Dodo ${u.name}`, city: u.city, address: u.address,
      lat: u.lat, lng: u.lng, opened: u.opened, status: u.open ? "open" : "closed", source: "https://publicapi.dodois.io",
      source_kind: "dodo", verification: "internal", verification_note: u.organization, last_seen_at: new Date().toISOString(), missing_weeks: 0,
    })), { onConflict: "country,ext_key" }), "dodo units");
  }
  // Дни храним внутри месяца (orders._days), сумма каналов пересчитывается из них —
  // повторная отправка той же недели не удваивает месяц.
  const months = [...new Set(p.days.map((d) => d.date.slice(0, 7)))];
  for (const month of months) {
    const { data: cur } = await sb.from("mkt_dodo_monthly").select("orders").eq("country", country).eq("month", month).maybeSingle();
    const days: Record<string, Record<string, number>> = { ...((cur?.orders as { _days?: Record<string, Record<string, number>> } | null)?._days ?? {}) };
    for (const d of p.days.filter((x) => x.date.startsWith(month))) days[d.date] = d.counts;
    const [folded] = foldDailyOrders(Object.entries(days).map(([date, counts]) => ({ date, counts })), today);
    await must(sb.from("mkt_dodo_monthly").upsert({ country, month, orders: { ...folded.orders, _days: days }, complete: folded.complete, updated_at: new Date().toISOString() }, { onConflict: "country,month" }), "dodo orders");
  }
  if (p.revenue) {
    await must(sb.from("mkt_dodo_monthly").upsert({ country, month: p.revenue.month, revenue_local: p.revenue.amount, currency: p.revenue.currency, revenue_eur: p.revenue.currency === "EUR" ? p.revenue.amount : null, units: p.revenue.units, updated_at: new Date().toISOString() }, { onConflict: "country,month" }), "dodo revenue");
  }
  return { units: p.units.length, no_coords: p.units.length - withCoords.length, days: p.days.length };
}

async function applyRegistry(sb: SupabaseClient, country: string, years: Array<{ reg_id: string; year: number; revenue_eur: number | null; net_profit_eur: number | null; employees: number | null; source: string }>) {
  const companies = await must(sb.from("mkt_companies").select("id, reg_id").eq("country", country).not("reg_id", "is", null), "reg companies") as Array<{ id: string; reg_id: string }>;
  const byReg = new Map(companies.map((c) => [c.reg_id, c.id]));
  let written = 0, proposed = 0, unknown = 0;
  for (const y of years) {
    const company_id = byReg.get(y.reg_id);
    if (!company_id) { unknown++; continue; }
    const { data: cur } = await sb.from("mkt_financials").select("revenue_eur, net_profit_eur, employees, verification").eq("company_id", company_id).eq("year", y.year).maybeSingle();
    const row = { company_id, year: y.year, revenue_eur: y.revenue_eur, net_profit_eur: y.net_profit_eur, employees: y.employees, source: y.source };
    const same = cur && Number(cur.revenue_eur) === y.revenue_eur && Number(cur.net_profit_eur) === y.net_profit_eur && Number(cur.employees) === y.employees;
    if (same) continue;
    if (cur && TRUSTED.includes(cur.verification as Verification)) {
      await candidate(sb, { country, kind: "financial_update", source: "registry", payload: { key: `${company_id}:${y.year}`, row } });
      proposed++;
    } else {
      await must(sb.from("mkt_financials").upsert({ ...row, verification: "official", updated_at: new Date().toISOString() }, { onConflict: "company_id,year" }), "reg write");
      written++;
    }
  }
  return { years: years.length, written, proposed, unknown_companies: unknown };
}
```

> `upsert(..., { onConflict: "country,kind,(payload->>'key')" })` на частичный индекс с выражением supabase-js не умеет. Если Step 4 падает на этом — замени `candidate()` на: `select id … eq(status,'pending') eq(kind) eq('payload->>key', key)` и `insert` только при пустом ответе. Тест «candidate once» ловит оба варианта.

`types.ts` в той же папке — тип `IngestPayload` из блока Interfaces выше.

```ts
// supabase/functions/market-ingest/index.ts
// Приём данных сборщиков «Анализа рынка» из GitHub Actions. Только POST, только с токеном
// MARKET_INGEST_TOKEN: у токена нет прав ни на что, кроме таблиц mkt_* (ключ service role
// в Actions не кладём).
import { supabase } from "../_shared/supabase.ts";
import { applyIngest } from "./apply.ts";

const TOKEN = Deno.env.get("MARKET_INGEST_TOKEN") ?? "";

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (!b || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = req.headers.get("authorization") ?? "";
  if (!sameSecret(auth.replace(/^Bearer /, ""), TOKEN)) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body?.source || !/^[A-Za-z]{2}$/.test(body?.country ?? "") || !body?.started_at) return new Response("Bad payload", { status: 400 });
  try {
    const stats = await applyIngest(supabase, body, new Date().toISOString().slice(0, 10));
    return Response.json({ ok: true, stats });
  } catch (e) {
    console.error("market-ingest", e);
    return Response.json({ ok: false, error: "apply failed" }, { status: 500 });
  }
});
```

- [ ] **Step 4: PASS.** `deno check supabase/functions/market-ingest/index.ts`. Порча: в `applyOsm` убрать фильтр `source_kind === "osm"` у `missing` → тест «trusted untouched» падает. Вернуть.

- [ ] **Step 5: смоук функции локально**: `supabase functions serve market-ingest --env-file <(echo MARKET_INGEST_TOKEN=t)`; `curl -X POST -H 'Authorization: Bearer wrong' …` → 401; с `t` и `{"source":"osm","country":"QD","started_at":"…","failed":"x"}` → 200 и строка в `mkt_runs`.

- [ ] **Step 6: commit** — `git commit -m "feat(market): ingest function for weekly collectors"`

---

### Task 6: Сборщики и расписание

**Files:**
- Create: `scripts/market/lib.ts`, `scripts/market/brands.ts`, `scripts/market/dodo.ts`, `scripts/market/osm.ts`, `scripts/market/registry-ee.ts`, `scripts/market/registry-ro.ts`, `scripts/market/run.ts`
- Create: `.github/workflows/market-collect.yml`
- Test: `scripts/market/parse.test.ts`

**Interfaces:**
- Consumes: `IngestPayload` (Task 5).
- Produces: конфиги стран `scripts/market/countries/{HR,RO,EE}.ts` (тип `CountryConfig = { country; currency; chains: Array<{ key; name; segment; bakery?; osmBrands: string[]; locator?: string }>; companies: Array<{ chain; name; regId }>; sources: Array<{ adapter: string; feeds: "locations"|"financials"|"dodo"|"prices"|"facts"; chain?: string; cadence: "weekly"|"monthly"|"yearly"; mode: "auto"|"manual"|"blocked"; reason?: string }> }`) — единственное место, где страна описана; адаптеры в `scripts/market/adapters/<id>.ts` по контракту `collect(cfg: CountryConfig, opts) → IngestPayload` (неудача = `{ failed }`, не исключение). `run.ts` перед сбором шлёт в ingest `{source:"config"}` с цепями, юрлицами и источниками → upsert `mkt_chains`, `mkt_companies`, `mkt_sources`; каждая успешная отправка ставит `mkt_sources.last_ok_at`. `brands.ts` не нужен — бренды OSM живут в конфиге.
- Produces: `deno run -A scripts/market/run.ts --country HR,RO,EE --source dodo,osm,registry [--dry-run] [--since YYYY-MM-DD]` (`--since` — дозаливка истории заказов Dodo по дням, по умолчанию последние 8 дней) — в `--dry-run` печатает полезную нагрузку и ничего не шлёт. Env: `MARKET_INGEST_URL`, `MARKET_INGEST_TOKEN`.
- Парсеры — чистые функции: `parseDodoUnits(json): DodoUnit[]`, `parseCountBySource(json): Record<string, number>`, `parseOverpass(json, brands): OsmPoint[]`, `parseEeElements(csvText, regIds): RegistryYear[]`, `parseRoBilant(csvText, cuis, rates): RegistryYear[]`.

Источники (проверены 02.10.2026):
- Dodo: `https://publicapi.dodois.io/{cc}/api/v1/unitinfo/all` (поля `Name`, `State`, `Type`=1 пиццерия, `BeginDateWork`, `OrganizationName`, `AddressDetails.LocalityName`, `AddressText`; координат может не быть — сверь `Location`/`Latitude` в ответе на Step 1 и, если их нет, геокодируй адрес через Nominatim с паузой 1 с и User-Agent); `…/orders/countBySource/{y}/{m}/{d}` за последние 8 дней; `…/FinancialMetrics` (`previous_month`).
- OSM: Overpass `https://overpass-api.de/api/interpreter`, **обязателен** заголовок `User-Agent` (без него 406), запасной `https://overpass.private.coffee/api/interpreter`; таймаут/занятость сервера → полезная нагрузка `failed`.
- EE: `https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/` — точные имена файлов `4.<YEAR>_aruannete_elemendid_kuni_<DDMMYYYY>_0.zip` меняются ежемесячно: брать со страницы `https://avaandmed.ariregister.rik.ee/en/downloading-open-data` первую ссылку по маске; столбцы `report_id;table;label;tag;value` + файл `1.aruannete_yldandmed…` (связь report_id → registrikood, год).
- RO: data.gov.ro CKAN `https://data.gov.ro/api/3/action/package_search?q=situatii+financiare+2025` → ресурс CSV «bilant»; столбцы CUI, cifra de afaceri, profit net / pierdere, numar salariati. RON→EUR — среднегодовой курс ЕЦБ `https://data-api.ecb.europa.eu/service/data/EXR/A.RON.EUR.SP00.A?format=jsondata`.

- [ ] **Step 1: разведка форматов** — скачать по одному реальному ответу каждого источника в `~/Documents/workbench/private/market/samples/` (не в git) и вырезать из них маленькие фикстуры (2–3 записи, выдуманные значения на месте реальных) в `scripts/market/fixtures/`.

- [ ] **Step 2: падающие тесты парсеров** (на фикстурах):

```ts
// scripts/market/parse.test.ts
import { assertEquals } from "@std/assert";
import { parseCountBySource, parseDodoUnits, parseOverpass } from "./lib.ts";

Deno.test("parseCountBySource maps Dodo channels to stable keys", () => {
  assertEquals(parseCountBySource({ OrdersCountByAggregator: 79, OrdersCountByRestaurant: 49, OrdersCountByMobile: 20, OrdersCountBySite: 1, OrdersCountByPhone: 0, OrdersCountByKiosk: 0, TotalCount: 149 }),
    { aggregator: 79, restaurant: 49, mobile: 20, site: 1 });
});

Deno.test("parseDodoUnits keeps pizzerias only", () => {
  const u = parseDodoUnits(JSON.parse(Deno.readTextFileSync(new URL("./fixtures/dodo-units.json", import.meta.url))));
  assertEquals(u.every((x) => x.name !== "Office"), true);
});

Deno.test("parseOverpass maps brand to chain key and uses way centers", () => {
  const pts = parseOverpass({ elements: [
    { type: "node", id: 1, lat: 45.8, lon: 15.9, tags: { brand: "KFC", name: "KFC Arena" } },
    { type: "way", id: 2, center: { lat: 45.7, lon: 15.8 }, tags: { brand: "McDonald's" } },
    { type: "node", id: 3, lat: 45.6, lon: 15.7, tags: { brand: "Unknown Café" } },
  ] }, { KFC: "kfc", "McDonald's": "mcdonalds" });
  assertEquals(pts.map((p) => [p.chain, p.osm_id, p.lat]), [["kfc", "node/1", 45.8], ["mcdonalds", "way/2", 45.7]]);
});
```

Плюс тесты `parseEeElements` и `parseRoBilant` на фикстурах из Step 1 (ожидаемые числа — те, что вписаны в фикстуру).

- [ ] **Step 3: FAIL → реализация `lib.ts`** (HTTP-обёртка с User-Agent `swarm-market/1.0 (+https://github.com/GarroV/Swarm-brain)`, ретрай 1 раз, `postIngest(payload)` с Bearer; парсеры) и сборщиков — каждый экспортирует `collect(cc): Promise<IngestPayload>` и при любой ошибке источника возвращает `{ source, country, started_at, failed: String(e) }`, а не бросает.

```ts
// scripts/market/lib.ts (ключевое)
export const UA = "swarm-market/1.0 (+https://github.com/GarroV/Swarm-brain)";
export async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(170_000) });
    if (r.ok) return await r.json();
    if (attempt >= 1) throw new Error(`${url} → HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 5000));
  }
}
const CHANNEL: Record<string, string> = { OrdersCountByAggregator: "aggregator", OrdersCountByRestaurant: "restaurant", OrdersCountByMobile: "mobile", OrdersCountBySite: "site", OrdersCountByPhone: "phone", OrdersCountByKiosk: "kiosk", OrdersCountByPizzeria: "pizzeria" };
export function parseCountBySource(j: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(CHANNEL).filter(([k]) => j[k]).map(([k, v]) => [v, j[k]]));
}
export function parseOverpass(j: { elements: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> }, brands: Record<string, string>) {
  return j.elements.flatMap((e) => {
    const chain = brands[e.tags?.brand ?? ""];
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!chain || lat === undefined || lng === undefined) return [];
    return [{ chain, name: e.tags?.name ?? e.tags?.brand ?? chain, lat, lng, city: e.tags?.["addr:city"] ?? null, address: [e.tags?.["addr:street"], e.tags?.["addr:housenumber"]].filter(Boolean).join(" ") || null, osm_id: `${e.type}/${e.id}` }];
  });
}
export async function postIngest(payload: unknown) {
  const r = await fetch(Deno.env.get("MARKET_INGEST_URL")!, { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("MARKET_INGEST_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`ingest → HTTP ${r.status}: ${await r.text()}`);
  return await r.json();
}
```

Конфиг (бывший `brands.ts`): `export const BRANDS: Record<string, Record<string, string>> = { HR: { "McDonald's": "mcdonalds", KFC: "kfc", "Burger King": "burgerking", "Domino's": "dominos", "Pizza Hut": "pizzahut", Mlinar: "mlinar" }, RO: { … }, EE: { … } }` — ключи сетей RO/EE берутся из их снимков (Task 7), значения — ключи `mkt_chains`.

`run.ts` — разбирает `--country/--source/--dry-run`, для каждой пары вызывает `collect`, печатает итог строкой `CC source → ok {stats}` / `→ FAILED <ошибка>`; **код выхода 1, если хоть один источник `failed`** (иначе упавший прогон в Actions зеленеет).

- [ ] **Step 4: PASS**, затем живой сухой прогон: `deno run -A scripts/market/run.ts --country HR,RO,EE --source dodo,osm --dry-run | head -50` — Expected: у HR 2 пиццерии Dodo, у EE 5, точки OSM международных сетей.

- [ ] **Step 5: workflow**

```yaml
# .github/workflows/market-collect.yml
# «Анализ рынка»: еженедельный сбор открытых источников (Dodo publicapi, OSM, реестры EE/RO).
# Ночь на понедельник, 01:00 по Белграду — внутри окна раскатки. Пишет только в таблицы mkt_*
# через функцию market-ingest по токену MARKET_INGEST_TOKEN.
name: market-collect
on:
  schedule:
    - cron: "0 23 * * 0"
  workflow_dispatch:
    inputs:
      countries: { description: "Страны через запятую", default: "HR,RO,EE" }
      sources: { description: "Источники", default: "dodo,osm,registry" }
permissions:
  contents: read
jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with: { deno-version: v2.x }
      - name: Collect
        env:
          MARKET_INGEST_URL: ${{ vars.MARKET_INGEST_URL }}
          MARKET_INGEST_TOKEN: ${{ secrets.MARKET_INGEST_TOKEN }}
        run: |
          test -n "$MARKET_INGEST_TOKEN" || { echo "нет секрета MARKET_INGEST_TOKEN" >&2; exit 1; }
          deno run -A scripts/market/run.ts --country "${{ inputs.countries || 'HR,RO,EE' }}" --source "${{ inputs.sources || 'dodo,osm,registry' }}"
```

Реестр EE шлётся только в первую неделю месяца, RO — только если вышел новый год (`run.ts` проверяет `new Date().getUTCDate() <= 7` для EE и наличие ресурса нового года для RO).

- [ ] **Step 6: commit** — `git commit -m "feat(market): weekly collectors for Dodo, OSM and EE/RO registries"`

---

### Task 7: Конфиги RO/EE, локаторы локальных сетей, первичная заливка ручных источников

**Files:**
- Create (вне git): `~/Documents/workbench/private/market/RO.snapshot.json`, `EE.snapshot.json`
- Modify: `scripts/market/brands.ts` (RO/EE)

**Interfaces:**
- Consumes: формат снимка (Task 1), отчёты исследования `RO.md`/`EE.md` (скопировать из scratchpad сессии в `~/Documents/workbench/private/market/research/`).
- Produces: два снимка, проходящие `validateSnapshot`.

Конфиг страны — код (в git, без реальных цифр); ручные данные — снимок вне git. Локаторы локальных сетей: по инструкции коллеги (`~/Documents/workbench/private/market/handoff/`) для HR и разведкой для RO/EE пишется адаптер `locator:<сеть>` там, где список точек открыт; иначе источник `manual` с причиной.

- [ ] **Step 1:** для каждой страны собрать `chains` (Dodo, McDonald's, KFC, Burger King, Domino's, Pizza Hut, Subway и 3–6 крупнейших локальных: RO — Jerry's Pizza, Trenta, Spartan, Salad Box…; EE — Hesburger, Peetri Pizza, Kotipizza…), `locs` (официальные локаторы сетей, с `src` и `v`; Dodo — из publicapi), `fin.companies` (EE — коды из ariregister, RO — CUI; годы 2021–2025 из открытых выгрузок с `v:"official"`), `delivery.facts`, `prices.items` (сайты сетей; Wolt/Glovo — только просмотр, без автоматизации).
- [ ] **Step 2:** `deno eval` с `validateSnapshot` по каждому файлу → `ok`. Сводка «сети/точки/юрлица» — в отчёт владельцу.
- [ ] **Step 3:** импорт в локальную базу (как Task 3 Step 6), сухой прогон сборщиков с `--dry-run` по RO/EE: кандидатов OSM не больше разумного (сотни — значит в `brands.ts` перепутаны ключи).
- [ ] **Step 4: commit** конфигов и адаптеров локаторов — `git commit -m "feat(market): RO and EE country configs and local locators"`.

---

### Task 8: Экран «Анализ рынка»

**Files:**
- Modify: `miniapp/src/lib/royRoute.ts:14`, `miniapp/src/lib/royUrl.ts:14` (+ `royUrl.test.ts`), `miniapp/src/components/roy/RoyRail.tsx:15-37`, `miniapp/src/components/roy/RoyApp.tsx` (`:198`, `:321-327`, `:346-352`, `:418`, `:440`, `:446`, `:693`), `miniapp/src/lib/api.ts` (рядом с `fetchSprints` `:1305`), `miniapp/src/types.ts`
- Create: `miniapp/src/components/market/MarketScreen.tsx`, `MarketMap.tsx`, `ChainDynamics.tsx`, `MoneySection.tsx`, `DodoSection.tsx`, `PricesDelivery.tsx`, `LocationRegistry.tsx`, `Freshness.tsx`, `charts.tsx`
- Create: `miniapp/public/market/shapes/HR.json`, `RO.json`, `EE.json`, `XD.json`
- Test: `miniapp/src/lib/royUrl.test.ts` (новый таб)

**Interfaces:**
- Consumes: `GET /market/countries`, `GET /market/:cc`, `POST /market/:cc/import`, `GET /market/:cc/candidates`, `POST /market/candidates/:id/(accept|reject)` (Task 4); `aliveAtYearEnd`, `unitsByYear` (Task 2).
- Produces: `RoyTab` `"market"`; `fetchMarketCountries(): Promise<string[]>`, `fetchMarket(cc): Promise<MarketBundle>`, `importMarketSnapshot(cc, json): Promise<Record<string, number>>`, `fetchMarketCandidates(cc)`, `decideMarketCandidate(id, accept)`.

Перед кодом — навыки `web-standards` и `dataviz` (палитра → `--chart-1..5`).

- [ ] **Step 1: падающий тест маршрута** — в `royUrl.test.ts` добавить:

```ts
Deno.test("market tab survives the URL round-trip", () => {
  assertEquals(parseRoyUrl("?tab=market").tab, "market");
});
```
(сверь имя функции разбора в `royUrl.ts` и повтори стиль соседних тестов). FAIL → добавить `"market"` в `RoyTab` и `ROY_TABS_ALL` → PASS.

- [ ] **Step 2: регистрация в оболочке** — `RoyRail.tsx` `MAIN`: `{ id: "market", label: ["Анализ рынка", "Market analysis"], icon: "globe" }` (иконку сверь в `roy/icons.tsx`; есть `globe` из `MarketChips`); `RoyApp.tsx`: `"market"` в список `roy_tab` `:198`, `RAIL_TAB.market = "market"`, `SECTION_TITLE.market = shellDt("Анализ рынка", "Market analysis")`, рендер `{tab === "market" && <MarketScreen />}`, на мобайле строка в «Ещё» `{ label: dt("Анализ рынка", "Market analysis"), tab: "market" }` по образцу `sprints` (`:693`), подсветка «Ещё» `:446`.

- [ ] **Step 3: клиент API и типы** — в `types.ts` тип `MarketBundle` = форма `CountryBundle` (Task 3); в `api.ts`:

```ts
export async function fetchMarketCountries() { return apiFetch<string[]>("/market/countries"); }
export async function fetchMarket(cc: string) { return apiFetch<MarketBundle>(`/market/${cc}`); }
export async function importMarketSnapshot(cc: string, snapshot: unknown) {
  return apiFetch<Record<string, number>>(`/market/${cc}/import`, { method: "POST", body: JSON.stringify(snapshot) });
}
export async function fetchMarketCandidates(cc: string) { return apiFetch<MarketCandidate[]>(`/market/${cc}/candidates`); }
export async function decideMarketCandidate(id: string, accept: boolean) {
  return apiFetch<void>(`/market/candidates/${id}/${accept ? "accept" : "reject"}`, { method: "POST" });
}
```
(сверь, как `apiFetch` принимает `method/body` и инвалидирует кэш после POST.)

- [ ] **Step 4: контуры стран** — из Natural Earth 1:10m Admin 0 (public domain) для HR/RO/EE: SVG path в эквидистантной проекции, как в хорватском файле (`proj: {K, L0, LAT0, CS}`, `x=(lng-L0)*CS*K`, `y=(LAT0-lat)*K`). Формат файла: `{ "path": "M…", "proj": {…}, "W": …, "H": … }`. Для HR взять `paths.Croatia`, `proj`, `W`, `H` прямо из хорватского файла. `XD.json` — выдуманный многоугольник 8–12 вершин.

- [ ] **Step 5: `MarketScreen`** — чипы стран (`fetchMarketCountries`, флаг через `countryFlag` из `lib/countries.ts`, у `XD` — 🏳️ и имя `Demoland`), загрузка `fetchMarket(cc)`, состояния «загрузка / ошибка с повтором / нет данных», затем секции в порядке спеки. Пустая секция не рендерится, вместо неё строка `dt("Нет данных: источник закрыт — …", "No data: source unavailable — …")`. Последняя выбранная страна — в `localStorage` под try/catch.

- [ ] **Step 6: секции** (каждая — свой файл, SVG без библиотек, цвета `var(--chart-N)` по `chain.slot % 5 + 1`, числа шрифтом `--font-geist-mono`):
  - `MarketMap` — контур + точки (кружок r=3, полый у `opened_estimated`), переключатель «Точки / Плотность» (плотность — сетка 20×20 с заливкой по числу точек), фильтр сетей чипами, ползунок года → `aliveAtYearEnd`-фильтр, тултип по наведению (сеть, адрес, дата, статус проверки).
  - `ChainDynamics` — линии `unitsByYear` за 2021…текущий год + таймлайн открытий/закрытий по году.
  - `MoneySection` — таблица юрлиц × годы (выручка, прибыль, сотрудники; пометка статуса проверки; источник ссылкой); выручка на точку для пицца-сетей = выручка года / `aliveAtYearEnd` сети.
  - `DodoSection` — столбцы выручки по месяцам (EUR), стек заказов по каналам; неполный месяц — штриховкой.
  - `PricesDelivery` — средняя пицца ~30 см по сетям (медиана `price_eur` при `size_cm` 28–32) и факты `delivery`/`timeline`.
  - `LocationRegistry` — таблица с поиском по названию/городу и фильтром статуса, виртуализация не нужна (до ~1000 строк).
  - `Freshness` — последний запуск каждого источника и «N дней назад»; красным, если `failed` или старше 8 дней. Для админа — счётчик кандидатов, список с «Принять / Отклонить», и кнопка «Загрузить снимок» (input file → `importMarketSnapshot`, ответ 400 показывает `details` списком).

- [ ] **Step 7: проверка запуском** — `npm run build` в `miniapp/`; локальный контур с импортированными HR/RO/EE (Task 3, 7); пройти экран в светлой и тёмной теме, на ширине 390 px и десктопе; сверить с хорватским файлом: 611 точек (минус дубли Task 3), 23 сети, выручки McDonald's 2020–2025 те же. Снять service worker перед проверкой (память: SW отдаёт старый бандл).

- [ ] **Step 8: commit** — `git commit -m "feat(market): Market analysis screen"`

---

### Task 9: Демо Demoland

**Files:**
- Modify: `scripts/seed-demo.sql`

**Interfaces:**
- Consumes: таблицы Task 3; `canSeeCountry` (демо видит только `XD`).

- [ ] **Step 1:** в конец `scripts/seed-demo.sql` (после вызова `public.demo_reset()`) — блок, который сначала чистит `XD` (`delete from public.mkt_financials where company_id in (select id from public.mkt_companies where country = 'XD'); delete from public.mkt_candidates where country = 'XD'; …; delete from public.mkt_chains where country = 'XD';`), затем вставляет выдуманное: 6 сетей (`Pizza Nova`, `Burger Peak`, `Crispy Hen`, `Bake & Go`, `Slice Lab`, `Dodo Pizza`), ~60 точек внутри контура `XD.json`, 4 юрлица × 2021–2025, 12 месяцев Dodo с заказами по каналам, 10 цен, 5 фактов доставки, 3 записи `mkt_runs` (одна `failed` — чтобы витрина показывала, как выглядит упавший источник). Все названия, адреса и цифры выдуманы, по-английски. Каждый `delete` — с `where`.
- [ ] **Step 2:** прогон сида на локальной базе дважды подряд → без ошибок, число строк `XD` одинаковое. Вход демо-сессией → в разделе только Demoland, по-английски.
- [ ] **Step 3: commit** — `git commit -m "feat(market): fictional Demoland in demo seed"`

---

### Task 10: Документация

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/QUICK_REF.md`, реестр пользовательских материалов (найти по `grep -rl "реестр материалов\|Материалы" docs/`)

- [ ] **Step 1:** `ARCHITECTURE.md` — раздел «Анализ рынка»: что это, поверхности (экран, `swarm-api /market/*`, `market-ingest`, `market-collect.yml`), сквозной сценарий (сборщик → ingest → кандидаты → админ), таблицы `mkt_*` с колонками (сверять с миграцией), секрет `MARKET_INGEST_TOKEN`, переменная `vars.MARKET_INGEST_URL`, правила сборщиков, демо `XD`.
- [ ] **Step 2:** `QUICK_REF.md` — строка 🧭 навигации, эндпоинты, env/секрет, workflow, где лежат снимки (`~/Documents/workbench/private/market/`, вне git).
- [ ] **Step 3:** `./scripts/check` и `make porcha` — зелёные; commit — `git commit -m "docs(market): architecture and quick ref"`

---

### Task 11: Стенд на MUSPELHEIM для владельца

**Files:** нет (инфраструктура; код стенда — по скиллу `muspelheim`).

- [ ] **Step 1:** вызвать скилл `muspelheim`, сверить фактом: доступ `ssh muspelheim`, свободные порты, чужие проекты рядом не трогать.
- [ ] **Step 2:** на сервере — клон ветки `GarroV/Аналитика-по-конкурентам`, `supabase start` (свой набор портов), `supabase db reset`, функции `swarm-api` и `market-ingest` через `supabase functions serve` с локальными секретами, `miniapp` в режиме, который ходит в этот локальный API (как локальная разработка — сверить с `docs/` по локальному запуску), импорт снимков HR/RO/EE (`scp` из `~/Documents/workbench/private/market/` в каталог вне репозитория на сервере), один прогон сборщиков по стенду.
- [ ] **Step 3:** открыть ссылку стенда в tailnet (не в публичный funnel — на стенде реальные данные Fina), пройти раздел самому: все три страны, обе темы, мобайл.
- [ ] **Step 4:** отдать владельцу ссылку и короткий список «что потрогать»: переключение стран, карта и ползунок года, финансы, очередь кандидатов, загрузка снимка. Раскатку на прод не начинать без его «да» и окна.
