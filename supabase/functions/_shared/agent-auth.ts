// import-map, но edge-функции Swarm деплоятся с URL-импортами (так во ВСЕХ функциях без
// исключения) и проверить деплой с голым спецификатором из ветки нельзя. Перевод импортов ради
// линта = непроверяемый риск для живого конвейера. Дефект гейта вынесен диспетчеру.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Аутентификация агентов по токену. Два вида предъявителя, и разница между ними существенна:
//
//   • ЧЕЛОВЕК — desktop-рекордер или Claude Desktop. Токен → sha256-hex →
//     allowed_users.{recorder,claude_mcp}_token_hash → telegram_id. Личность и воркспейс берутся
//     ИЗ ТОКЕНА, не из payload — это закрывает спуфинг owner_telegram_id.
//     Дверь для них — verifyAgentToken, и она НЕ умеет действовать за другого.
//
//   • СЛУЖЕБНЫЙ АГЕНТ (бот) — приходит со своим токеном из таблицы service_agents и сам по себе
//     не имеет прав вообще. Он обязан назвать человека, за которого действует (заголовок
//     X-On-Behalf-Of), и человек обязан быть в воркспейсе агента. Дверь для них —
//     resolveActingIdentity.
//
// Подмена личности делается ОДИН раз, здесь, на входе. Не протаскивается параметром через места
// вызова: среди них есть запись claim_owner и owner_id, и протаскивание означало бы, что
// приватность встречи зависит от того, не забыл ли кто-то параметр в десятом месте.

/** Заголовок подмены: за кого действует служебный агент. Значение — telegram_id человека. */
export const ON_BEHALF_OF_HEADER = "X-On-Behalf-Of";

export class AgentAuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
    this.name = "AgentAuthError";
  }
}

export type TokenKind = "recorder" | "recorder_prev" | "mcp" | "bot";

export interface AgentIdentity {
  /** ВСЕГДА человек. Для токена агента — тот, за кого он действует, а не сам агент. */
  telegramId: number;
  groupId: string | null;
  kind: TokenKind;
  /** Заполнен только при kind: "bot" — какой именно агент пришёл (для его heartbeat и логов). */
  agentId?: string;
}

// ── Классификация токена ─────────────────────────────────────────────────────

/** Строка человека: три токена в allowed_users. */
export interface TokenRow {
  claude_mcp_token_hash: string | null;
  claude_mcp_token_expires_at: string | null;
  recorder_token_hash: string | null;
  recorder_token_expires_at: string | null;
  recorder_token_prev_hash: string | null;
  recorder_token_prev_expires_at: string | null;
}

/** Строка служебного агента: один токен в service_agents. */
export interface AgentRow {
  token_hash: string | null;
  token_expires_at: string | null;
}

export type ClassifiedKind = TokenKind | "none";

// Какой именно токен предъявили и не истёк ли он. Вынесено чистой функцией: ветки «предыдущий
// токен ещё в перекрытии» и «перекрытие истекло» иначе не проверить без живой базы.
export function classifyToken(
  hashHex: string,
  row: TokenRow | AgentRow,
  now: number = Date.now(),
): { kind: ClassifiedKind; expired: boolean } {
  if ("token_hash" in row) {
    if (row.token_hash !== hashHex) return { kind: "none", expired: false };
    return { kind: "bot", expired: isExpired(row.token_expires_at, now) };
  }
  const kind: ClassifiedKind = row.recorder_token_hash === hashHex
    ? "recorder"
    : row.recorder_token_prev_hash === hashHex
    ? "recorder_prev"
    : row.claude_mcp_token_hash === hashHex
    ? "mcp"
    : "none";
  if (kind === "none") return { kind, expired: false };
  const expiresAt = kind === "recorder"
    ? row.recorder_token_expires_at
    : kind === "recorder_prev"
    ? row.recorder_token_prev_expires_at
    : row.claude_mcp_token_expires_at;
  return { kind, expired: isExpired(expiresAt, now) };
}

function isExpired(expiresAt: string | null, now: number): boolean {
  return !!expiresAt && Date.parse(expiresAt) < now;
}

/** sha256-hex. В базе лежит только он: сам токен живёт у предъявителя и нигде больше. */
export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Вход ─────────────────────────────────────────────────────────────────────

const USER_COLUMNS =
  "telegram_id, group_id, claude_mcp_token_hash, claude_mcp_token_expires_at, recorder_token_hash, recorder_token_expires_at, recorder_token_prev_hash, recorder_token_prev_expires_at";
const AGENT_COLUMNS = "id, name, group_id, token_hash, token_expires_at, is_active";

async function bearerHash(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new AgentAuthError(401, "Missing bearer token");
  }
  return await sha256Hex(authHeader.slice(7).trim());
}

/**
 * За кого просят действовать. Источников два — аргумент вызова и заголовок; если оба названы и
 * расходятся, это отказ, а не выбор одного из двух: тихое предпочтение одного источника — ровно
 * тот случай, когда встречу записывают не тому человеку и никто не узнаёт.
 */
function readOnBehalfOf(req: Request, explicit?: number): number | null {
  const fromHeader = parseTelegramId(req.headers.get(ON_BEHALF_OF_HEADER));
  if (explicit === undefined) return fromHeader;
  const fromArg = parseTelegramId(String(explicit));
  if (fromHeader !== null && fromHeader !== fromArg) {
    throw new AgentAuthError(
      403,
      `${ON_BEHALF_OF_HEADER} conflicts with the request body`,
    );
  }
  return fromArg;
}

function parseTelegramId(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AgentAuthError(
      403,
      `${ON_BEHALF_OF_HEADER} must be a telegram id`,
    );
  }
  return parsed;
}

async function findHuman(
  supabase: SupabaseClient,
  hashHex: string,
): Promise<AgentIdentity | null> {
  // Принимаем ЛЮБОЙ из трёх: отдельный токен рекордера (/recordertoken), его ПРЕДЫДУЩИЙ на время
  // перевыпуска (перекрытие, см. _shared/recorder-token.ts) ИЛИ общий MCP-токен (/mytoken).
  // Перекрытие нужно, чтобы перевыпуск не убивал рабочую установку в тот же миг: рекордер писал
  // встречи и молча не мог их залить, если человек не дошёл до конца установки (issue #146).
  const { data } = await supabase
    .from("allowed_users")
    .select(USER_COLUMNS)
    .or(
      `claude_mcp_token_hash.eq.${hashHex},recorder_token_hash.eq.${hashHex},recorder_token_prev_hash.eq.${hashHex}`,
    )
    .maybeSingle();
  if (!data) return null;

  const row = data as TokenRow & {
    telegram_id: number;
    group_id: string | null;
  };
  const { kind, expired } = classifyToken(hashHex, row);
  if (kind === "none") return null;
  if (expired) {
    throw new AgentAuthError(
      401,
      "Token expired — get a fresh one in the bot (/recordertoken)",
    );
  }

  // Новый токен заработал → перекрытие больше не нужно, гасим его немедленно. Так окно живёт
  // минуты (пока человек несёт токен до рекордера), а не заявленные сутки: чем короче окно, тем
  // меньше оно мешает заметить украденный токен.
  if (kind === "recorder" && row.recorder_token_prev_hash) {
    await supabase
      .from("allowed_users")
      .update({
        recorder_token_prev_hash: null,
        recorder_token_prev_expires_at: null,
      })
      .eq("telegram_id", row.telegram_id);
  }

  return { telegramId: row.telegram_id, groupId: row.group_id, kind };
}

async function findAgent(
  supabase: SupabaseClient,
  hashHex: string,
): Promise<{ id: string; groupId: string | null }> {
  const { data } = await supabase
    .from("service_agents")
    .select(AGENT_COLUMNS)
    .eq("token_hash", hashHex)
    .maybeSingle();
  if (!data) throw new AgentAuthError(401, "Unauthorized");

  const row = data as AgentRow & {
    id: string;
    group_id: string | null;
    is_active: boolean;
  };
  const { kind, expired } = classifyToken(hashHex, row);
  if (kind !== "bot") throw new AgentAuthError(401, "Unauthorized");
  // Наружу — одинаковое «Unauthorized» (чужому знать нечего), в логи — причина: иначе разбор
  // «почему бот молчит» упирается в неотличимые 401.
  if (expired) {
    console.warn(`agent-auth: токен служебного агента ${row.id} истёк`);
    throw new AgentAuthError(401, "Unauthorized");
  }
  if (!row.is_active) {
    console.warn(
      `agent-auth: служебный агент ${row.id} выключен (is_active=false)`,
    );
    throw new AgentAuthError(401, "Unauthorized");
  }
  return { id: row.id, groupId: row.group_id };
}

/**
 * Дверь для ЛЮДЕЙ: личность строго та, чей токен предъявлен.
 *
 * ⚠️ Не переводить на resolveActingIdentity «за компанию». По этой двери ходит meeting-webtoken,
 * который печатает JWT браузерной сессии на семь дней: агент, прошедший здесь, перестал бы быть
 * записывающим за человека и стал бы этим человеком в вебе.
 */
export async function verifyAgentToken(
  supabase: SupabaseClient,
  req: Request,
): Promise<AgentIdentity> {
  const hashHex = await bearerHash(req);
  if (req.headers.get(ON_BEHALF_OF_HEADER) !== null) {
    throw new AgentAuthError(
      403,
      `${ON_BEHALF_OF_HEADER} is not accepted by this endpoint`,
    );
  }
  const human = await findHuman(supabase, hashHex);
  if (!human) throw new AgentAuthError(401, "Unauthorized");
  return human;
}

/**
 * Дверь для служебных агентов — и для людей тоже, без изменения их поведения.
 *
 * На выходе `telegramId` — ВСЕГДА человек. Поэтому `claim_owner`, `owner_id` и всё, что пишется
 * по личности дальше, остаётся человеческим, и вызывающий код не знает, что пришёл бот.
 *
 * @param onBehalfOf за кого действовать, если это пришло не заголовком, а телом запроса.
 */
export async function resolveActingIdentity(
  supabase: SupabaseClient,
  req: Request,
  onBehalfOf?: number,
): Promise<AgentIdentity> {
  const hashHex = await bearerHash(req);
  const behalf = readOnBehalfOf(req, onBehalfOf);

  const human = await findHuman(supabase, hashHex);
  if (human) {
    // Личный токен действует только за своего владельца — включая случай «за самого себя»:
    // второй путь к той же личности сделал бы «я» и «за меня» неразличимыми в логах и в данных.
    if (behalf !== null) {
      throw new AgentAuthError(
        403,
        `${ON_BEHALF_OF_HEADER} is only for service agents`,
      );
    }
    return human;
  }

  const agent = await findAgent(supabase, hashHex);
  if (behalf === null) {
    throw new AgentAuthError(
      403,
      `service agent token grants nothing on its own — send ${ON_BEHALF_OF_HEADER}`,
    );
  }
  if (!agent.groupId) {
    console.warn(`agent-auth: у служебного агента ${agent.id} нет воркспейса`);
    throw new AgentAuthError(403, "service agent has no workspace");
  }

  const { data } = await supabase
    .from("allowed_users")
    .select("telegram_id, group_id")
    .eq("telegram_id", behalf)
    .maybeSingle();
  const person = data as
    | { telegram_id: number; group_id: string | null }
    | null;
  // Воркспейс сверяем строго: агент обслуживает один воркспейс и не может назвать владельцем
  // человека из чужого. Человек без воркспейса тоже не подходит — встреча стала бы ничьей.
  //
  // Отказ ОДИН на все причины, как и в findAgent выше. Разные тексты («unknown user» против
  // «outside the workspace») превращали заголовок в оракул существования: держатель токена
  // агента подставлял произвольные telegram_id и по тексту 403 узнавал, заведён ли человек
  // в Swarm вообще — в любом чужом воркспейсе, не имея прав ни на один. Telegram id не секрет
  // и резолвится из username, так что это давало скомпрометированному токену список
  // пользователей всей системы. Причина отказа остаётся в логе: она нужна нам, не чужому.
  if (!person || person.group_id === null || person.group_id !== agent.groupId) {
    const reason = !person
      ? "человек не заведён"
      : person.group_id === null
      ? "человек без воркспейса"
      : `чужой воркспейс ${person.group_id}`;
    console.warn(
      `agent-auth: агент ${agent.id} (${agent.groupId}) просил действовать за ${behalf}: ${reason}`,
    );
    throw new AgentAuthError(
      403,
      `${ON_BEHALF_OF_HEADER}: not a user of this agent's workspace`,
    );
  }

  return {
    telegramId: person.telegram_id,
    groupId: person.group_id,
    kind: "bot",
    agentId: agent.id,
  };
}
