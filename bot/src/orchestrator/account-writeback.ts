/**
 * Продление входа аккаунта бота: обновлённые куки, которые Google выдал во время встречи,
 * возвращаются на место сохранённого входа (#1140). Раньше они выбрасывались вместе с копией, и
 * снимок от 28.09 дожил ровно до срока годности — с 28.10 все встречи в Meet срывались.
 *
 * Здесь только проверка и замена файла; кто и когда зовёт — `account.ts` и оркестратор.
 *
 *  - выгрузка контейнера — чужой ввод: файл обязан быть JSON со списком кук и сессией Google
 *    (`hasGoogleSession`), иначе вход не трогается;
 *  - замена атомарная: временный файл в том же каталоге (0600) → rename; прежний вход остаётся
 *    рядом как `google-state.prev.json`;
 *  - значения кук не попадают ни в журнал, ни в текст ошибки.
 */
import { chmod, copyFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { hasGoogleSession } from "./account.ts";

const OWNER_ONLY = 0o600;
const PREVIOUS_NAME = "google-state.prev.json";

export type WritebackVerdict =
  { readonly ok: true; readonly cookies: number } | { readonly ok: false; readonly reason: string };

/**
 * Годится ли выгрузка в замену входа. Причина — без содержимого файла.
 */
export function validateExportedState(raw: string): WritebackVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "выгрузка не разбирается как JSON" };
  }
  const list =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { cookies?: unknown }).cookies
      : null;
  if (!Array.isArray(list)) return { ok: false, reason: "в выгрузке нет списка кук" };
  const cookies = list as readonly { name?: unknown; domain?: unknown }[];
  const named = cookies.filter(
    (cookie): cookie is { name: string; domain: string } =>
      typeof cookie.name === "string" && typeof cookie.domain === "string",
  );
  if (!hasGoogleSession(named)) {
    return { ok: false, reason: "в выгрузке нет сессии Google" };
  }
  return { ok: true, cookies: cookies.length };
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
  const verdict = validateExportedState(input.raw);
  if (!verdict.ok) return { written: false, reason: verdict.reason };
  await replaceStateFile(input.stateFile, input.raw);
  return { written: true, cookies: verdict.cookies };
}
