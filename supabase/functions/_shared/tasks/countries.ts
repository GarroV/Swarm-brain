// Страны задачи: список ISO-кодов, а не одно имя (issue #1262, решение владельца 10.11.2026:
// «в задачах давай сделаем возможность выбора нескольких стран. также с кодами, а не с полным
// названием страны»).
//
// Единственная точка приведения ввода к кодам: createTask/updateTask (`db.ts`) зовут её на
// КАЖДОЙ записи, поэтому веб, бот, MCP и доска сохраняют одно и то же, а не каждый своё.
// Имена «Словения»/«Belarus» из старых клиентов превращаются в коды словарём `../countries.ts`
// (тем же, что у встреч и поиска) — второго словаря в проекте нет.
//
// Неизвестное значение — ошибка с текстом для человека, а не молчаливый пропуск: потерянная
// страна неотличима от «страну не указали».
import { normalizeCountry } from "../countries.ts";

/** Все ISO 3166-1 alpha-2: коды вне словаря рынков (PT, NL…) тоже допустимы. */
const ISO2 = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/** Сколько стран можно повесить на одну задачу: защита от мусорного ввода, а не бизнес-правило. */
export const MAX_TASK_COUNTRIES = 30;

export type CountriesResult = { ok: true; countries: string[] } | { ok: false; error: string };

/** Один токен («HU», «hu», «Словения», «Belarus») → ISO-код или null. */
export function toIsoCode(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (/^[A-Z]{2}$/.test(up) && ISO2.has(up)) return up;
  return normalizeCountry(t);
}

/**
 * Ввод → список кодов без повторов, порядок сохраняется (первый — «основная» страна, она же
 * зеркалится в `tasks.country`). Принимает массив, строку (в т.ч. «HU, RS» — так хранили до
 * #1262) и null/пусто (= без страны).
 */
export function parseTaskCountries(input: unknown): CountriesResult {
  if (input === null || input === undefined || input === "") return { ok: true, countries: [] };
  let tokens: string[];
  if (Array.isArray(input)) {
    if (input.some((x) => typeof x !== "string")) {
      return { ok: false, error: 'Страны задачи — список строк (ISO-коды, например ["HU","RS"])' };
    }
    tokens = input as string[];
  } else if (typeof input === "string") {
    // Целиком как имя («United Arab Emirates» содержит пробелы), иначе — по разделителям.
    tokens = toIsoCode(input) ? [input] : input.split(/[,;/]/);
  } else {
    return { ok: false, error: "Страна задачи — ISO-код или список кодов" };
  }
  const out: string[] = [];
  for (const raw of tokens) {
    if (!raw.trim()) continue;
    const code = toIsoCode(raw);
    if (!code) return { ok: false, error: `Неизвестная страна «${raw.trim()}»: нужен двухбуквенный ISO-код (HU, RS…)` };
    if (!out.includes(code)) out.push(code);
  }
  if (out.length > MAX_TASK_COUNTRIES) {
    return { ok: false, error: `Не больше ${MAX_TASK_COUNTRIES} стран у одной задачи` };
  }
  return { ok: true, countries: out };
}

/** Зеркало в старую колонку `tasks.country`: первая страна списка (шаг 1 двухшагового снятия). */
export function mirrorCountry(countries: readonly string[]): string | null {
  return countries[0] ?? null;
}

/**
 * Фильтр по странам из запроса: «HU», «HU,RS», «Сербия» → коды; пусто → без фильтра.
 * Неизвестное значение — ошибка (пустая выдача по опечатке выглядела бы как «задач нет»).
 */
export function parseCountryFilter(raw: string | null | undefined): CountriesResult {
  return parseTaskCountries(raw ? raw.trim() : null);
}

/** Страны задачи для показа человеку: коды через « · »; у строки без `countries` — старое `country`. */
export function taskCountriesText(
  t: { countries?: readonly string[] | null; country?: string | null },
  sep = " · ",
): string {
  return t.countries?.length ? t.countries.join(sep) : (t.country ?? "");
}

/**
 * Поля стран из тела запроса (POST/PATCH /tasks): только присланные ключи. Значения не
 * проверяются — их приводит и отбивает createTask/updateTask (`db.ts`), единая точка записи.
 */
export function countriesFields(body: Record<string, unknown>): { country?: string | null; countries?: string[] } {
  const out: { country?: string | null; countries?: string[] } = {};
  if (body.country !== undefined) out.country = body.country as string | null;
  if (body.countries !== undefined) out.countries = body.countries as string[];
  return out;
}
