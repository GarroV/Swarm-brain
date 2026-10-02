// Дозаполнение эмбеддингов (issue #373). Когда OpenAI не отвечает, запись всё равно сохраняется,
// но с embedding = null: семантический поиск и «спросить» её не видят, а человек видел «сохранено».
// 18.09.2026 так легли 7 записей команды и пролежали без индекса две недели. Раз в час (ветка
// granola_poll в index.ts) берём порцию таких записей и индексируем заново.
//
// Текст для эмбеддинга — тот же состав, что у reindex_entry в swarm-mcp: саммари (или содержимое)
// плюс строка стран. Без повторного вызова чат-модели: дозаполнение чинит индекс, а не переписывает
// саммари, и стоит одного запроса эмбеддинга на запись.
import { specificCountries } from "../../_shared/meta-extract.ts";

/** Порция за проход: при долгом отказе модели записей может набраться много, а час спустя будет
 *  следующий проход — догонять одним вызовом незачем. */
export const BACKFILL_BATCH = 20;

/** Демо пересеивается каждые 30 минут (demo_reset) — индексировать его записи бессмысленно. */
export const BACKFILL_SKIP_GROUPS = ["demo"];

export interface BackfillEntry {
  id: string;
  content: string | null;
  summary: string | null;
  countries: string[] | null;
}

/** Узкая граница к базе: реализация на supabase-js — embedding-backfill-store.ts. */
export interface BackfillStore {
  missing(limit: number): Promise<BackfillEntry[]>;
  save(id: string, embedding: number[]): Promise<void>;
}

export function backfillText(e: BackfillEntry): string {
  const specific = specificCountries(e.countries ?? []);
  return [
    e.summary?.trim() || e.content?.trim() || "",
    specific.length > 0 ? `Страны: ${specific.join(", ")}` : "",
  ].filter(Boolean).join("\n").slice(0, 8000);
}

export interface BackfillResult {
  filled: number;
  failed: number;
}

/**
 * Один проход. Отказ модели на одной записи не останавливает остальные, но и не глотается:
 * счётчик failed уходит в ответ cron и в лог, чтобы «модель снова лежит» было видно.
 */
export async function backfillMissingEmbeddings(
  store: BackfillStore,
  embed: (text: string) => Promise<number[]>,
  limit = BACKFILL_BATCH,
): Promise<BackfillResult> {
  const rows = await store.missing(limit);
  let filled = 0;
  let failed = 0;
  for (const row of rows) {
    const text = backfillText(row);
    if (!text) continue; // пустой записи нечего индексировать — и пытаться каждый час незачем
    try {
      await store.save(row.id, await embed(text));
      filled++;
    } catch (err) {
      failed++;
      console.error(`embedding backfill: запись ${row.id} не проиндексирована:`, err);
    }
  }
  return { filled, failed };
}
