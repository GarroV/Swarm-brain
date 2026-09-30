// Границы админских маршрутов (`/admin/*`) — ЕДИНОЕ правило, кем и в каком объёме админ
// распоряжается. Решение владельца 28.09.2026: права админа не урезаем, задаём ему границы и
// делаем заметными правки чужих аккаунтов.
//   • Суперадмин (ADMIN_USER_ID) — глобальный объём: все воркспейсы, создание воркспейсов,
//     рассылка всем.
//   • Админ (флаг allowed_users.is_admin) — только СВОЙ воркспейс (group_id из index.ts):
//     его люди, его настройки, рассылка его команде. Чужой воркспейс для него не существует (404).
//   • Аккаунт суперадмина (почта — ключ веб-входа, флаг админа) меняет только сам суперадмин.
//   • Смена почты чужого аккаунта не проходит молча: человеку приходит сообщение в бота,
//     в журнал функции пишется структурная строка (отдельной таблицы журнала нет).

export const SUPERADMIN_TELEGRAM_ID = 744230399;

export type AdminActor = {
  telegramId: number;
  /** Воркспейс админа — тот же group_id, что index.ts резолвит для всех data-запросов. */
  groupId: string;
};

/** Строка allowed_users в объёме, который нужен правилам. */
export type MemberRow = {
  telegram_id: number | null;
  group_id: string | null;
  email?: string | null;
};

export function isSuperadmin(actor: AdminActor): boolean {
  return actor.telegramId === SUPERADMIN_TELEGRAM_ID;
}

/** Воркспейс в объёме админа: суперадмину любой, остальным — только свой. */
export function canManageWorkspace(actor: AdminActor, wsId: string): boolean {
  return isSuperadmin(actor) || wsId === actor.groupId;
}

/** Участник в объёме админа: суперадмину любой, остальным — только из своего воркспейса. */
export function canManageMember(actor: AdminActor, target: MemberRow): boolean {
  return isSuperadmin(actor) ||
    (target.group_id != null && target.group_id === actor.groupId);
}

/**
 * Можно ли менять ключевые поля аккаунта (почта входа, флаг админа, членство):
 * аккаунт суперадмина — только ему самому.
 */
export function canChangeAccountKeys(
  actor: AdminActor,
  target: MemberRow,
): boolean {
  return target.telegram_id !== SUPERADMIN_TELEGRAM_ID || isSuperadmin(actor);
}

/** Нормализация почты так же, как её хранит allowed_users (lower, пусто → null). */
export function normalizeEmail(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  return s ? s : null;
}

/** Смена почты чужого аккаунта (свою правку себе не объявляем). */
export function isForeignEmailChange(
  actor: AdminActor,
  targetTelegramId: number | null,
  oldEmail: string | null,
  newEmail: string | null,
): boolean {
  return oldEmail !== newEmail && targetTelegramId !== actor.telegramId;
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***";
}

/** Текст сообщения человеку — EN приоритетно, RU следом (правило двуязычия продукта). */
export function emailChangeNoticeText(
  actorName: string,
  oldEmail: string | null,
  newEmail: string | null,
): string {
  const was = oldEmail ?? "—";
  const now = newEmail ?? "—";
  return [
    `SWARM: ${actorName} (admin) changed the email you use to sign in on the web.`,
    `Was: ${was}`,
    `Now: ${now}`,
    "If you did not expect this, contact your workspace admin.",
    "",
    `SWARM: ${actorName} (админ) изменил почту, по которой вы входите в веб-версию.`,
    `Было: ${was}`,
    `Стало: ${now}`,
    "Если вы этого не ждали, свяжитесь с админом воркспейса.",
  ].join("\n");
}

export type EmailChangeEvent = {
  actor: AdminActor;
  targetTelegramId: number | null;
  targetGroupId: string | null;
  oldEmail: string | null;
  newEmail: string | null;
  actorName: string;
};

/**
 * Сделать смену почты заметной: структурная строка в журнал функции + сообщение человеку в бота.
 * Best-effort: правка уже сохранена, сбой уведомления логируется и запрос не роняет.
 * Синтетический id (<0, вход только через Google) и ожидающее приглашение (null) в Telegram
 * недоступны — для них остаётся только строка журнала.
 */
export async function announceEmailChange(
  ev: EmailChangeEvent,
  send: (chatId: number, text: string) => Promise<boolean> = sendTelegramText,
): Promise<void> {
  const canMessage = ev.targetTelegramId != null && ev.targetTelegramId > 0;
  let delivered = false;
  if (canMessage) {
    try {
      delivered = await send(
        ev.targetTelegramId!,
        emailChangeNoticeText(ev.actorName, ev.oldEmail, ev.newEmail),
      );
    } catch (e) {
      console.error("[admin] email change notice failed:", e);
    }
  }
  console.info(JSON.stringify({
    event: "admin_account_email_changed",
    actor_telegram_id: ev.actor.telegramId,
    target_telegram_id: ev.targetTelegramId,
    group_id: ev.targetGroupId,
    old_email: maskEmail(ev.oldEmail),
    new_email: maskEmail(ev.newEmail),
    notified: delivered,
    at: new Date().toISOString(),
  }));
}

async function sendTelegramText(chatId: number, text: string): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) console.error("[admin] telegram sendMessage:", r.status);
  return r.ok;
}
