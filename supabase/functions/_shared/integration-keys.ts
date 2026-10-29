// Ключи интеграций пользователей (`user_integrations.api_key`) в зашифрованном виде (#585).
// Сейчас — Granola; календарные refresh-токены Google лежат в той же колонке открытым текстом
// и этим модулем пока не покрыты (отдельная задача).
//
// Механизм — тот же, что у ключей пространств (#233): AES-256-GCM из `secret-box.ts`, ключ
// шифрования — секрет сервера WORKSPACE_SECRETS_KEY. Значение в колонке — одна строка
// `enc:v1:<iv>:<ciphertext>` (base64): `v1` — версия ФОРМАТА строки, смены ключа шифрования
// механизм не поддерживает, как и у `workspace_secrets`. AAD = `<telegram_id>:<service>` —
// строка, перенесённая другому человеку или сервису, не расшифруется.
//
// Переходный период: строка без префикса `enc:v1:` — старый открытый ключ. `openIntegrationKey`
// возвращает её как есть (ключ шифрования для этого не нужен), `sealLegacyKeys` дошифровывает
// такие строки идемпотентно. ЗАПИСЬ открытым текстом невозможна: `sealIntegrationKey` без ключа
// шифрования бросает ошибку, тихого отката на открытый текст нет.
// Ключ наружу не отдаётся и в лог не попадает: ошибки здесь не содержат ни ключа, ни шифротекста.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openSecret, sealSecret } from "./secret-box.ts";

export const SEALED_PREFIX = "enc:v1:";

const aadOf = (telegramId: number, service: string) => `${telegramId}:${service}`;

/** Строка уже в зашифрованном формате? (Иначе — старый открытый ключ.) */
export function isSealedKey(stored: string): boolean {
  return stored.startsWith(SEALED_PREFIX);
}

/** Зашифровать ключ для записи в `user_integrations.api_key`. */
export async function sealIntegrationKey(plain: string, telegramId: number, service: string): Promise<string> {
  const { iv, ciphertext } = await sealSecret(plain, aadOf(telegramId, service));
  return `${SEALED_PREFIX}${iv}:${ciphertext}`;
}

/** Расшифровать значение колонки в точке использования; открытый (старый) ключ отдаёт как есть. */
export async function openIntegrationKey(stored: string, telegramId: number, service: string): Promise<string> {
  if (!isSealedKey(stored)) return stored;
  const parts = stored.slice(SEALED_PREFIX.length).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("ключ интеграции в базе повреждён: неверный формат");
  }
  const [iv, ciphertext] = parts;
  return await openSecret({ iv, ciphertext }, aadOf(telegramId, service));
}

export type SealLegacyResult = { sealed: number; alreadySealed: number; failed: number };

/**
 * Дошифровать все открытые ключи сервиса. Идемпотентно: зашифрованные строки пропускаются.
 * Запись условная (`api_key` всё ещё равен прочитанному): ключ, который человек успел
 * пересохранить, не затирается. Сбой одной строки не останавливает остальные. `dryRun` ничего не пишет.
 */
export async function sealLegacyKeys(
  supabase: SupabaseClient,
  service = "granola",
  dryRun = false,
): Promise<SealLegacyResult> {
  const { data, error } = await supabase.from("user_integrations")
    .select("telegram_id, api_key").eq("service", service);
  if (error) throw new Error(`user_integrations select: ${error.message}`);
  const result: SealLegacyResult = { sealed: 0, alreadySealed: 0, failed: 0 };
  for (const row of (data ?? []) as { telegram_id: number; api_key: string | null }[]) {
    if (!row.api_key) continue;
    if (isSealedKey(row.api_key)) {
      result.alreadySealed++;
      continue;
    }
    if (dryRun) {
      result.sealed++;
      continue;
    }
    try {
      const sealed = await sealIntegrationKey(row.api_key, row.telegram_id, service);
      const { error: upErr } = await supabase.from("user_integrations")
        .update({ api_key: sealed })
        .eq("telegram_id", row.telegram_id).eq("service", service).eq("api_key", row.api_key);
      if (upErr) throw new Error(upErr.message);
      result.sealed++;
    } catch (err) {
      result.failed++;
      console.error("seal legacy integration key failed", row.telegram_id, service, (err as Error).message);
    }
  }
  return result;
}
