export type CreateEntryInput = {
  content: string;
  is_private?: boolean;
};

export type UpdateEntryInput = {
  content?: string;
  summary?: string | null;
};

/** Подсказки поиска слева (GET /search/quick): названия, без текстов. Права — как у списков. */
export type QuickSearchResult = {
  tasks: {
    id: string;
    title: string;
    status: string;
    due_date: string | null;
  }[];
  projects: { id: string; name: string; emoji: string | null }[];
  meetings: { id: string; title: string; date: string | null }[];
  notes: { id: string; title: string; date: string | null }[];
};

export type AskSource = {
  n: number;
  id: string;
  tag: string; // doc | mic | note | meet | pdf
  entry_type: string;
  title: string;
  snippet: string;
  market: string | null;
  date: string | null; // entry_date (YYYY-MM-DD) — для показа и предпочтения свежих
  similarity: number;
};

export type AskResult = {
  query: string;
  answer: string; // с inline-сносками [n]
  sources: AskSource[];
  followups: string[];
};

// Демо без модели (docs/decisions/2026-10-27-demo-no-model.md): вместо свободного вопроса —
// заготовленные. Сервер отвечает на них через тот же ask(); список вопросов — GET /demo/questions.
export type DemoQuestion = {
  id: string;
  question: string;
  question_ru: string;
};
