import type { SwarmNotification } from "../notificationTypes";
import type { DeployNotice } from "@/lib/deployNotice";

// ── Task comments (апдейты) ─────────────────────────────────────────────────────
export type TaskComment = {
  id: string;
  content: string;
  author_name: string;
  author_telegram_id: number | null;
  created_at: string;
};

export type NotificationsResponse = {
  items: SwarmNotification[];
  unread: number;
  /** Объявление о раскатке — едет прицепом к ленте, отдельного поллинга нет. */
  notice?: DeployNotice | null;
};

// ── Подписка на уведомления о комментариях к задаче (issue #82) ───────────────
// `state` — явная строка (`subscribed`/`muted`) или null, если человек ничего не выбирал;
// `notified` — придут ли уведомления сейчас (это и показывает тумблер).
export type TaskSubscription = {
  state: "subscribed" | "muted" | null;
  reason: "comment" | "manual" | null;
  notified: boolean;
};
