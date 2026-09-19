// Авторизация доступа к приватному файлу (бакет swarm_private).
//
// Файлы больше НЕ отдаются публичным URL (issue: утечка swarm_drive). Каждый показ проходит
// проверку доступа по РЕЕСТРУ файлов (таблица storage_files): кто владелец файла и по каким
// правилам его видно. Правила — зеркало entries-guard.ts (тот же принцип, что у самой записи),
// чтобы доступ к вложению не расходился с доступом к записи-владельцу.
//
// decideFileAccess — ЧИСТАЯ функция решения (без БД): её легко покрыть матрицей случаев.
// getFileSecure (ниже) — обёртка, читающая реестр и применяющая это решение.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type StorageOwnerKind = "entry" | "feedback";

// Строка реестра storage_files, влияющая на доступ. Зеркалит поля записи-владельца,
// чтобы решение считалось без второго запроса к entries.
export type StorageFileRow = {
  path: string;
  owner_kind: StorageOwnerKind;
  group_id: string | null;
  // Владелец записи (entries.owner_id) — для приватности вложения.
  owner_user_id: number | null;
  is_private: boolean;
};

export type FileRequester = {
  groupId: string;
  telegramId: number;
  isAdmin: boolean;
};

// Решение о доступе. deny всегда 404 (как getEntrySecure): существование чужого приватного
// файла не раскрываем — 403 отличало бы «есть, но не твой» от «нет».
export type FileAccessDecision =
  | { allowed: true }
  | { allowed: false; status: 404 };

export class FileAccessError extends Error {
  constructor(public readonly status: 404, message: string) {
    super(message);
    this.name = "FileAccessError";
  }
}

const DENY: FileAccessDecision = { allowed: false, status: 404 };

export function decideFileAccess(
  row: StorageFileRow,
  req: FileRequester,
): FileAccessDecision {
  // Фидбек-скрины — только суперадмину (класс данных без «владельца-участника»).
  if (row.owner_kind === "feedback") {
    return req.isAdmin ? { allowed: true } : DENY;
  }
  // Fail-closed: незнакомый класс файла не отдаём (страховка, если в реестре появится
  // owner_kind, для которого правило ещё не написано).
  if (row.owner_kind !== "entry") return DENY;

  // Вложение записи — те же два слоя, что у самой записи (entries-guard):
  //   Layer 1 — воркспейс-изоляция: кросс-воркспейс доступа нет, даже к публичному файлу.
  if (row.group_id !== req.groupId) return DENY;
  //   Layer 2 — приватность БЕЗ admin-байпаса: личное вложение видит только владелец.
  if (row.is_private && row.owner_user_id !== req.telegramId) return DENY;

  return { allowed: true };
}

// Что вернуть вызывающему при разрешённом доступе: где лежит объект.
export type ResolvedFile = { path: string; bucket: string };

// Реестр-строка в том виде, как её читаем из storage_files.
type RegistryRow = {
  path: string;
  bucket: string;
  owner_kind: StorageOwnerKind;
  entry_id: string | null;
};

/**
 * Резолвит файл по path через реестр + проверяет доступ.
 *
 *   1. storage_files по path — нет строки → 404 (файл не наш / не зарегистрирован).
 *   2. entry-файл: свежие права берём из entries (group_id/owner_id/is_private), НЕ из реестра.
 *   3. feedback-файл: admin-only, поля записи не нужны.
 *   4. decideFileAccess — единое решение; deny → FileAccessError(404).
 *
 */
export async function getFileSecure(
  supabase: SupabaseClient,
  path: string,
  req: FileRequester,
): Promise<ResolvedFile> {
  const { data: reg } = await supabase
    .from("storage_files")
    .select("path,bucket,owner_kind,entry_id")
    .eq("path", path)
    .maybeSingle();
  if (!reg) throw new FileAccessError(404, "Not found");
  const registry = reg as RegistryRow;

  let row: StorageFileRow;
  if (registry.owner_kind === "entry") {
    // Свежие права — из записи-владельца, НЕ из реестра (нет дрейфа приватности).
    const { data: entry } = await supabase
      .from("entries")
      .select("group_id,owner_id,is_private")
      .eq("id", registry.entry_id)
      .maybeSingle();
    if (!entry) throw new FileAccessError(404, "Not found");
    const e = entry as { group_id: string | null; owner_id: number | null; is_private: boolean };
    row = {
      path: registry.path,
      owner_kind: "entry",
      group_id: e.group_id,
      owner_user_id: e.owner_id,
      is_private: e.is_private,
    };
  } else {
    // feedback: admin-only, поля записи не участвуют в решении.
    row = { path: registry.path, owner_kind: "feedback", group_id: null, owner_user_id: null, is_private: true };
  }

  const decision = decideFileAccess(row, req);
  if (!decision.allowed) throw new FileAccessError(decision.status, "Not found");
  return { path: registry.path, bucket: registry.bucket };
}
