// Демо без модели (решение владельца 27.10.2026, docs/decisions/2026-10-27-demo-no-model.md).
//
// Ссылка на демо публична (README), и каждый вызов OpenAI из неё — чужие деньги. Поэтому
// демо-сессия не доходит до модели ни в одном маршруте:
//   • «спросить базу» (POST /ask), поиск по смыслу (GET /search) и дайджест главной (POST /digest)
//     отвечают заготовленным результатом из каталога demo-questions-data.ts, без эмбеддинга и чата;
//   • GET /demo/questions — список заготовленных вопросов для экрана (вместо поля ввода);
//   • все остальные маршруты, которые зовут модель (разбор текста в задачи, голос, вопрос по
//     встрече, пересборка тезисов, запись встречи из браузера, импорт из Granola, новая запись) —
//     403 `demo_model_unavailable` с текстом на двух языках.
// Нижний слой страховки — замок в `_shared/model-scope.ts`: `externalFetch` не пускает демо к OpenAI,
// даже если маршрут сюда не попал. Опубликовать черновик встречи демо может — без классификатора и
// эмбеддинга (publishDraftMeeting `skipModel`).
//
// Вызывается из роутера ТОЛЬКО для демо-сессии, до остальных маршрутов.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEMO_GROUP_ID } from "../_shared/demo-session.ts";
import { onlyLiveEntries } from "../_shared/entries/live.ts";
import { ENTRY_COLUMNS } from "./entries-guard.ts";
import { json } from "./http.ts";
import { DEMO_DIGEST, DEMO_QUESTIONS, type DemoQuestion, type DemoSource } from "./demo-questions-data.ts";

const MS_PER_DAY = 86_400_000;

export type DemoModelAction = "ask" | "search" | "digest" | "questions" | "refuse";

const MEETING_ID = "[^/]+";
/** Маршруты, которые зовут модель и в демо закрыты. Метод → шаблоны пути. */
const REFUSED: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/entries$/ },
  { method: "POST", path: /^\/tasks\/extract$/ },
  { method: "POST", path: /^\/tasks\/voice$/ },
  { method: "POST", path: new RegExp(`^/meetings/${MEETING_ID}/ask$`) },
  { method: "POST", path: new RegExp(`^/agent-meetings/${MEETING_ID}/ask$`) },
  { method: "POST", path: new RegExp(`^/meetings/${MEETING_ID}/resummarize$`) },
  { method: "POST", path: new RegExp(`^/agent-meetings/${MEETING_ID}/resummarize$`) },
  { method: "POST", path: /^\/meetings\/record$/ },
  { method: "PUT", path: new RegExp(`^/meetings/record/${MEETING_ID}/segments/${MEETING_ID}$`) },
  { method: "POST", path: new RegExp(`^/meetings/record/${MEETING_ID}/finish$`) },
  { method: "GET", path: new RegExp(`^/granola/notes/${MEETING_ID}/preview$`) },
  { method: "POST", path: new RegExp(`^/granola/notes/${MEETING_ID}/import$`) },
];

/** Что делать демо-сессии с этим запросом; null — маршрут к модели не ведёт. */
export function classifyDemoModelRoute(method: string, routePath: string): DemoModelAction | null {
  if (method === "POST" && routePath === "/ask") return "ask";
  if (method === "GET" && routePath === "/search") return "search";
  if (method === "POST" && routePath === "/digest") return "digest";
  if (method === "GET" && routePath === "/demo/questions") return "questions";
  return REFUSED.some((r) => r.method === method && r.path.test(routePath)) ? "refuse" : null;
}

const REFUSAL = {
  en: "This feature uses the AI model and is not available in the demo. Try the sample questions instead.",
  ru: "Эта функция использует модель ИИ и недоступна в демо. Попробуйте заготовленные вопросы.",
};
const NOT_PRESET = {
  en: "In the demo, answers are prepared in advance. Pick one of the sample questions below.",
  ru: "В демо ответы заготовлены заранее. Выберите один из примеров вопросов ниже.",
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[?？\s]+$/u, "").replace(/\s+/g, " ");
}

/** Заготовленный вопрос по id или по тексту (англ. или рус.) — без учёта регистра и знака вопроса. */
export function findDemoQuestion(q: string): DemoQuestion | null {
  const key = normalize(q);
  if (!key) return null;
  return DEMO_QUESTIONS.find((d) =>
    d.id === key || normalize(d.question.en) === key || normalize(d.question.ru) === key
  ) ?? null;
}

function isoDaysAgo(daysAgo: number, now: Date): string {
  return new Date(now.getTime() - daysAgo * MS_PER_DAY).toISOString().slice(0, 10);
}

function askSources(sources: readonly DemoSource[], now: Date) {
  return sources.map((s, i) => ({
    n: i + 1,
    id: s.id,
    tag: s.tag,
    entry_type: s.entry_type,
    title: s.title,
    snippet: s.snippet.en,
    market: s.market,
    date: isoDaysAgo(s.daysAgo, now),
    similarity: 1,
  }));
}

const listQuestions = (ids: readonly string[]) =>
  DEMO_QUESTIONS.filter((d) => ids.includes(d.id)).map((d) => ({ id: d.id, question: d.question.en, question_ru: d.question.ru }));

export interface DemoModelContext {
  supabase: SupabaseClient;
  origin: string;
  /** Подмена «сегодня» для тестов. */
  now?: Date;
}

export async function handleDemoModelRoute(
  ctx: DemoModelContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  const action = classifyDemoModelRoute(req.method, routePath);
  if (!action) return null;
  const now = ctx.now ?? new Date();

  switch (action) {
    case "refuse":
      return json({ error: REFUSAL.en, error_ru: REFUSAL.ru, code: "demo_model_unavailable" }, 403, ctx.origin);
    case "questions":
      return json({ questions: listQuestions(DEMO_QUESTIONS.map((d) => d.id)) }, 200, ctx.origin);
    case "digest":
      return json({
        text: DEMO_DIGEST.text.en,
        text_ru: DEMO_DIGEST.text.ru,
        sources: askSources(DEMO_DIGEST.sources, now),
      }, 200, ctx.origin);
    case "ask": {
      let body: { q?: string; id?: string };
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400, ctx.origin);
      }
      const q = (body.id ?? body.q ?? "").trim();
      if (!q) return json({ error: "q required" }, 400, ctx.origin);
      const found = findDemoQuestion(q);
      if (!found) {
        return json({
          query: q,
          answer: NOT_PRESET.en,
          answer_ru: NOT_PRESET.ru,
          sources: [],
          followups: DEMO_QUESTIONS.map((d) => d.question.en),
        }, 200, ctx.origin);
      }
      return json({
        query: found.question.en,
        answer: found.answer.en,
        answer_ru: found.answer.ru,
        sources: askSources(found.sources, now),
        followups: found.followups.flatMap((id) => DEMO_QUESTIONS.find((d) => d.id === id)?.question.en ?? []),
      }, 200, ctx.origin);
    }
    case "search": {
      const found = findDemoQuestion(new URL(req.url).searchParams.get("q") ?? "");
      if (!found) return json([], 200, ctx.origin);
      const ids = found.sources.map((s) => s.id);
      const { data, error } = await onlyLiveEntries(
        ctx.supabase.from("entries").select(ENTRY_COLUMNS).eq("group_id", DEMO_GROUP_ID).in("id", ids),
      );
      if (error) {
        console.error("demo search: не прочитал записи", error.message);
        return json({ error: "Search failed" }, 500, ctx.origin);
      }
      const rows = (data ?? []) as Array<{ id: string }>;
      return json(ids.flatMap((id) => rows.filter((r) => r.id === id)), 200, ctx.origin);
    }
  }
}
