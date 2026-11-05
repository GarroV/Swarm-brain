// Переезд человека: что сказать по ответу сервера. Сервер отдаёт машинные коды — `{error, code}`
// и строки конфликтов вида `код:подробность` (`people_email_taken:<почта>`); человеческий текст
// на языке экрана собирается здесь, из словаря, а не из серверного английского.
import type { SpacesKey, Vars } from "./spacesDict";

type Translate = (key: SpacesKey, vars?: Vars) => string;

/** Машинный код из ответа с ошибкой (`ApiError.body.code`), иначе undefined. */
export function bodyCode(body: unknown): string | undefined {
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

const KEY_BY_CODE: Record<string, SpacesKey> = {
  person_not_found: "errPersonNotFound",
  workspace_not_found: "errWorkspaceNotFound",
  same_workspace: "errSameWorkspace",
  person_without_workspace: "errNoWorkspace",
  owner_only: "errOwnerOnly",
  master_admin_only: "errMasterOnly",
  bad_input: "errBadInput",
  conflicts: "moveBlocked",
  member_move_required: "errAdminElsewhere",
};

/** Ключ текста по коду отказа; неизвестный код — общее «не удалось». */
export function moveErrorKey(code: string | undefined, fallback: SpacesKey): SpacesKey {
  return (code && KEY_BY_CODE[code]) || fallback;
}

/** Коды, при которых повтор бессмыслен: причина не в сбое сети, а в самом запросе. */
export function isFinalMoveError(code: string | undefined): boolean {
  return !!code && code in KEY_BY_CODE && code !== "conflicts";
}

/** Строка конфликта `код:подробность` → текст; неизвестный код показывается как есть, не теряется. */
export function conflictText(t: Translate, raw: string): string {
  const i = raw.indexOf(":");
  const code = i < 0 ? raw : raw.slice(0, i);
  const detail = i < 0 ? "" : raw.slice(i + 1);
  if (code === "people_email_taken") return t("conflictEmailTaken", { email: detail });
  return t("conflictUnknown", { code: raw });
}

/** Счётчики из ответа `expected_mismatch`: только числа и вложенный `other`, остальное отбрасывается. */
export function parseFreshCounts(body: unknown): Record<string, unknown> | null {
  const counts = body && typeof body === "object" ? (body as { counts?: unknown }).counts : undefined;
  return counts && typeof counts === "object" && !Array.isArray(counts) ? counts as Record<string, unknown> : null;
}
