// Задача голосом из рекордера (Bumblebee): расшифровка → поля → детерминированная проверка.
// Модель только раскладывает речь; что попадёт в задачу, решает normalizeVoiceTask — промпт
// можно проигнорировать, проверку нет (docs/decisions/2026-10-22-bumblebee-hub.md).
import { cleanExtractedField } from "./task-extract.ts";
import { COUNTRY_PROMPT_RULE, normalizeCountry } from "./countries.ts";
import { UNTRUSTED_DATA_RULE } from "./untrusted-prompt.ts";

/** Потолок заголовка, когда он берётся из расшифровки целиком. */
export const VOICE_TITLE_MAX = 200;
const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type VoiceTask = {
  title: string;
  description: string | null;
  country: string | null;
  due_date: string;
};

/** Календарная ISO-дата (2026-02-30 — не дата) или null. */
function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const same = date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 &&
    date.getUTCDate() === Number(m[3]);
  return same ? date : null;
}

/** Следующие сутки после ISO-даты клиента (срок по умолчанию — «+1 день», решение 03.09.2026). */
export function tomorrowOf(today: string): string {
  const d = parseIsoDate(today);
  if (!d) throw new Error(`today не ISO-дата: ${today}`);
  return new Date(d.getTime() + DAY_MS).toISOString().slice(0, 10);
}

function dueOrTomorrow(raw: unknown, today: string): string {
  const parsed = parseIsoDate(raw);
  const base = parseIsoDate(today);
  if (!parsed || !base || parsed.getTime() < base.getTime()) return tomorrowOf(today);
  return (raw as string).trim();
}

function allowedCountry(raw: unknown, allowedMarkets: string[]): string | null {
  const clean = cleanExtractedField(raw);
  if (!clean) return null;
  const iso = normalizeCountry(clean);
  return iso && allowedMarkets.includes(iso) ? iso : null;
}

/**
 * Поля задачи из ответа модели. null — не из чего собрать заголовок (ни название от модели,
 * ни расшифровка): вызывающий отвечает «ничего не услышал».
 */
export function normalizeVoiceTask(
  parsed: unknown,
  opts: { today: string; allowedMarkets: string[]; transcript?: string },
): VoiceTask | null {
  const p = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  const heard = (opts.transcript ?? "").trim();
  const title = cleanExtractedField(p.title) ?? (heard ? heard.slice(0, VOICE_TITLE_MAX).trim() : null);
  if (!title) return null;
  return {
    title,
    description: cleanExtractedField(p.description),
    country: allowedCountry(p.country, opts.allowedMarkets),
    due_date: dueOrTomorrow(p.due_date, opts.today),
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Системный промпт разбора диктовки. Сегодня — по часам клиента: сервер живёт в UTC. */
export function voiceTaskPrompt(today: string): string {
  const d = parseIsoDate(today);
  const weekday = d ? WEEKDAYS[d.getUTCDay()] : "";
  return `Today is ${today} (${weekday}). The user dictated ONE task out loud, in any language (Russian, English or Serbian). Extract it as JSON.
title: a short imperative formulation of the action in the language of the speech (no filler words, no country prefix).
description: one phrase of useful context that does not fit the title, or null.
country: the ONE market the task is about, as an English country name or ISO code, or null. Follow these tagging rules, but return a single value: ${COUNTRY_PROMPT_RULE}
due_date: YYYY-MM-DD, resolve «tomorrow», «by Friday», «next week» against today's date; never take a year from memory. If no deadline is named — null.
Use JSON null (not the string "null") for anything missing.
${UNTRUSTED_DATA_RULE}`;
}

/** Строгая схема ответа (structured output): ровно четыре поля. */
export const VOICE_TASK_SCHEMA = {
  name: "voice_task",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "description", "country", "due_date"],
    properties: {
      title: { type: "string" },
      description: { type: ["string", "null"] },
      country: { type: ["string", "null"] },
      due_date: { type: ["string", "null"] },
    },
  },
} as const;
