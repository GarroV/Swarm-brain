// Состояние второго шага входа веб-сессии (палец, #955) и замок обязательности.
// Замок включается переменной SECOND_STEP_REQUIRED в swarm-api и по умолчанию ВЫКЛЮЧЕН: шаг только
// предлагается и отмечается в сессии (метка `sf` в JWT), работу он не блокирует. Значение: `1`/`true` —
// замок действует сразу; дата ISO `2026-10-26` — с 00:00 по Белграду этой даты (решение владельца 19.10.2026,
// docs/decisions/2026-10-19-search-and-2fa-deadline.md §2); пусто или иное — выключен. Код не меняется.
// Пилот: аудиторию шага задаёт SECOND_STEP_AUDIENCE (пусто — никому, `all` — всем, список telegram id).
// Замок действует только на тех, к кому шаг применим.
import { isRenewableSession, type SessionClaims } from "../jwt.ts";

export type SecondStepState = {
  /** Шаг вообще применим: настоящий вход в веб (Google/Telegram), не демо, не Mini App, не короткий токен. */
  applies: boolean;
  /** Пройден ли в этой сессии. */
  done: boolean;
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

/** Действует ли замок на момент `now`: `1`/`true` — да; дата — с её полуночи по Белграду; иначе нет. */
export function isSecondStepRequired(env: string | undefined, now: Date = new Date()): boolean {
  const raw = (env ?? "").trim();
  if (raw === "1" || raw === "true") return true;
  const from = secondStepRequiredFrom(raw);
  return from !== null && now.getTime() >= belgradeMidnightMs(from);
}

/** Кому применим шаг: никому (по умолчанию), всем или списку telegram id. */
export type SecondStepAudience = "none" | "all" | ReadonlySet<number>;

/** Разбор SECOND_STEP_AUDIENCE: пусто → никому; `all` → всем; список id через запятую → только им. Не-числа отбрасываются. */
export function parseSecondStepAudience(env: string | undefined): SecondStepAudience {
  const raw = (env ?? "").trim().toLowerCase();
  if (raw === "all") return "all";
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
  return ids.length > 0 ? new Set(ids) : "none";
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
  const applies = claims !== null && !opts.isDemo && isRenewableSession(claims) &&
    inAudience(opts.audience, claims.telegram_id);
  return {
    applies,
    done: applies && claims!.secondStep,
    required: opts.required,
    required_from: opts.requiredFrom ?? null,
    session: claims?.authTime ?? null,
  };
}

/** Пути, открытые сессии без второго шага при включённом замке: нужно узнать состояние и выйти. */
const OPEN_PATHS = new Set(["/me", "/auth/revoke-sessions", "/maintenance"]);

/** Замок: включён, шаг применим и не пройден — всё, кроме открытых путей, закрыто. */
export function secondStepBlocks(state: SecondStepState, method: string, routePath: string): boolean {
  if (!state.required || !state.applies || state.done) return false;
  if (OPEN_PATHS.has(routePath) && (method === "GET" || routePath === "/auth/revoke-sessions")) return false;
  return true;
}
