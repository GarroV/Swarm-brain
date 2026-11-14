import { mcpApiFetch } from "./api";

export type MasterAdminEvent = {
  id: string;
  action: "added" | "removed";
  actor_telegram_id: number;
  actor_name: string | null;
  target_telegram_id: number;
  target_name: string | null;
  created_at: string;
};

/** Read-only journal; permissions are checked by the existing master-admin route guard. */
export function fetchMasterAdminHistory(): Promise<MasterAdminEvent[]> {
  if (process.env.NEXT_PUBLIC_DEV_MODE === "true") return Promise.resolve([]);
  return mcpApiFetch<MasterAdminEvent[]>("/admin/master-admins/history", { cache: "no-store" });
}

export const MASTER_ADMIN_HISTORY_COPY = {
  ru: {
    heading: "История изменений ролей",
    recent: "Последние 100 изменений",
    empty: "Изменений ролей пока нет.",
    error: "Не удалось загрузить историю ролей",
    retry: "Повторить",
    added: "Выдача роли",
    removed: "Снятие роли",
    actor: "Кто",
    target: "Кому",
  },
  en: {
    heading: "Role change history",
    recent: "Latest 100 changes",
    empty: "No role changes yet.",
    error: "Could not load role history",
    retry: "Retry",
    added: "Role granted",
    removed: "Role revoked",
    actor: "By",
    target: "For",
  },
} as const;
