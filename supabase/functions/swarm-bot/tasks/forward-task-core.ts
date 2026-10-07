// Задача из пересланного сообщения — чистая часть (без сети и базы), под тестами.
//
// Владелец 07.10.2026: «реализуем только "добавь задачу" или закинь задачу и все такое +
// пересланное сообщение. задача создается стандартно, срок +1 день. человек потом в вебе зайдет и
// поправит что надо было». Поэтому без модели и без разбора: название — первая строка
// пересланного, описание — весь текст и от кого, исполнитель — сам отправитель, срок — завтра.
import type { TgMessage } from "../lib/types.ts";

const TITLE_MAX = 90;

/** Сколько комментарий ждёт пересланного: пересылка с комментарием приходит за секунду, ручная — дольше. */
export const WAIT_TTL_MS = 5 * 60 * 1000;

export function isFresh(at: number, ttlMs: number, now: number = Date.now()): boolean {
  return Number.isFinite(at) && now - at >= 0 && now - at <= ttlMs;
}

/** Отметка времени ожидания из sessions.context; битая → NaN (ожидание не свежее). */
export function waitStartedAt(context: string | undefined): number {
  const at = Number(context);
  return context && Number.isFinite(at) ? at : NaN;
}

/** От кого переслано: человек, скрытый отправитель, чат или канал. */
export function forwardSenderName(m: TgMessage): string | null {
  const o = m.forward_origin as
    | {
      sender_user?: { first_name?: string; last_name?: string; username?: string };
      sender_user_name?: string;
      sender_chat?: { title?: string };
      chat?: { title?: string };
    }
    | undefined;
  const person = (u?: { first_name?: string; last_name?: string; username?: string }) =>
    u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : null) : null;
  if (o) {
    return person(o.sender_user) ?? o.sender_user_name ?? o.sender_chat?.title ?? o.chat?.title ?? null;
  }
  return person(m.forward_from) ?? m.forward_from_chat?.title ?? null;
}

/** Описание задачи: текст как есть, ниже — от кого он. */
export function buildDescription(text: string, sender: string | null): string {
  return sender ? `${text.trim()}\n\n— переслано от: ${sender}` : text.trim();
}

/** Название: первая содержательная строка, обрезанная по слову. */
export function taskTitle(text: string): string {
  const first = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "Задача из пересланного";
  if (first.length <= TITLE_MAX) return first;
  const cut = first.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${space > 40 ? cut.slice(0, space) : cut}…`;
}
