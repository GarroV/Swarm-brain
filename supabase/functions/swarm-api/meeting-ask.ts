import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { EntryAccessError, type EntryRow, getEntrySecure } from "./entries-guard.ts";
import { canViewEntry, type EntryAccessRow } from "../_shared/entries/access.ts";
import { canAccessDraftMeeting, type DraftMeetingRow } from "../_shared/meeting-access.ts";
import { answerMeetingQuestion, MeetingAskError, parseMeetingAskBody } from "../_shared/meeting-ask.ts";

// Точечный вопрос по встрече (логика и промпт — `_shared/meeting-ask.ts`):
//   POST /agent-meetings/:id/ask — черновик на вычитке (:id = meetings.id)
//   POST /meetings/:id/ask       — опубликованная встреча (:id = entries.id, транскрипт по
//                                  metadata.meeting_id)
// Тело { fragment, question? } → { answer } — пункты «- …». В базу не пишет ничего.
//
// Доступ: спрашивать может тот, кто записывал встречу, или совладелец — правило черновика
// (`canAccessDraftMeeting`). Ответ пересказывает транскрипт, а у опубликованной ОБЩЕЙ встречи
// коллеги видят только тезисы: иначе вопрос стал бы обходным путём к чужой сырой записи.
// Исключение — ЛИЧНАЯ встреча, которую смотрящий видит (встреча 1-1 на двоих, #641, решение
// владельца 01.10.2026: «другой учатсинк тоже»): кто её видит, тот и участник разговора.
// Решение — `canAskAboutMeeting`. Возвращает null, если путь не про вопрос.

const AGENT_ASK = /^\/agent-meetings\/([^/]+)\/ask$/;
const ENTRY_ASK = /^\/meetings\/([^/]+)\/ask$/;

export async function handleMeetingAskRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  // Оверсайта у вопроса нет — как у черновика (canAccessDraftMeeting): параметр не влияет.
  _isAdmin: boolean,
  origin: string,
): Promise<Response | null> {
  if (req.method !== "POST") return null;
  const agentMatch = routePath.match(AGENT_ASK);
  const entryMatch = agentMatch ? null : routePath.match(ENTRY_ASK);
  if (!agentMatch && !entryMatch) return null;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiErr(400, "Invalid JSON", origin);
  }
  const input = parseMeetingAskBody(body);
  if ("error" in input) return apiErr(400, input.error, origin);

  let meetingId: string | null;
  let entry: EntryRow | null = null;
  try {
    if (agentMatch) {
      meetingId = agentMatch[1];
    } else {
      entry = await getEntrySecure(supabase, entryMatch![1], { groupId, telegramId });
      meetingId = (entry.metadata as { meeting_id?: string } | null)?.meeting_id ?? null;
    }
  } catch (e) {
    if (e instanceof EntryAccessError) return apiErr(e.status, e.message, origin);
    throw e;
  }
  if (!meetingId) return apiErr(400, "У записи нет транскрипта встречи — спросить не по чему", origin);

  const { data: row } = await supabase.from("meetings").select("group_id, recorders, co_owners")
    .eq("id", meetingId).maybeSingle();
  if (!canAskAboutMeeting(entry, row as DraftMeetingRow | null, telegramId, groupId)) {
    return apiErr(404, "Not found", origin);
  }

  try {
    const answer = await answerMeetingQuestion(supabase, meetingId, input);
    return json({ answer }, 200, origin);
  } catch (e) {
    if (e instanceof MeetingAskError) return apiErr(e.status, e.message, origin);
    console.error("meeting-ask: модель не ответила", e);
    return apiErr(502, "Не удалось получить ответ — попробуй ещё раз", origin);
  }
}

/**
 * Можно ли спросить по встрече. `entry` — опубликованная запись (null для черновика), `meeting` —
 * строка meetings с владельцами черновика.
 *
 * Владельцы черновика спрашивают всегда. Кроме них — тот, кому видна ЛИЧНАЯ запись этой встречи
 * (тем же правилом `canViewEntry`, что и сама видимость): у личной записи круг видящих и есть
 * круг участников — владелец и второй участник встречи 1-1. По общей записи остальные не
 * спрашивают: они видят тезисы, но не сырую запись.
 */
export function canAskAboutMeeting(
  entry: EntryAccessRow | null,
  meeting: DraftMeetingRow | null,
  viewerId: number,
  viewerGroupId: string,
): boolean {
  if (!meeting) return false;
  if (canAccessDraftMeeting(meeting, viewerId, false, viewerGroupId)) return true;
  if (!entry || meeting.group_id !== viewerGroupId) return false;
  return entry.is_private && canViewEntry(entry, viewerId);
}
