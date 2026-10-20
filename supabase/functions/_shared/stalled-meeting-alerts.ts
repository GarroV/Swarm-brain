// Тревога мастер-админу (владельцу) о встрече, застрявшей в обработке (#233, решение владельца
// 19.10.2026, docs/decisions/2026-10-19-language-and-tech-alerts.md §1). Баннер админа остаётся;
// это второй, активный канал. Зовёт почасовой крон swarm-bot (`task_pings_cron`) — своего планировщика нет.
//
// Правила: один раз на встречу (память — `stalled_meeting_alerts`, право берётся вставкой по PK, так что
// два экземпляра не пришлют дважды); не больше MAX_ALERTS_PER_HOUR за скользящий час — остальные уйдут
// следующими тиками; адресаты — только мастер-админы. Приватность: у названия админского обхода нет
// (решение 2026-08-07) — чего получатель не видит, называется «личная встреча».
// Техническая тревога владельцу шлётся всегда, мимо комендантского часа (как прочие тревоги, notify-person.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onlyLiveEntries } from "./entries/live.ts";
import { canViewEntry } from "./entries/access.ts";
import { canAccessDraftMeeting, type DraftMeetingRow } from "./meeting-access.ts";
import { sendTelegramCall } from "./notify-person.ts";
import { STALL_MINUTES } from "./ai-health.ts";
import { listMasterAdmins } from "./users/master-admins.ts";

const TABLE = "stalled_meeting_alerts";

/** Не больше стольких тревог за скользящий час — буря сбоев не должна забить бота владельца. */
export const MAX_ALERTS_PER_HOUR = 3;
const HOUR_MS = 3_600_000;
/** Старые следы тревог чистим, чтобы таблица не росла. */
const KEEP_MS = 30 * 24 * HOUR_MS;

export const PRIVATE_MEETING_LABEL = "личная встреча";

export function stalledMeetingText(title: string, workspace: string, stage: string): string {
  return `Встреча «${title}» в пространстве «${workspace}» застряла в обработке дольше ${STALL_MINUTES} минут (этап: ${stage}). Нужно разобраться.`;
}

export type SendAlert = (telegramId: number, text: string) => Promise<void>;
const defaultSend: SendAlert = async (id, text) => {
  await sendTelegramCall("sendMessage", { chat_id: id, text, disable_web_page_preview: true });
};

type MeetingRow = DraftMeetingRow & {
  id: string;
  title: string | null;
  entry_id: string | null;
  group_id: string | null;
  process_state: { stage?: string } | null;
  created_at: string;
  ended_at: string | null;
  last_progress_at: string | null;
};

type EntryRow = { is_private: boolean; owner_id: number | null; shared_with?: Array<number | string> | null };

/** Название, которое получателю положено видеть; иначе «личная встреча». Сбой чтения записи — тоже без названия. */
async function visibleTitle(supabase: SupabaseClient, m: MeetingRow, viewerId: number): Promise<string> {
  const title = (m.title ?? "").trim() || "без названия";
  if (m.entry_id) {
    const { data, error } = await onlyLiveEntries(
      supabase.from("entries").select("is_private, owner_id, shared_with").eq("id", m.entry_id),
    ).maybeSingle();
    const entry = data as EntryRow | null;
    if (error || !entry) return PRIVATE_MEETING_LABEL;
    return canViewEntry(entry, viewerId) ? title : PRIVATE_MEETING_LABEL;
  }
  // Черновик: видят записавшие и совладельцы (админского обхода нет, meeting-access.ts).
  return canAccessDraftMeeting(m, viewerId, false, m.group_id) ? title : PRIVATE_MEETING_LABEL;
}

/** Разослать тревоги по застрявшим встречам; вернуть, сколько встреч ушло в тревогу. */
export async function alertStalledMeetings(
  supabase: SupabaseClient,
  now: Date = new Date(),
  send: SendAlert = defaultSend,
): Promise<number> {
  const { data, error } = await supabase.from("meetings")
    .select(
      "id, title, entry_id, group_id, process_state, recorders, co_owners, attendees, created_at, ended_at, last_progress_at",
    )
    .eq("summary_status", "processing");
  if (error) throw new Error(`stalled-alerts: встречи (${error.code ?? "db"})`);
  const cutoff = now.getTime() - STALL_MINUTES * 60_000;
  const stalled = ((data ?? []) as MeetingRow[])
    .filter((m) => new Date(m.last_progress_at ?? m.ended_at ?? m.created_at).getTime() <= cutoff)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (stalled.length === 0) return 0;

  const { data: past, error: pastErr } = await supabase.from(TABLE).select("meeting_id, alerted_at");
  if (pastErr) throw new Error(`stalled-alerts: журнал (${pastErr.code ?? "db"})`);
  const done = new Set(((past ?? []) as Array<{ meeting_id: string }>).map((r) => r.meeting_id));
  const inLastHour = ((past ?? []) as Array<{ alerted_at: string }>)
    .filter((r) => now.getTime() - new Date(r.alerted_at).getTime() < HOUR_MS).length;
  let budget = MAX_ALERTS_PER_HOUR - inLastHour;

  const masters = (await listMasterAdmins(supabase)).map((a) => a.telegram_id);
  const wsNames = new Map<string, string>();
  let alerted = 0;
  for (const m of stalled) {
    if (budget <= 0) break;
    if (done.has(m.id)) continue;
    // Право на тревогу — вставка по PK; конфликт значит «уже взяли».
    const { error: claimErr } = await supabase.from(TABLE).insert({ meeting_id: m.id, alerted_at: now.toISOString() });
    if (claimErr) {
      if (claimErr.code !== "23505") console.error(`stalled-alerts: не взять право (${claimErr.code ?? "db"})`);
      continue;
    }
    budget--;
    if (m.group_id && !wsNames.has(m.group_id)) {
      const { data: ws } = await supabase.from("workspaces").select("name").eq("id", m.group_id).maybeSingle();
      wsNames.set(m.group_id, (ws as { name?: string } | null)?.name ?? m.group_id);
    }
    const workspace = (m.group_id && wsNames.get(m.group_id)) || "—";
    const stage = m.process_state?.stage ?? "—";
    let delivered = 0;
    for (const id of masters) {
      try {
        await send(id, stalledMeetingText(await visibleTitle(supabase, m, id), workspace, stage));
        delivered++;
      } catch (e) {
        console.error(`stalled-alerts: тревога ${id} не ушла:`, e instanceof Error ? e.message : e);
      }
    }
    if (masters.length > 0 && delivered === 0) {
      // Никто не получил — отпускаем право, следующий тик попробует снова.
      await supabase.from(TABLE).delete().eq("meeting_id", m.id);
      budget++;
      continue;
    }
    alerted++;
  }
  // Уборка старых следов — не критична, сбой не должен ронять крон.
  const { error: gcErr } = await supabase.from(TABLE).delete().lt(
    "alerted_at",
    new Date(now.getTime() - KEEP_MS).toISOString(),
  );
  if (gcErr) console.error(`stalled-alerts: уборка (${gcErr.code ?? "db"})`);
  return alerted;
}
