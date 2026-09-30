// Точечный вопрос по одной встрече: человек выделяет кусок тезисов и спрашивает «а что вот тут
// обсуждали?» — модель отвечает по стенограмме ЭТОЙ встречи несколькими пунктами. Ответ ничего
// не пишет в базу: веб вставляет его в тезисы как обычную правку, сохраняет человек (решение
// владельца 2026-09-30, docs/decisions/2026-09-30-tezisy-edit-in-place-and-ask.md).
//
// Отличие от «Переобработать» с пожеланием: та пересобирает тезисы целиком и стирает ручные
// правки; вопрос отвечает только про фрагмент. Отличие от POST /ask: тот ищет по всей базе.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatComplete, loadMeetingTextForModel } from "./meeting-processor.ts";
import {
  NO_INVENTED_LINKS_RULE,
  NO_SUBSTITUTED_NAMES_RULE,
  UNTRUSTED_MEETING_TEXT_RULE,
  wrapMeetingText,
} from "./tezisy-prompt.ts";
import { glossaryPromptBlock } from "./glossary.ts";

export const ASK_FRAGMENT_MAX = 1500;
export const ASK_QUESTION_MAX = 300;
export const ASK_DEFAULT_QUESTION = "Что конкретно здесь обсуждали?";
/** Строка ответа, когда в записи об этом ничего нет. Веб показывает её как есть. */
export const ASK_NOT_DISCUSSED = "- В записи это не обсуждалось.";
const ASK_MAX_POINTS = 8;

export const MEETING_ASK_SYSTEM = "Ты помощник команды. Отвечаешь на ТОЧЕЧНЫЙ вопрос по ОДНОЙ " +
  "встрече — СТРОГО по её стенограмме, ничего не выдумывай.\n" +
  UNTRUSTED_MEETING_TEXT_RULE + "\n" +
  NO_INVENTED_LINKS_RULE + "\n" +
  NO_SUBSTITUTED_NAMES_RULE + "\n" +
  "После маркера конца стоят ФРАГМЕНТ тезисов (его собрала модель по этой же встрече — это " +
  "ориентир, о какой части разговора речь, а НЕ источник фактов) и ВОПРОС человека.\n" +
  "Найди в стенограмме место, о котором фрагмент, и ответь на вопрос: что именно обсуждали, кто " +
  "что сказал (по имени из легенды говорящих), какие прозвучали цифры, сроки, названия и к чему " +
  "пришли. Конкретика важнее пересказа.\n" +
  `Формат: от 1 до 5 пунктов, каждый с новой строки и начинается с «- ». Без заголовков, ` +
  `вступлений и итогового «в целом». Пиши по-русски, имена и названия — как в стенограмме.\n` +
  `Если в стенограмме об этом не говорили — верни РОВНО одну строку: ${ASK_NOT_DISCUSSED}\n\n` +
  glossaryPromptBlock();

export type MeetingAskInput = { fragment: string; question: string };

/** Разбор тела запроса. Пустой вопрос → вопрос по умолчанию; пустой фрагмент — ошибка. */
export function parseMeetingAskBody(body: unknown): MeetingAskInput | { error: string } {
  const b = (body ?? {}) as { fragment?: unknown; question?: unknown };
  const fragment = typeof b.fragment === "string" ? b.fragment.trim() : "";
  if (!fragment) return { error: "fragment required" };
  if (fragment.length > ASK_FRAGMENT_MAX) return { error: `fragment longer than ${ASK_FRAGMENT_MAX}` };
  const q = typeof b.question === "string" ? b.question.trim() : "";
  if (q.length > ASK_QUESTION_MAX) return { error: `question longer than ${ASK_QUESTION_MAX}` };
  return { fragment, question: q || ASK_DEFAULT_QUESTION };
}

export function buildMeetingAskUserMessage(meetingText: string, input: MeetingAskInput): string {
  return `${wrapMeetingText(meetingText)}\n\nФРАГМЕНТ тезисов:\n«${input.fragment}»\n\n` +
    `ВОПРОС: ${input.question}`;
}

/**
 * Ответ модели → пункты «- …» в формате тезисов: без заголовков и пустых строк, не больше
 * ASK_MAX_POINTS. Пустой результат — null (вызывающий отдаёт ошибку, а не пустую вставку).
 */
export function normalizeAskAnswer(raw: string): string | null {
  const points = raw.replace(/\r\n/g, "\n").split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, ASK_MAX_POINTS);
  return points.length ? points.map((p) => `- ${p}`).join("\n") : null;
}

export class MeetingAskError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MeetingAskError";
  }
}

/** Задать вопрос по встрече `meetingId` (строка `meetings`). Доступ проверяет вызывающий. */
export async function answerMeetingQuestion(
  supabase: SupabaseClient,
  meetingId: string,
  input: MeetingAskInput,
): Promise<string> {
  const meetingText = await loadMeetingTextForModel(supabase, meetingId);
  if (meetingText === null) throw new MeetingAskError(400, "У встречи нет транскрипта — спросить не по чему");
  const raw = await chatComplete(MEETING_ASK_SYSTEM, buildMeetingAskUserMessage(meetingText, input), {
    temperature: 0.2,
    maxTokens: 1200,
  });
  const answer = normalizeAskAnswer(raw);
  if (!answer) throw new MeetingAskError(502, "Модель не дала ответа — попробуй ещё раз");
  return answer;
}
