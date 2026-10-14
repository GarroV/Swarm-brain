// Состояние второго шага входа веб-сессии (палец, #955) и замок обязательности.
// Замок включается переменной SECOND_STEP_REQUIRED=1 в swarm-api и по умолчанию ВЫКЛЮЧЕН: в первой
// части шаг только предлагается и отмечается в сессии (метка `sf` в JWT), работу он не блокирует.
// Когда владелец скажет включать — одна переменная, код не меняется.
// Пилот: аудиторию шага задаёт SECOND_STEP_AUDIENCE (пусто — никому, `all` — всем, список telegram id).
// Замок действует только на тех, к кому шаг применим.
import { isRenewableSession, type SessionClaims } from "../jwt.ts";

export type SecondStepState = {
  /** Шаг вообще применим: настоящий вход в веб (Google/Telegram), не демо, не Mini App, не короткий токен. */
  applies: boolean;
  /** Пройден ли в этой сессии. */
  done: boolean;
  /** Включён ли замок обязательности. */
  required: boolean;
  /** Момент входа (секунды): браузер помнит по нему, что за этот вход уже пробовали. null — нет. */
  session: number | null;
};

export function isSecondStepRequired(env: string | undefined): boolean {
  return env === "1" || env === "true";
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
  opts: { isDemo: boolean; required: boolean; audience: SecondStepAudience },
): SecondStepState {
  const applies = claims !== null && !opts.isDemo && isRenewableSession(claims) &&
    inAudience(opts.audience, claims.telegram_id);
  return {
    applies,
    done: applies && claims!.secondStep,
    required: opts.required,
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
