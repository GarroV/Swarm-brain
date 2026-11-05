/**
 * Продление входа аккаунта бота: обновлённые куки, которые Google выдал во время встречи,
 * возвращаются на место сохранённого входа (#1140). Раньше они выбрасывались вместе с копией, и
 * снимок от 28.09 дожил ровно до срока годности — с 28.10 все встречи в Meet срывались.
 *
 * Здесь только проверка и замена файла; кто и когда зовёт — `account.ts` и оркестратор.
 *
 *  - выгрузка контейнера — недоверенный ввод: JSON со списком кук и сессией Google
 *    (`hasGoogleSession`); сохраняются только домены Google, аккаунт обязан остаться тем же и
 *    выгрузка не старее текущего входа, иначе вход не трогается;
 *  - замена атомарная: временный файл в том же каталоге (0600) → rename; прежний вход остаётся
 *    рядом как `google-state.prev.json`;
 *  - значения кук не попадают ни в журнал, ни в текст ошибки.
 */
import { chmod, copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { hasGoogleSession } from "./account.ts";

const OWNER_ONLY = 0o600;
const PREVIOUS_NAME = "google-state.prev.json";

export type WritebackVerdict =
  | { readonly ok: true; readonly cookies: number; readonly sanitized: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Выгрузка контейнера — НЕдоверенный ввод: контейнер открывает чужую страницу звонка, а скомпрометированный
 * процесс может написать что угодно, в том числе о собственном исходе. Доверенная сторона здесь
 * оркестратор, и он сверяет выгрузку с текущим файлом входа.
 *
 * Сохраняются только куки и `origins` доменов google.com / youtube.com и их поддоменов
 * (www, accounts, meet, myaccount, ogs — все они в живом входе); остальное отбрасывается.
 */
const GOOGLE_ROOT_DOMAINS = ["google.com", "youtube.com"] as const;

/**
Куки сессии Google: все, что были в текущем входе, обязаны остаться в выгрузке (новые — можно:
Google вправе добавить куку штатно, а пропажа сессионной значит, что вход не тот или неполный).
*/
const SESSION_NAMES = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LSID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
]);

/**
Кука, чьё значение держит выбранный аккаунт и не меняется с обновлением сессии.
*/
const ACCOUNT_IDENTIFIER_NAME = "ACCOUNT_CHOOSER";

interface StoredCookie {
  readonly name: string;
  readonly domain: string;
  readonly value?: unknown;
  readonly expires?: unknown;
}

interface ParsedState {
  readonly cookies: readonly StoredCookie[];
  readonly origins: readonly { readonly origin?: unknown }[];
}

function isGoogleHost(host: string): boolean {
  const bare = host.replace(/^\./u, "").toLowerCase();
  return GOOGLE_ROOT_DOMAINS.some((root) => bare === root || bare.endsWith(`.${root}`));
}

function parseState(raw: string): ParsedState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { cookies?: unknown; origins?: unknown };
  if (!Array.isArray(record.cookies)) return null;
  const cookies = (record.cookies as readonly Partial<StoredCookie>[]).filter(
    (cookie): cookie is StoredCookie =>
      typeof cookie.name === "string" && typeof cookie.domain === "string",
  );
  const origins = Array.isArray(record.origins)
    ? (record.origins as readonly { origin?: unknown }[])
    : [];
  return { cookies, origins };
}

function originHost(origin: unknown): string {
  try {
    return typeof origin === "string" ? new URL(origin).hostname : "";
  } catch {
    return "";
  }
}

function sessionNames(cookies: readonly StoredCookie[]): ReadonlySet<string> {
  return new Set(cookies.filter((c) => SESSION_NAMES.has(c.name)).map((c) => c.name));
}

function latestExpiry(cookies: readonly StoredCookie[]): number | null {
  const times = cookies
    .filter((c) => SESSION_NAMES.has(c.name) && typeof c.expires === "number" && c.expires > 0)
    .map((c) => c.expires as number);
  return times.length === 0 ? null : Math.max(...times);
}

function identifier(cookies: readonly StoredCookie[]): unknown {
  return cookies.find((c) => c.name === ACCOUNT_IDENTIFIER_NAME)?.value;
}

/**
 * Сверка выгрузки с текущим входом: тот же аккаунт и не старее. Причины — без значений кук.
 */
function sameAccountAndNotOlder(
  current: ParsedState,
  next: readonly StoredCookie[],
): string | null {
  const kept = sessionNames(next);
  if ([...sessionNames(current.cookies)].some((name) => !kept.has(name))) {
    return "в выгрузке нет сессионной куки текущего входа — вход неполный или чужой";
  }
  const knownId = identifier(current.cookies);
  if (knownId !== undefined && knownId !== identifier(next)) {
    return "идентификатор аккаунта отличается от текущего входа — возможна подмена аккаунта";
  }
  const before = latestExpiry(current.cookies);
  const after = latestExpiry(next);
  if (before !== null && (after === null || after < before)) {
    return "выгрузка старее текущего входа";
  }
  return null;
}

/**
 * Годится ли выгрузка в замену входа и что именно сохранить: только Google-домены, тот же
 * аккаунт, не старее. `current` — текущий файл входа (`null` — его нет). Причина отказа — без
 * содержимого файла.
 */
export function validateExportedState(raw: string, current: string | null): WritebackVerdict {
  const parsed = parseState(raw);
  if (parsed === null)
    return { ok: false, reason: "выгрузка не разбирается как JSON со списком кук" };
  const cookies = parsed.cookies.filter((cookie) => isGoogleHost(cookie.domain));
  if (!hasGoogleSession(cookies)) {
    return { ok: false, reason: "в выгрузке нет сессии Google" };
  }
  const known = current === null ? null : parseState(current);
  if (known !== null) {
    const mismatch = sameAccountAndNotOlder(known, cookies);
    if (mismatch !== null) return { ok: false, reason: mismatch };
  }
  const origins = parsed.origins.filter((item) => isGoogleHost(originHost(item.origin)));
  return { ok: true, cookies: cookies.length, sanitized: JSON.stringify({ cookies, origins }) };
}

/**
 * Заменить вход проверенным содержимым. Вызывающий уже проверил его `validateExportedState`.
 */
async function replaceStateFile(stateFile: string, raw: string): Promise<void> {
  const directory = path.dirname(stateFile);
  const temporary = path.join(directory, `${path.basename(stateFile)}.tmp-${String(process.pid)}`);
  try {
    await writeFile(temporary, raw, { mode: OWNER_ONLY });
    await chmod(temporary, OWNER_ONLY);
    try {
      await copyFile(stateFile, path.join(directory, PREVIOUS_NAME));
      await chmod(path.join(directory, PREVIOUS_NAME), OWNER_ONLY);
    } catch (error) {
      // Прежнего входа нет — хранить нечего; любая другая ошибка — громко.
      if ((error as { code?: unknown } | null)?.code !== "ENOENT") throw error;
    }
    await rename(temporary, stateFile);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
Исход запуска, при котором вход бота слетел: выгрузку такого запуска не принимаем никогда.
*/
const SIGNIN_REQUIRED_OUTCOME = "account_signin_required";

export type CommitResult =
  | { readonly written: true; readonly cookies: number }
  | { readonly written: false; readonly reason: string };

/**
 * Принять выгрузку контейнера и заменить ею вход, если она годится. Отказ — причина без
 * содержимого; вход при отказе остаётся как был.
 */
export async function commitExport(input: {
  readonly stateFile: string;
  /**
  Что контейнер выгрузил; `null` — ничего.
  */
  readonly raw: string | null;
  /**
  Исход запуска из строки состояния; `null` — не назван.
  */
  readonly outcome: string | null;
}): Promise<CommitResult> {
  if (input.outcome === SIGNIN_REQUIRED_OUTCOME) {
    return { written: false, reason: "Google просил вход — слетевший вход не сохраняем" };
  }
  if (input.raw === null) return { written: false, reason: "контейнер ничего не выгрузил" };
  let current: string | null = null;
  try {
    current = await readFile(input.stateFile, "utf8");
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "ENOENT") throw error;
  }
  const verdict = validateExportedState(input.raw, current);
  if (!verdict.ok) return { written: false, reason: verdict.reason };
  await replaceStateFile(input.stateFile, verdict.sanitized);
  return { written: true, cookies: verdict.cookies };
}
