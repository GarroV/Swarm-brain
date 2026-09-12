import { buildDailyReport, type EntryRow, yesterdayWindow } from "./daily-report.ts";
import { ADMIN_USER_ID, supabase } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";

// Грязный слой свода: два запроса к базе и отправка. Вся логика «что делать, когда запрос
// не прошёл» живёт в buildDailyReport (чистая, тестируемая) — здесь только сами запросы.
// supabase-js НЕ бросает на ошибке, а возвращает её в поле `error`, поэтому переводим её
// в исключение: иначе ретрай в buildDailyReport не увидит, что попытка провалилась.
export async function sendDailyReport(): Promise<void> {
  const { sinceISO, untilISO, dateLabel } = yesterdayWindow();

  // Добавлено в базу за вчера: опубликованные entries (metadata/content — для списка названий).
  const loadEntries = async (): Promise<EntryRow[]> => {
    const { data, error } = await supabase
      .from("entries")
      .select("entry_type, source, group_id, metadata, content")
      .gte("created_at", sinceISO)
      .lt("created_at", untilISO)
      .neq("source", "digest")
      .in("entry_type", ["meeting", "note"])
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as EntryRow[];
  };

  // На вычитке: очередь невычитанных встреч (status=awaiting_review) — стоячее напоминание
  // «есть что подтвердить». Считаем ТОЛЬКО то, что получатель (админ) реально увидит в вебе:
  // его записи (recorders содержит его telegram_id), а не ВСЕ черновики глобально — иначе
  // «На вычитке: N» расходится с пустой «Доской встреч» (админ-байпаса для встреч нет; issue #20).
  // .contains с JSON-СТРОКОЙ → корректный jsonb-containment cs.[{"telegram_id":N}] (как в /agent-meetings).
  const loadReviewCount = async (): Promise<number> => {
    const { count, error } = await supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("status", "awaiting_review")
      .contains("recorders", JSON.stringify([{ telegram_id: ADMIN_USER_ID }]));
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const report = await buildDailyReport({ loadEntries, loadReviewCount }, dateLabel);
  await sendMessage(ADMIN_USER_ID, report);
}
