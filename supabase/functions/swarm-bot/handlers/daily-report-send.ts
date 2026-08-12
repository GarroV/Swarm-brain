import { aggregateActivity, formatReport, type EntryRow, yesterdayWindow } from "./daily-report.ts";
import { ADMIN_USER_ID, supabase } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";

export async function sendDailyReport(): Promise<void> {
  const { sinceISO, untilISO, dateLabel } = yesterdayWindow();
  // Добавлено в базу за вчера: опубликованные entries (metadata/content — для списка названий).
  const { data, error } = await supabase
    .from("entries")
    .select("entry_type, source, group_id, metadata, content")
    .gte("created_at", sinceISO)
    .lt("created_at", untilISO)
    .neq("source", "digest")
    .in("entry_type", ["meeting", "note"])
    .limit(5000);
  if (error) {
    await sendMessage(ADMIN_USER_ID, `⚠️ Свод за ${dateLabel}: ошибка запроса — ${error.message}`);
    return;
  }
  // На вычитке: очередь невычитанных встреч (status=awaiting_review) — стоячее напоминание
  // «есть что подтвердить». Считаем ТОЛЬКО то, что получатель (админ) реально увидит в вебе:
  // его записи (recorders содержит его telegram_id), а не ВСЕ черновики глобально — иначе
  // «На вычитке: N» расходится с пустой «Доской встреч» (админ-байпаса для встреч нет; issue #20).
  // .contains с JSON-СТРОКОЙ → корректный jsonb-containment cs.[{"telegram_id":N}] (как в /agent-meetings).
  // Не роняем весь свод, если этот запрос упал — добавленное всё равно ценно (reviewCount=0).
  const { count: reviewCount, error: reviewError } = await supabase
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .eq("status", "awaiting_review")
    .contains("recorders", JSON.stringify([{ telegram_id: ADMIN_USER_ID }]));
  if (reviewError) {
    await sendMessage(ADMIN_USER_ID, `⚠️ Свод за ${dateLabel}: не удалось посчитать очередь вычитки — ${reviewError.message}`);
  }
  const report = formatReport(aggregateActivity((data ?? []) as EntryRow[]), dateLabel, reviewCount ?? 0);
  await sendMessage(ADMIN_USER_ID, report);
}
