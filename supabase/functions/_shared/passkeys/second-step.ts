// Состояние второго шага входа веб-сессии (палец, #955) и замок обязательности.
// Замок задаёт переменная SECOND_STEP_REQUIRED в swarm-api; настройки читаются «замок включён, пока явно
// не сказано обратное»: выключает его только `0`/`false`/`off`. Значение: дата ISO `2026-10-26` — с 00:00
// по Белграду этой даты (решение владельца 19.10.2026, docs/decisions/2026-10-19-search-and-2fa-deadline.md §2);
// `1`/`true`, не задано, пусто или непонятное — замок действует сразу. Код не меняется.
// Аудиторию шага задаёт SECOND_STEP_AUDIENCE: список telegram id — только они, `none` — никто,
// не задано, пусто, `all` или непонятное — все. Замок действует только на тех, к кому шаг применим.
import { isRenewableSession, type SessionClaims } from "../jwt.ts";

export type SecondStepState = {
  /** Шаг вообще применим: веб-сессия, не демо, не Mini App. С 26.10.2026 — и короткая сессия из обмена токена. */
  applies: boolean;
  /** Пройден ли в этой сессии. */
  done: boolean;
  /** Сессия из обмена личного токена (meeting-webtoken, без продления): пройти шаг она не может,
   *  при включённом замке ей открыто только окно заметок рекордера (решение 26.10.2026). */
  exchanged: boolean;
  /** Действует ли замок обязательности сейчас (вычислено на момент запроса). */
  required: boolean;
  /** Дата ISO, с которой замок начнёт действовать (если в SECOND_STEP_REQUIRED задана дата), иначе null. */
  required_from: string | null;
  /** Момент входа (секунды): браузер помнит по нему, что за этот вход уже пробовали. null — нет. */
  session: number | null;
};

/** Часовой пояс команды: «с понедельника» значит с полуночи по Белграду. */
const LOCK_TIME_ZONE = "Europe/Belgrade";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Смещение пояса от UTC в миллисекундах на момент `atMs`. */
function zoneOffsetMs(atMs: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: LOCK_TIME_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(atMs)).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

/** Дата ISO из значения env (с обрезкой пробелов) или null: формат не тот или такой даты в календаре нет. */
export function secondStepRequiredFrom(env: string | undefined): string | null {
  const raw = (env ?? "").trim();
  const m = ISO_DATE.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const check = new Date(Date.UTC(y, mo - 1, d));
  const valid = check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
  return valid ? raw : null;
}

/** Начало суток `date` (ISO) по Белграду, миллисекунды UTC. Переход на летнее время идёт ночью, в полночь его нет. */
function belgradeMidnightMs(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const utcMidnight = Date.UTC(y, mo - 1, d);
  return utcMidnight - zoneOffsetMs(utcMidnight - zoneOffsetMs(utcMidnight));
}

const REQUIRED_OFF = new Set(["0", "false", "off"]);

/** Значение SECOND_STEP_REQUIRED, которое не включает ничего особенного: не пусто, не 1/true, не выключатель, не дата. */
function requiredUnrecognised(env: string | undefined): boolean {
  const raw = (env ?? "").trim().toLowerCase();
  return raw !== "" && raw !== "1" && raw !== "true" && !REQUIRED_OFF.has(raw) && secondStepRequiredFrom(raw) === null;
}

/** Действует ли замок на момент `now`: `0`/`false`/`off` — нет; дата — с её полуночи по Белграду;
 *  всё остальное (`1`/`true`, не задано, пусто, непонятное) — да. */
export function isSecondStepRequired(env: string | undefined, now: Date = new Date()): boolean {
  const raw = (env ?? "").trim().toLowerCase();
  if (REQUIRED_OFF.has(raw)) return false;
  const from = secondStepRequiredFrom(raw);
  return from === null || now.getTime() >= belgradeMidnightMs(from);
}

/** Кому применим шаг: никому, всем (по умолчанию) или списку telegram id. */
export type SecondStepAudience = "none" | "all" | ReadonlySet<number>;

/** Список id через запятую (пустые звенья терпим) или null, если есть хоть одно звено не из цифр или список пуст. */
function parseAudienceIds(raw: string): Set<number> | null {
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0 || !parts.every((part) => /^\d+$/.test(part))) return null;
  return new Set(parts.map(Number));
}

function audienceUnrecognised(env: string | undefined): boolean {
  const raw = (env ?? "").trim().toLowerCase();
  return raw !== "" && raw !== "all" && raw !== "none" && parseAudienceIds(raw) === null;
}

/** Разбор SECOND_STEP_AUDIENCE: список id через запятую → только им; `none` → никому; не задано, пусто, `all`
 *  и всё непонятное (в том числе список с не-числом) → всем. */
export function parseSecondStepAudience(env: string | undefined): SecondStepAudience {
  const raw = (env ?? "").trim().toLowerCase();
  if (raw === "none") return "none";
  return parseAudienceIds(raw) ?? "all";
}

/** Строки-предупреждения для журнала при запуске: имя переменной и факт, что значение не распознано. Самих значений в них нет. */
export function secondStepConfigWarnings(requiredEnv: string | undefined, audienceEnv: string | undefined): string[] {
  const warnings: string[] = [];
  if (requiredUnrecognised(requiredEnv)) warnings.push("SECOND_STEP_REQUIRED unrecognised, lock on");
  if (audienceUnrecognised(audienceEnv)) warnings.push("SECOND_STEP_AUDIENCE unrecognised, lock on");
  return warnings;
}

function inAudience(audience: SecondStepAudience, telegramId: number): boolean {
  if (audience === "all") return true;
  if (audience === "none") return false;
  return audience.has(telegramId);
}

export function secondStepState(
  claims: SessionClaims | null,
  opts: { isDemo: boolean; required: boolean; requiredFrom?: string | null; audience: SecondStepAudience },
): SecondStepState {
  const applies = claims !== null && !opts.isDemo && inAudience(opts.audience, claims.telegram_id);
  return {
    applies,
    done: applies && claims!.secondStep,
    exchanged: claims !== null && !isRenewableSession(claims),
    required: opts.required,
    required_from: opts.requiredFrom ?? null,
    session: claims?.authTime ?? null,
  };
}

/** Пути, открытые сессии без второго шага при включённом замке: нужно узнать состояние и выйти. */
const OPEN_PATHS = new Set(["/me", "/auth/revoke-sessions", "/maintenance"]);

/** Окно заметок рекордера (/live в WKWebView): встреча и её пометки — всё, что нужно сессии из обмена токена. */
const RECORDER_NOTES_PATH = /^\/agent-meetings\/[^/]+(\/notes)?$/;

function recorderNotesAllowed(method: string, routePath: string): boolean {
  const m = RECORDER_NOTES_PATH.exec(routePath);
  if (!m) return false;
  return method === "GET" || (method === "POST" && m[1] === "/notes");
}

/** Доска шмеля (решение владельца 28.10.2026): «Сегодня», экран страны созвона, свои задачи и рынки
 *  пространства. Touch ID рекордер пройти не может — его доказательство токен, выданный в вебе после шага. */
const RECORDER_BOARD: ReadonlyArray<[method: string, path: RegExp]> = [
  ["GET", /^\/board\/today$/],
  ["GET", /^\/board\/call$/],
  ["PUT", /^\/board\/call$/],
  ["POST", /^\/tasks$/],
  ["POST", /^\/tasks\/voice$/],
  ["PATCH", /^\/tasks\/[^/]+$/],
  ["DELETE", /^\/tasks\/[^/]+$/],
  ["GET", /^\/config$/],
];

function recorderBoardAllowed(method: string, routePath: string): boolean {
  return RECORDER_BOARD.some(([m, path]) => m === method && path.test(routePath));
}

/** Замок: включён, шаг применим и не пройден — всё, кроме открытых путей, закрыто. Сессии из обмена
 *  токена сверх того открыты окно заметок рекордера и доска шмеля. */
export function secondStepBlocks(state: SecondStepState, method: string, routePath: string): boolean {
  if (!state.required || !state.applies || state.done) return false;
  if (OPEN_PATHS.has(routePath) && (method === "GET" || routePath === "/auth/revoke-sessions")) return false;
  if (state.exchanged && (recorderNotesAllowed(method, routePath) || recorderBoardAllowed(method, routePath))) {
    return false;
  }
  return true;
}
