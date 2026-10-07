// Задача из пересланного сообщения — чистая часть (без сети и базы), под тестами.
//
// Владелец 07.10.2026: «я пересылаю текст сообщения от начальника, с комментарием что создай
// задачу… давай научимся делать задачи таким образом». Telegram присылает комментарий и
// пересланное двумя апдейтами; связывает их forward-task.ts, а здесь — что из них получится.
import type { TgMessage } from "../lib/types.ts";
import { normalizeExtractedDueDate } from "../../_shared/llm-date.ts";

const TITLE_MAX = 90;

/** Состояние ожидания в sessions.context: комментарий пришёл, пересланное ещё нет. */
export type ForwardWait = { comment: string; rest: string; assigneeMention: string | null; at: number };
/** Задача уже создана — следующие пересланные той же пачки дописываются в неё. */
export type ForwardAppend = { taskId: string; title: string; at: number };

/** Сколько комментарий ждёт пересланного: пересылка с комментарием приходит за секунду, ручная — дольше. */
export const WAIT_TTL_MS = 5 * 60 * 1000;
/** Пачка пересланных (выделил несколько сообщений) приходит подряд за пару секунд. */
export const APPEND_TTL_MS = 20 * 1000;

export function isFresh(at: number, ttlMs: number, now: number = Date.now()): boolean {
  return Number.isFinite(at) && now - at >= 0 && now - at <= ttlMs;
}

export function parseState<T>(context: string | undefined): T | null {
  if (!context) return null;
  try {
    return JSON.parse(context) as T;
  } catch {
    return null;
  }
}

/** От кого переслано: человек, скрытый отправитель, чат или канал. */
export function forwardSenderName(m: TgMessage): string | null {
  const o = m.forward_origin as
    | {
      type?: string;
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

/** Описание задачи: текст как есть, ниже — откуда он и что сказал отправивший. */
export function buildDescription(text: string, sender: string | null, comment: string | null): string {
  const lines = [text.trim()];
  const meta: string[] = [];
  if (sender) meta.push(`Переслано от: ${sender}`);
  if (comment?.trim()) meta.push(`Комментарий: ${comment.trim()}`);
  if (meta.length) lines.push("", "—", ...meta);
  return lines.join("\n");
}

/** Название, если модель не ответила: первая содержательная строка, обрезанная по слову. */
export function fallbackTitle(text: string): string {
  const first = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "Задача из пересланного";
  if (first.length <= TITLE_MAX) return first;
  const cut = first.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${space > 40 ? cut.slice(0, space) : cut}…`;
}

export type TaskDraft = { title: string; assignee: string | null; dueDate: string | null };

/** Ответ модели → черновик. Битый ответ не ломает задачу: название — из текста, срок — по умолчанию. */
export function draftFromModel(raw: string | null, text: string, today: string): TaskDraft {
  let obj: Record<string, unknown> = {};
  try {
    obj = raw ? JSON.parse(raw) : {};
  } catch {
    obj = {};
  }
  const title = typeof obj.title === "string" && obj.title.trim()
    ? obj.title.trim().slice(0, TITLE_MAX)
    : fallbackTitle(text);
  const assignee = typeof obj.assignee === "string" && obj.assignee.trim() ? obj.assignee.trim() : null;
  const dueDate = typeof obj.due_date === "string" ? normalizeExtractedDueDate(obj.due_date, today) : null;
  return { title, assignee, dueDate };
}

export const DRAFT_SYSTEM_PROMPT = `Ты превращаешь пересланное сообщение в задачу для таск-трекера.
Верни JSON: {"title": string, "assignee": string|null, "due_date": "YYYY-MM-DD"|null}.
- title: короткое действие в повелительном наклонении, до 80 символов, на языке сообщения, без кавычек и эмодзи. Что сделать, а не пересказ.
- assignee: имя исполнителя, только если его прямо назвал КОММЕНТАРИЙ отправителя («Пете», «на Ксению»). Из пересланного текста исполнителя не бери. Иначе null.
- due_date: срок, если его назвал комментарий или пересланный текст («до пятницы», «к 15-му», «завтра»), посчитай от даты «сегодня». Иначе null.`;

export function draftUserPrompt(text: string, comment: string, today: string): string {
  return `Сегодня: ${today}\nКомментарий отправителя: ${comment || "—"}\n\nПересланное сообщение:\n${text}`;
}
